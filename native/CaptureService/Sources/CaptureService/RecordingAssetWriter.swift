import Foundation

#if canImport(AVFoundation) && canImport(CoreMedia)
import AVFoundation
import CoreMedia

private final class SampleBufferBox: @unchecked Sendable {
  let value: CMSampleBuffer

  init(_ value: CMSampleBuffer) {
    self.value = value
  }
}

/// Owns the AVAssetWriter lifecycle and keeps all media writes on one bounded serial queue.
/// ScreenCaptureKit callbacks never cross the Electron boundary; they are consumed here and
/// encoded directly into a temporary file.
final class RecordingAssetWriter: @unchecked Sendable {
  private let configuration: CaptureConfiguration
  private let diagnostics: CaptureDiagnostics
  private let queue = DispatchQueue(
    label: "capture-service.asset-writer",
    qos: .userInitiated
  )
  private let pendingLock = NSLock()
  private let maxPendingSamples = 12

  private let partialURL: URL
  private let finalURL: URL
  private let writer: AVAssetWriter
  private let videoInput: AVAssetWriterInput
  private let systemAudioInput: AVAssetWriterInput?
  private let microphoneInput: AVAssetWriterInput?
  private let hardwareEncoder: Bool

  private var pendingSamples = 0
  private var hasStartedWriting = false
  private var finishRequested = false
  private var isPaused = false
  private var pauseStartedAt: CMTime?
  private var totalPausedDurationSeconds = 0.0
  private var sessionStartTime: CMTime?
  private var lastSourceVideoTimestamp: CMTime?
  private var lastVideoTimestamp: CMTime?
  private var lastSystemAudioTimestamp: CMTime?
  private var lastMicrophoneTimestamp: CMTime?
  private var failureMessage: String?
  private var completedResult: NativeRecordingResult?

  init(configuration: CaptureConfiguration, diagnostics: CaptureDiagnostics) throws {
    self.configuration = configuration
    self.diagnostics = diagnostics
    self.hardwareEncoder = NativeEncoderCapabilities.isHardwareEncoderAvailable(
      for: configuration.profileId
    )

    let outputDirectory = URL(fileURLWithPath: configuration.outputDirectory, isDirectory: true)
      .standardizedFileURL
    do {
      try FileManager.default.createDirectory(
        at: outputDirectory,
        withIntermediateDirectories: true
      )
    } catch {
      throw NativeServiceError.fileFinalizationFailed(
        "Unable to create the recording directory: \(error.localizedDescription)"
      )
    }

    let token = UUID().uuidString.lowercased()
    let baseName = "Screen Recording \(token)"
    let fileExtension = configuration.profileId.container.rawValue
    self.finalURL = outputDirectory
      .appendingPathComponent(baseName)
      .appendingPathExtension(fileExtension)
    self.partialURL = outputDirectory
      .appendingPathComponent(".\(baseName).\(fileExtension).partial")

    try? FileManager.default.removeItem(at: partialURL)
    try? FileManager.default.removeItem(at: finalURL)

    do {
      self.writer = try AVAssetWriter(
        outputURL: partialURL,
        fileType: configuration.profileId.container.avFileType
      )
    } catch {
      throw NativeServiceError.encodingUnavailable(
        "Unable to create the recording writer: \(error.localizedDescription)"
      )
    }

    let videoInput = AVAssetWriterInput(
      mediaType: .video,
      outputSettings: Self.videoSettings(for: configuration)
    )
    videoInput.expectsMediaDataInRealTime = true
    guard writer.canAdd(videoInput) else {
      throw NativeServiceError.encodingUnavailable("The selected video track cannot be added.")
    }
    writer.add(videoInput)
    self.videoInput = videoInput

    let audioSettings = Self.audioSettings()
    if configuration.systemAudio {
      let input = AVAssetWriterInput(mediaType: .audio, outputSettings: audioSettings)
      input.expectsMediaDataInRealTime = true
      guard writer.canAdd(input) else {
        throw NativeServiceError.encodingUnavailable("The system audio track cannot be added.")
      }
      writer.add(input)
      self.systemAudioInput = input
    } else {
      self.systemAudioInput = nil
    }

    if configuration.microphone {
      let input = AVAssetWriterInput(mediaType: .audio, outputSettings: audioSettings)
      input.expectsMediaDataInRealTime = true
      guard writer.canAdd(input) else {
        throw NativeServiceError.encodingUnavailable("The microphone track cannot be added.")
      }
      writer.add(input)
      self.microphoneInput = input
    } else {
      self.microphoneInput = nil
    }

    diagnostics.setWriterError(nil, partialOutputPath: partialURL.path)
  }

