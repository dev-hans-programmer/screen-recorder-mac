import Foundation

#if canImport(CoreMedia)
import CoreMedia
#endif

#if canImport(ScreenCaptureKit)
import ScreenCaptureKit

final class CaptureStreamOutput: NSObject, SCStreamOutput {
  private let diagnostics: CaptureDiagnostics
  private let writer: RecordingAssetWriter

  init(diagnostics: CaptureDiagnostics, writer: RecordingAssetWriter) {
    self.diagnostics = diagnostics
    self.writer = writer
  }

  func stream(
    _ stream: SCStream,
    didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
    of type: SCStreamOutputType
  ) {
    let sampleKind: NativeSampleKind

    switch type {
    case .screen:
      guard isRecordableVideoFrame(sampleBuffer) else {
        // ScreenCaptureKit emits idle/blank/suspended status samples when no new image exists.
        // They are not lost frames and must not inflate the encoder's dropped-frame metric.
        return
      }
      sampleKind = .video
    case .audio:
      sampleKind = .audio
    case .microphone:
      sampleKind = .microphone
    @unknown default:
      return
    }

    diagnostics.record(sampleBuffer: sampleBuffer, sampleKind: sampleKind)
    writer.append(sampleBuffer: sampleBuffer, sampleKind: sampleKind)
  }

  private func isRecordableVideoFrame(_ sampleBuffer: CMSampleBuffer) -> Bool {
    guard
      let attachmentsArray = CMSampleBufferGetSampleAttachmentsArray(
        sampleBuffer,
        createIfNecessary: false
      ) as? [[SCStreamFrameInfo: Any]],
      let attachments = attachmentsArray.first,
      let statusRawValue = attachments[SCStreamFrameInfo.status] as? Int,
      let status = SCFrameStatus(rawValue: statusRawValue)
    else {
      // Older SDK/runtime combinations may not expose frame status metadata. The writer still
      // validates the sample buffer itself, so preserve compatibility when the metadata is absent.
      return true
    }

    // Idle, blank, suspended, and stopped frames do not contain a new recordable image. Passing
    // them to AVAssetWriter can produce invalid timing/data errors after a few successful frames.
    return status == .complete
  }
}
#endif
