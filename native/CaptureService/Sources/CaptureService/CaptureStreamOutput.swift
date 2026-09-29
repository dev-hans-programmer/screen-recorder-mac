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
}
#endif