  var startResult: NativeRecordingStart {
    NativeRecordingStart(
      profileId: configuration.profileId.rawValue,
      codec: configuration.profileId.codec.rawValue,
      container: configuration.profileId.container.rawValue,
      hardwareEncoder: hardwareEncoder,
      partialOutputPath: partialURL.path
    )
  }

  func append(sampleBuffer: CMSampleBuffer, sampleKind: NativeSampleKind) {
    pendingLock.lock()
    guard pendingSamples < maxPendingSamples else {
      pendingLock.unlock()
      diagnostics.recordWriterDrop(sampleKind: sampleKind)
      return
    }
    pendingSamples += 1
    pendingLock.unlock()
    let sampleBufferBox = SampleBufferBox(sampleBuffer)

    queue.async { [weak self] in
      defer { self?.decrementPendingSamples() }
      self?.appendOnQueue(sampleBuffer: sampleBufferBox.value, sampleKind: sampleKind)
    }
  }

  func pause() {
    queue.async { [weak self] in
      guard let self, !self.isPaused, !self.finishRequested else { return }
      self.isPaused = true
      self.pauseStartedAt = self.lastSourceVideoTimestamp
    }
  }

  func resume() {
    queue.async { [weak self] in
      guard let self, self.isPaused, !self.finishRequested else { return }
      self.isPaused = false
    }
  }

  func finish() async throws -> NativeRecordingResult {
    try await withCheckedThrowingContinuation { continuation in
      queue.async { [weak self] in
        guard let self else {
          continuation.resume(throwing: NativeServiceError.captureFailure("The writer was released before finalization."))
          return
        }
        self.finishOnQueue(continuation: continuation)
      }
    }
  }

  func interrupt(message: String) {
    queue.async { [weak self] in
      guard let self, !self.finishRequested else { return }
      self.failureMessage = message
      self.diagnostics.setWriterError(message, partialOutputPath: self.partialURL.path)
    }
  }

  private func appendOnQueue(sampleBuffer: CMSampleBuffer, sampleKind: NativeSampleKind) {
    guard !finishRequested, failureMessage == nil else { return }
    guard CMSampleBufferIsValid(sampleBuffer) else {
      diagnostics.recordWriterDrop(sampleKind: sampleKind)
      return
    }

    let sourceTimestamp = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
    guard sourceTimestamp.isValid else {
      diagnostics.recordWriterDrop(sampleKind: sampleKind)
      return
    }

    if isPaused {
      diagnostics.recordWriterDrop(sampleKind: sampleKind)
      return
    }

    if sampleKind == .video, !hasStartedWriting {
      writer.startWriting()
      guard writer.status == .writing else {
        failOnQueue(message: writer.error?.localizedDescription ?? "The video encoder failed to start.")
        return
      }
      writer.startSession(atSourceTime: sourceTimestamp)
      hasStartedWriting = true
      sessionStartTime = sourceTimestamp
    }

    guard hasStartedWriting, writer.status == .writing else {
      // Audio may arrive before the first video frame. It is intentionally held out of the
      // file until the shared video timeline exists, which also handles microphone start delay.
      diagnostics.recordWriterDrop(sampleKind: sampleKind)
      return
    }

    if let pauseStartedAt {
      let pauseDuration = CMTimeGetSeconds(CMTimeSubtract(sourceTimestamp, pauseStartedAt))
      if pauseDuration.isFinite, pauseDuration > 0 {
        totalPausedDurationSeconds += pauseDuration
        diagnostics.setPauseDuration(milliseconds: totalPausedDurationSeconds * 1_000)
      }
      self.pauseStartedAt = nil
    }

    let offset = CMTime(seconds: totalPausedDurationSeconds, preferredTimescale: 600)
    let adjustedSampleBuffer = adjustedSampleBuffer(sampleBuffer, subtracting: offset)
    guard let adjustedSampleBuffer else {
      diagnostics.recordWriterDrop(sampleKind: sampleKind)
      return
    }

    let adjustedTimestamp = CMSampleBufferGetPresentationTimeStamp(adjustedSampleBuffer)
    let input: AVAssetWriterInput?
    let previousTimestamp: CMTime?

    switch sampleKind {
    case .video:
      input = videoInput
      previousTimestamp = lastVideoTimestamp.map {
        adjustedTimestampForComparison($0, subtracting: offset)
      }
    case .audio:
      input = systemAudioInput
      previousTimestamp = lastSystemAudioTimestamp
    case .microphone:
      input = microphoneInput
      previousTimestamp = lastMicrophoneTimestamp
    }

    guard let input else {
      diagnostics.recordWriterDrop(sampleKind: sampleKind)
      return
    }
    guard input.isReadyForMoreMediaData else {
      diagnostics.recordWriterDrop(sampleKind: sampleKind)
      return
    }

    if let previousTimestamp, adjustedTimestamp <= previousTimestamp {
      diagnostics.recordWriterDrop(sampleKind: sampleKind)
      return
    }

    guard input.append(adjustedSampleBuffer) else {
      failOnQueue(message: writer.error?.localizedDescription ?? "The encoder rejected a media sample.")
      return
    }

    switch sampleKind {
    case .video:
      lastSourceVideoTimestamp = sourceTimestamp
      lastVideoTimestamp = adjustedTimestamp
    case .audio:
      lastSystemAudioTimestamp = adjustedTimestamp
    case .microphone:
      lastMicrophoneTimestamp = adjustedTimestamp
    }

    diagnostics.recordEncodedSample(
      byteCount: Int64(max(0, CMSampleBufferGetTotalSampleSize(adjustedSampleBuffer)))
    )
  }

