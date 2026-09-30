import Foundation

#if canImport(AVFoundation) && canImport(CoreMedia)
import AVFoundation
import CoreMedia

/// Converts the independently captured system and microphone tracks into one universally
/// playable audio track. The encoded video samples are passed through unchanged, so this step
/// does not reduce image quality or consume the hardware encoder a second time.
enum RecordingAudioMixer {
  static func mixTracksIfNeeded(
    inputURL: URL,
    outputURL: URL,
    fileType: AVFileType
  ) async throws -> Bool {
    let asset = AVURLAsset(url: inputURL)
    let audioTracks = try await asset.loadTracks(withMediaType: .audio)
    guard audioTracks.count > 1 else { return false }

    guard let videoTrack = try await asset.loadTracks(withMediaType: .video).first else {
      throw NativeServiceError.fileFinalizationFailed(
        "The completed recording does not contain a video track."
      )
    }
    guard let videoFormat = try await videoTrack.load(.formatDescriptions).first else {
      throw NativeServiceError.fileFinalizationFailed(
        "The completed recording video format could not be read."
      )
    }

    try? FileManager.default.removeItem(at: outputURL)

    let reader: AVAssetReader
    let writer: AVAssetWriter
    do {
      reader = try AVAssetReader(asset: asset)
      writer = try AVAssetWriter(outputURL: outputURL, fileType: fileType)
    } catch {
      throw NativeServiceError.fileFinalizationFailed(
        "Unable to prepare the recording audio mix: \(error.localizedDescription)"
      )
    }

    let videoOutput = AVAssetReaderTrackOutput(track: videoTrack, outputSettings: nil)
    videoOutput.alwaysCopiesSampleData = false
    guard reader.canAdd(videoOutput) else {
      throw NativeServiceError.fileFinalizationFailed(
        "The encoded video track could not be read for finalization."
      )
    }
    reader.add(videoOutput)

    let videoInput = AVAssetWriterInput(
      mediaType: .video,
      outputSettings: nil,
      sourceFormatHint: videoFormat
    )
    videoInput.transform = try await videoTrack.load(.preferredTransform)
    guard writer.canAdd(videoInput) else {
      throw NativeServiceError.fileFinalizationFailed(
        "The encoded video track could not be copied into the final recording."
      )
    }
    writer.add(videoInput)

    // AVAssetReaderAudioMixOutput decodes and aligns both sources before applying this mix.
    // Keeping the microphone at unity gain makes speech clear; modestly lowering system audio
    // prevents loud application audio from masking the speaker or clipping the combined signal.
    let audioOutput = AVAssetReaderAudioMixOutput(
      audioTracks: audioTracks,
      audioSettings: linearPCMAudioSettings()
    )
    let audioMix = AVMutableAudioMix()
    audioMix.inputParameters = audioTracks.enumerated().map { index, track in
      let parameters = AVMutableAudioMixInputParameters(track: track)
      parameters.setVolume(index == 0 ? 0.72 : 1.0, at: .zero)
      return parameters
    }
    audioOutput.audioMix = audioMix
    guard reader.canAdd(audioOutput) else {
      throw NativeServiceError.fileFinalizationFailed(
        "The system and microphone audio tracks could not be mixed."
      )
    }
    reader.add(audioOutput)

    let audioInput = AVAssetWriterInput(
      mediaType: .audio,
      outputSettings: encodedAudioSettings()
    )
    guard writer.canAdd(audioInput) else {
      throw NativeServiceError.fileFinalizationFailed(
        "The mixed audio track could not be added to the final recording."
      )
    }
    writer.add(audioInput)

    let transfer = RecordingAssetTransfer(
      reader: reader,
      writer: writer,
      tracks: [
        RecordingAssetTransfer.Track(input: videoInput, output: videoOutput, name: "video"),
        RecordingAssetTransfer.Track(input: audioInput, output: audioOutput, name: "audio"),
      ]
    )
    try await transfer.run()
    return true
  }

  private static func linearPCMAudioSettings() -> [String: Any] {
    [
      AVFormatIDKey: kAudioFormatLinearPCM,
      AVSampleRateKey: 48_000,
      AVNumberOfChannelsKey: 2,
      AVLinearPCMBitDepthKey: 32,
      AVLinearPCMIsFloatKey: true,
      AVLinearPCMIsBigEndianKey: false,
      AVLinearPCMIsNonInterleaved: false,
    ]
  }

