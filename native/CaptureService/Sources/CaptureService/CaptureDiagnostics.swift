import Foundation

#if canImport(CoreMedia)
import CoreMedia
#endif

enum NativeSampleKind: Sendable {
  case video
  case audio
  case microphone
}

struct CaptureDiagnosticsSummary: Sendable, Equatable {
  let capturedFrames: Int
  let encodedFrames: Int
  let droppedFrames: Int
  let systemAudioSamples: Int
  let microphoneSamples: Int
  let averageFileWriteBytesPerSecond: Double
  let peakFileWriteBytesPerSecond: Double
}

final class CaptureDiagnostics: @unchecked Sendable {
  private let lock = NSLock()
  private let maxPendingSamples: Int
  private var pendingVideoSamples = 0
  private var pendingAudioSamples = 0
  private var capturedFrames = 0
  private var droppedFrames = 0
  private var lateSamples = 0
  private var encodedFrames = 0
  private var processedSampleBytes: Int64 = 0
  private var systemAudioSamples = 0
  private var microphoneSamples = 0
  private var peakFileWriteBytesPerSecond = 0.0
  private var lastFileSizeBytes: Int64 = 0
  private var lastFileSizeSampleAt: Double?
  private var pausedDurationMs = 0.0
  private var writerError: String?
  private var partialOutputPath: String?
  private var recordingPaused = false
  private var lastVideoTimestamp: Double?
  private var lastAudioTimestamp: Double?

  init(maxPendingSamples: Int = 120) {
    self.maxPendingSamples = max(1, maxPendingSamples)
  }

  func beginRecording(at: Double = ProcessInfo.processInfo.systemUptime) {
    lock.lock()
    pendingVideoSamples = 0
    pendingAudioSamples = 0
    capturedFrames = 0
    droppedFrames = 0
    lateSamples = 0
    encodedFrames = 0
    processedSampleBytes = 0
    systemAudioSamples = 0
    microphoneSamples = 0
    peakFileWriteBytesPerSecond = 0
    lastFileSizeBytes = 0
    lastFileSizeSampleAt = at
    pausedDurationMs = 0
    writerError = nil
    partialOutputPath = nil
    recordingPaused = false
    lastVideoTimestamp = nil
    lastAudioTimestamp = nil
    lock.unlock()
  }

  func record(sampleKind: NativeSampleKind, timestamp: Double?, isValid: Bool) {
    lock.lock()
    defer { lock.unlock() }

    guard !recordingPaused else { return }

    guard isValid else {
      if sampleKind == .video {
        droppedFrames += 1
      } else {
        lateSamples += 1
      }
      return
    }

    if sampleKind == .video {
      capturedFrames += 1
      guard pendingVideoSamples < maxPendingSamples else {
        droppedFrames += 1
        return
      }
      pendingVideoSamples += 1
    } else {
      guard pendingAudioSamples < maxPendingSamples else {
        lateSamples += 1
        return
      }
      pendingAudioSamples += 1
    }

    if timestamp == nil {
      lateSamples += 1
    } else if sampleKind == .video {
      if let lastVideoTimestamp, timestamp! < lastVideoTimestamp {
        lateSamples += 1
      }
      lastVideoTimestamp = timestamp
    } else {
      if let lastAudioTimestamp, timestamp! < lastAudioTimestamp {
        lateSamples += 1
      }
      lastAudioTimestamp = timestamp
    }

    // Phase 5 will consume these summaries into the encoder. The immediate decrement keeps
    // diagnostics bounded while still preserving invalid, dropped, and late-sample counters.
    if sampleKind == .video {
      pendingVideoSamples -= 1
    } else {
      pendingAudioSamples -= 1
    }
  }

  func recordWriterDrop(sampleKind: NativeSampleKind) {
    lock.lock()
    defer { lock.unlock() }

    if sampleKind == .video {
      droppedFrames += 1
    } else {
      lateSamples += 1
    }
  }

  func recordEncodedSample(sampleKind: NativeSampleKind) {
    lock.lock()
    defer { lock.unlock() }

    switch sampleKind {
    case .video:
      encodedFrames += 1
    case .audio:
      systemAudioSamples += 1
    case .microphone:
      microphoneSamples += 1
    }
  }

  func recordFileSize(bytes: Int64, at: Double = ProcessInfo.processInfo.systemUptime) {
    lock.lock()
    defer { lock.unlock() }

    let safeBytes = max(0, bytes)
    if let lastFileSizeSampleAt {
      let elapsed = at - lastFileSizeSampleAt
      let writtenBytes = safeBytes - lastFileSizeBytes
      if elapsed > 0, writtenBytes >= 0 {
        peakFileWriteBytesPerSecond = max(
          peakFileWriteBytesPerSecond,
          Double(writtenBytes) / elapsed
        )
      }
    }
    processedSampleBytes = safeBytes
    lastFileSizeBytes = safeBytes
    lastFileSizeSampleAt = at
  }

  func completedSummary(fileSizeBytes: Int64, durationMs: Double) -> CaptureDiagnosticsSummary {
    recordFileSize(bytes: fileSizeBytes)
    lock.lock()
    defer { lock.unlock() }

    let durationSeconds = max(0, durationMs) / 1_000
    let averageRate = durationSeconds > 0 ? Double(max(0, fileSizeBytes)) / durationSeconds : 0
    peakFileWriteBytesPerSecond = max(peakFileWriteBytesPerSecond, averageRate)
    return CaptureDiagnosticsSummary(
      capturedFrames: capturedFrames,
      encodedFrames: encodedFrames,
      droppedFrames: droppedFrames,
      systemAudioSamples: systemAudioSamples,
      microphoneSamples: microphoneSamples,
      averageFileWriteBytesPerSecond: averageRate,
      peakFileWriteBytesPerSecond: peakFileWriteBytesPerSecond
    )
  }

  func setPauseDuration(milliseconds: Double) {
    lock.lock()
    pausedDurationMs = max(0, milliseconds)
    lock.unlock()
  }

  func setPaused(_ paused: Bool) {
    lock.lock()
    recordingPaused = paused
    lock.unlock()
  }

  func setWriterError(_ message: String?, partialOutputPath: String?) {
    lock.lock()
    writerError = message
    self.partialOutputPath = partialOutputPath
    lock.unlock()
  }

#if canImport(CoreMedia)
  func record(sampleBuffer: CMSampleBuffer, sampleKind: NativeSampleKind) {
    let timestamp = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
    let seconds = timestamp.isValid ? CMTimeGetSeconds(timestamp) : nil
    record(
      sampleKind: sampleKind,
      timestamp: seconds?.isFinite == true ? seconds : nil,
      isValid: CMSampleBufferIsValid(sampleBuffer)
    )
  }
#endif

  func health(state: String, lastHeartbeatAt: Double) -> NativeHealth {
    lock.lock()
    defer { lock.unlock() }

    return NativeHealth(
      state: state,
      lastHeartbeatAt: lastHeartbeatAt,
      droppedFrames: droppedFrames,
      lateSamples: lateSamples,
      pendingVideoSamples: pendingVideoSamples,
      pendingAudioSamples: pendingAudioSamples,
      encodedFrames: encodedFrames,
      processedSampleBytes: processedSampleBytes,
      pausedDurationMs: pausedDurationMs,
      writerError: writerError,
      partialOutputPath: partialOutputPath
    )
  }
}