  private func finishOnQueue(
    continuation: CheckedContinuation<NativeRecordingResult, Error>
  ) {
    guard !finishRequested else {
      if let completedResult {
        continuation.resume(returning: completedResult)
      } else {
        continuation.resume(throwing: NativeServiceError.captureFailure("Recording finalization was already requested."))
      }
      return
    }
    finishRequested = true

    if let failureMessage {
      continuation.resume(throwing: NativeServiceError.recordingInterrupted(failureMessage))
      return
    }

    guard hasStartedWriting else {
      let message = "The recording stopped before a video frame was captured."
      diagnostics.setWriterError(message, partialOutputPath: partialURL.path)
      continuation.resume(throwing: NativeServiceError.captureFailure(message))
      return
    }

    videoInput.markAsFinished()
    systemAudioInput?.markAsFinished()
    microphoneInput?.markAsFinished()

    writer.finishWriting { [weak self] in
      guard let self else {
        continuation.resume(throwing: NativeServiceError.captureFailure("The writer was released during finalization."))
        return
      }
      self.queue.async {
        guard self.writer.status == .completed else {
          let message = self.writer.error?.localizedDescription ?? "The recording could not be finalized."
          self.diagnostics.setWriterError(message, partialOutputPath: self.partialURL.path)
          continuation.resume(throwing: NativeServiceError.fileFinalizationFailed(message))
          return
        }

        do {
          let result = try self.moveCompletedFileOnQueue()
          self.completedResult = result
          continuation.resume(returning: result)
        } catch {
          continuation.resume(throwing: error)
        }
      }
    }
  }

  private func moveCompletedFileOnQueue() throws -> NativeRecordingResult {
    do {
      try FileManager.default.moveItem(at: partialURL, to: finalURL)
    } catch {
      let message = "Unable to move the completed recording into place: \(error.localizedDescription)"
      diagnostics.setWriterError(message, partialOutputPath: partialURL.path)
      throw NativeServiceError.fileFinalizationFailed(message)
    }

    let fileSize = (try? FileManager.default.attributesOfItem(atPath: finalURL.path)[.size] as? NSNumber)
      .map(\.int64Value)
      ?? 0
    let durationSeconds = durationSecondsOnQueue()
    diagnostics.setWriterError(nil, partialOutputPath: nil)

    return NativeRecordingResult(
      status: "completed",
      filePath: finalURL.path,
      profileId: configuration.profileId.rawValue,
      codec: configuration.profileId.codec.rawValue,
      container: configuration.profileId.container.rawValue,
      width: configuration.width,
      height: configuration.height,
      frameRate: configuration.frameRate,
      durationMs: durationSeconds * 1_000,
      pausedDurationMs: totalPausedDurationSeconds * 1_000,
      fileSizeBytes: fileSize,
      hasSystemAudio: configuration.systemAudio,
      hasMicrophone: configuration.microphone,
      hardwareEncoder: hardwareEncoder
    )
  }

  private func durationSecondsOnQueue() -> Double {
    guard let start = sessionStartTime, let end = lastVideoTimestamp else { return 0 }
    let duration = CMTimeGetSeconds(CMTimeSubtract(end, start))
    return duration.isFinite ? max(0, duration) : 0
  }