  private static func encodedAudioSettings() -> [String: Any] {
    [
      AVFormatIDKey: kAudioFormatMPEG4AAC,
      AVSampleRateKey: 48_000,
      AVNumberOfChannelsKey: 2,
      AVEncoderBitRateKey: 192_000,
    ]
  }
}

/// Pumps the compressed video and decoded audio concurrently. AVAssetWriter applies
/// back-pressure independently to each input, so serially draining the tracks can deadlock.
private final class RecordingAssetTransfer: @unchecked Sendable {
  struct Track: @unchecked Sendable {
    let input: AVAssetWriterInput
    let output: AVAssetReaderOutput
    let name: String
  }

  private let reader: AVAssetReader
  private let writer: AVAssetWriter
  private let tracks: [Track]
  private let stateLock = NSLock()
  private var completedTrackIds = Set<ObjectIdentifier>()
  private var terminal = false
  private var continuation: CheckedContinuation<Void, Error>?

  init(reader: AVAssetReader, writer: AVAssetWriter, tracks: [Track]) {
    self.reader = reader
    self.writer = writer
    self.tracks = tracks
  }

  func run() async throws {
    try await withCheckedThrowingContinuation { continuation in
      stateLock.lock()
      self.continuation = continuation
      stateLock.unlock()

      guard writer.startWriting() else {
        fail("Unable to start the final recording writer: \(writerErrorDescription())")
        return
      }
      guard reader.startReading() else {
        writer.cancelWriting()
        fail("Unable to read the completed recording: \(readerErrorDescription())")
        return
      }

      writer.startSession(atSourceTime: .zero)
      for (index, track) in tracks.enumerated() {
        let transferQueue = DispatchQueue(
          label: "capture-service.audio-mix.\(track.name).\(index)",
          qos: .userInitiated
        )
        track.input.requestMediaDataWhenReady(on: transferQueue) { [weak self] in
          self?.drain(track)
        }
      }
    }
  }

  private func drain(_ track: Track) {
    guard !isTerminal else { return }

    while track.input.isReadyForMoreMediaData {
      guard !isTerminal else { return }
      guard let sampleBuffer = track.output.copyNextSampleBuffer() else {
        track.input.markAsFinished()
        completeTrack(track)
        return
      }
      guard track.input.append(sampleBuffer) else {
        fail(
          "Unable to copy the \(track.name) track into the final recording: \(writerErrorDescription())"
        )
        return
      }
    }
  }

  private var isTerminal: Bool {
    stateLock.lock()
    defer { stateLock.unlock() }
    return terminal
  }

  private func completeTrack(_ track: Track) {
    stateLock.lock()
    guard !terminal else {
      stateLock.unlock()
      return
    }
    let inserted = completedTrackIds.insert(ObjectIdentifier(track.input)).inserted
    guard inserted else {
      stateLock.unlock()
      return
    }
    let allTracksCompleted = completedTrackIds.count == tracks.count
    if allTracksCompleted { terminal = true }
    stateLock.unlock()

    guard allTracksCompleted else { return }
    guard reader.status != .failed else {
      finishWithFailure("Unable to read the completed recording: \(readerErrorDescription())")
      return
    }

    writer.finishWriting { [weak self] in
      guard let self else { return }
      if self.writer.status == .completed {
        self.resumeContinuation(with: .success(()))
      } else {
        self.finishWithFailure(
          "Unable to finalize the mixed recording: \(self.writerErrorDescription())"
        )
      }
    }
  }

  private func fail(_ message: String) {
    stateLock.lock()
    guard !terminal else {
      stateLock.unlock()
      return
    }
    terminal = true
    stateLock.unlock()

    reader.cancelReading()
    writer.cancelWriting()
    finishWithFailure(message)
  }

  private func finishWithFailure(_ message: String) {
    resumeContinuation(
      with: .failure(NativeServiceError.fileFinalizationFailed(message))
    )
  }

  private func resumeContinuation(with result: Result<Void, Error>) {
    stateLock.lock()
    let continuation = continuation
    self.continuation = nil
    stateLock.unlock()
    continuation?.resume(with: result)
  }

  private func readerErrorDescription() -> String {
    reader.error?.localizedDescription ?? "The media reader failed without an error."
  }

  private func writerErrorDescription() -> String {
    writer.error?.localizedDescription ?? "The media writer failed without an error."
  }
}
#endif
