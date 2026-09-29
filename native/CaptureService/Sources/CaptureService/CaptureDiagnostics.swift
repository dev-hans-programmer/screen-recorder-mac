import Foundation

#if canImport(CoreMedia)
import CoreMedia
#endif

enum NativeSampleKind: Sendable {
  case video
  case audio
  case microphone
}

final class CaptureDiagnostics: @unchecked Sendable {
  private let lock = NSLock()
  private let maxPendingSamples: Int
  private var pendingVideoSamples = 0
  private var pendingAudioSamples = 0
  private var droppedFrames = 0
  private var lateSamples = 0
  private var encodedFrames = 0
  private var processedSampleBytes: Int64 = 0
  private var pausedDurationMs = 0.0
  private var writerError: String?
  private var partialOutputPath: String?
  private var lastVideoTimestamp: Double?
  private var lastAudioTimestamp: Double?

  init(maxPendingSamples: Int = 120) {
    self.maxPendingSamples = max(1, maxPendingSamples)
  }

  func record(sampleKind: NativeSampleKind, timestamp: Double?, isValid: Bool) {
    lock.lock()
    defer { lock.unlock() }

    guard isValid else {
      if sampleKind == .video {
        droppedFrames += 1
      } else {
        lateSamples += 1
      }
      return
    }

    if sampleKind == .video {
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

  func recordEncodedSample(byteCount: Int64) {
    lock.lock()
    defer { lock.unlock() }

    encodedFrames += 1
    processedSampleBytes += max(0, byteCount)
  }

  func setPauseDuration(milliseconds: Double) {
    lock.lock()
    pausedDurationMs = max(0, milliseconds)
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