  private func failOnQueue(message: String) {
    guard failureMessage == nil else { return }
    failureMessage = message
    diagnostics.setWriterError(message, partialOutputPath: partialURL.path)
  }

  private func decrementPendingSamples() {
    pendingLock.lock()
    pendingSamples = max(0, pendingSamples - 1)
    pendingLock.unlock()
  }

  private func adjustedSampleBuffer(
    _ sampleBuffer: CMSampleBuffer,
    subtracting offset: CMTime
  ) -> CMSampleBuffer? {
    guard offset.isValid, offset > .zero else { return sampleBuffer }

    var timingCount = 0
    guard CMSampleBufferGetSampleTimingInfoArray(
      sampleBuffer,
      entryCount: 0,
      arrayToFill: nil,
      entriesNeededOut: &timingCount
    ) == noErr, timingCount > 0 else {
      return nil
    }

    var timingInfo = [CMSampleTimingInfo](
      repeating: CMSampleTimingInfo(
        duration: .invalid,
        presentationTimeStamp: .invalid,
        decodeTimeStamp: .invalid
      ),
      count: timingCount
    )
    guard CMSampleBufferGetSampleTimingInfoArray(
      sampleBuffer,
      entryCount: timingCount,
      arrayToFill: &timingInfo,
      entriesNeededOut: &timingCount
    ) == noErr else {
      return nil
    }

    for index in timingInfo.indices {
      timingInfo[index].presentationTimeStamp = CMTimeSubtract(
        timingInfo[index].presentationTimeStamp,
        offset
      )
      if timingInfo[index].decodeTimeStamp.isValid {
        timingInfo[index].decodeTimeStamp = CMTimeSubtract(
          timingInfo[index].decodeTimeStamp,
          offset
        )
      }
    }

    var copiedSampleBuffer: CMSampleBuffer?
    guard CMSampleBufferCreateCopyWithNewTiming(
      allocator: nil,
      sampleBuffer: sampleBuffer,
      sampleTimingEntryCount: timingInfo.count,
      sampleTimingArray: &timingInfo,
      sampleBufferOut: &copiedSampleBuffer
    ) == noErr else {
      return nil
    }
    return copiedSampleBuffer
  }

  private func adjustedTimestampForComparison(_ timestamp: CMTime, subtracting offset: CMTime) -> CMTime {
    // Video timestamps are stored after retiming. This helper documents that no additional
    // subtraction is needed when comparing the current adjusted sample to the previous one.
    _ = offset
    return timestamp
  }

  private static func videoSettings(for configuration: CaptureConfiguration) -> [String: Any] {
    let profile = configuration.profileId
    let pixelsPerSecond = Double(configuration.width * configuration.height * configuration.frameRate)
    let bitrate: Int

    switch profile {
    case .compatible:
      bitrate = Int(max(8_000_000, min(80_000_000, pixelsPerSecond * 0.095)))
    case .balanced:
      bitrate = Int(max(6_000_000, min(60_000_000, pixelsPerSecond * 0.055)))
    case .master:
      bitrate = Int(max(50_000_000, min(500_000_000, pixelsPerSecond * 0.22)))
    }

    var settings: [String: Any] = [
      AVVideoCodecKey: profile.codec.avCodecType,
      AVVideoWidthKey: configuration.width,
      AVVideoHeightKey: configuration.height,
    ]

    if profile != .master {
      settings[AVVideoCompressionPropertiesKey] = [
        AVVideoAverageBitRateKey: bitrate,
        AVVideoExpectedSourceFrameRateKey: configuration.frameRate,
        AVVideoMaxKeyFrameIntervalKey: configuration.frameRate * 2,
        AVVideoAllowFrameReorderingKey: false,
      ]
    }

    return settings
  }

  private static func audioSettings() -> [String: Any] {
    [
      AVFormatIDKey: kAudioFormatMPEG4AAC,
      AVSampleRateKey: 48_000,
      AVNumberOfChannelsKey: 2,
      AVEncoderBitRateKey: 192_000,
    ]
  }
}

#else

final class RecordingAssetWriter: @unchecked Sendable {
  init(configuration: CaptureConfiguration, diagnostics: CaptureDiagnostics) throws {
    _ = configuration
    _ = diagnostics
    throw NativeServiceError.encodingUnavailable("AVAssetWriter is unavailable in this SDK.")
  }
}

#endif
