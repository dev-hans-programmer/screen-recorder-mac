import Foundation

#if canImport(CoreMedia)
import CoreMedia
#endif

#if canImport(CoreGraphics)
import CoreGraphics
#endif

#if canImport(ScreenCaptureKit)
import ScreenCaptureKit

final class CaptureStreamCoordinator: NSObject, SCStreamDelegate, @unchecked Sendable {
  private let diagnostics: CaptureDiagnostics
  private var stream: SCStream?
  private var configuration: CaptureConfiguration?
  private var output: CaptureStreamOutput?
  private var writer: RecordingAssetWriter?

  init(diagnostics: CaptureDiagnostics) {
    self.diagnostics = diagnostics
  }

  func configure(_ configuration: CaptureConfiguration) {
    self.configuration = configuration
  }

  func start() async throws -> NativeRecordingStart {
    guard let configuration else {
      throw NativeServiceError.invalidConfiguration("Capture must be configured before it starts.")
    }
    guard stream == nil, writer == nil else {
      throw NativeServiceError.invalidConfiguration("A capture is already in progress.")
    }

    let writer = try RecordingAssetWriter(configuration: configuration, diagnostics: diagnostics)
    NativeLog.capture.info(
      "Starting ScreenCaptureKit stream for source type \(configuration.sourceKind, privacy: .public)"
    )

    let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
    let filter = try makeFilter(configuration: configuration, content: content)
    let streamConfiguration = SCStreamConfiguration()
    streamConfiguration.width = configuration.width
    streamConfiguration.height = configuration.height
    if let region = configuration.region {
      // Electron returns physical-pixel geometry while ScreenCaptureKit's source rectangle uses
      // display points. Convert here so a Retina crop selects the same visual area the user drew.
      let scaleFactor = captureScaleFactor(configuration: configuration, content: content)
      streamConfiguration.sourceRect = CGRect(
        x: region.x / scaleFactor,
        y: region.y / scaleFactor,
        width: region.width / scaleFactor,
        height: region.height / scaleFactor
      )
    }
    streamConfiguration.minimumFrameInterval = CMTime(
      value: 1,
      timescale: CMTimeScale(configuration.frameRate)
    )
    streamConfiguration.showsCursor = configuration.showsCursor
    if #available(macOS 15.0, *) {
      streamConfiguration.showMouseClicks = configuration.showsMouseClicks
      streamConfiguration.captureMicrophone = configuration.microphone
      // A nil device id delegates microphone selection to the system default input device.
      streamConfiguration.microphoneCaptureDeviceID = configuration.microphoneDeviceId
      streamConfiguration.captureDynamicRange = .SDR
    }
    streamConfiguration.queueDepth = 5
    streamConfiguration.capturesAudio = configuration.systemAudio
    streamConfiguration.sampleRate = 48_000
    streamConfiguration.channelCount = 2

    let stream = SCStream(filter: filter, configuration: streamConfiguration, delegate: self)
    let output = CaptureStreamOutput(diagnostics: diagnostics, writer: writer)
    try stream.addStreamOutput(output, type: .screen, sampleHandlerQueue: DispatchQueue(label: "capture-service.video", qos: .userInitiated))

    if configuration.systemAudio {
      try stream.addStreamOutput(output, type: .audio, sampleHandlerQueue: DispatchQueue(label: "capture-service.audio", qos: .userInitiated))
    }

    if configuration.microphone {
      try stream.addStreamOutput(output, type: .microphone, sampleHandlerQueue: DispatchQueue(label: "capture-service.microphone", qos: .userInitiated))
    }

    self.stream = stream
    self.output = output
    self.writer = writer
    try await stream.startCapture()
    return writer.startResult
  }

  private func makeFilter(
    configuration: CaptureConfiguration,
    content: SCShareableContent
  ) throws -> SCContentFilter {
    switch configuration.sourceKind {
    case "display":
      guard
        let displayId = displayId(from: configuration.sourceId),
        let display = content.displays.first(where: { $0.displayID == displayId })
      else {
        throw NativeServiceError.sourceUnavailable("The selected display is no longer available.")
      }
      return SCContentFilter(display: display, excludingApplications: [], exceptingWindows: [])
    case "window":
      guard
        let windowId = windowId(from: configuration.sourceId),
        let window = content.windows.first(where: { $0.windowID == windowId })
      else {
        throw NativeServiceError.sourceUnavailable("The selected window is no longer available.")
      }
      return SCContentFilter(desktopIndependentWindow: window)
    case "application":
      guard
        let applicationIdentifier = applicationIdentifier(from: configuration.sourceId),
        let application = content.applications.first(where: {
          $0.bundleIdentifier == applicationIdentifier
            || String($0.processID) == applicationIdentifier
        }),
        let display = content.displays.first
      else {
        throw NativeServiceError.sourceUnavailable("The selected application is no longer available.")
      }
      return SCContentFilter(display: display, including: [application], exceptingWindows: [])
    case "region":
      let display = configuration.sourceId.hasPrefix("display:")
        ? displayId(from: configuration.sourceId).flatMap { id in
          content.displays.first(where: { $0.displayID == id })
        }
        : content.displays.first
      guard let display else {
        throw NativeServiceError.sourceUnavailable("No display is available for region capture.")
      }
      return SCContentFilter(display: display, excludingApplications: [], exceptingWindows: [])
    default:
      throw NativeServiceError.invalidConfiguration("Unsupported capture source kind.")
    }
  }

  private func displayId(from sourceId: String) -> CGDirectDisplayID? {
    parseIdentifier(sourceId, prefix: "display:").map { value in CGDirectDisplayID(value) }
  }

  private func captureScaleFactor(
    configuration: CaptureConfiguration,
    content: SCShareableContent
  ) -> Double {
    guard
      let displayId = displayId(from: configuration.sourceId),
      let display = content.displays.first(where: { $0.displayID == displayId }),
      let mode = CGDisplayCopyDisplayMode(display.displayID),
      display.width > 0
    else {
      return 1
    }
    return max(1, Double(mode.pixelWidth) / Double(display.width))
  }

  private func windowId(from sourceId: String) -> CGWindowID? {
    parseIdentifier(sourceId, prefix: "window:").map { value in CGWindowID(value) }
  }

  private func applicationIdentifier(from sourceId: String) -> String? {
    guard sourceId.hasPrefix("application:") else { return nil }
    return String(sourceId.dropFirst("application:".count))
  }

  private func parseIdentifier(_ sourceId: String, prefix: String) -> UInt32? {
    guard sourceId.hasPrefix(prefix) else { return nil }
    return UInt32(sourceId.dropFirst(prefix.count))
  }

  func stop() async throws -> NativeRecordingResult? {
    NativeLog.capture.info("Stopping ScreenCaptureKit stream")
    if let stream {
      try await stream.stopCapture()
    }

    let result = try await writer?.finish()
    self.stream = nil
    self.output = nil
    self.writer = nil
    return result
  }

  func pause() {
    writer?.pause()
  }

  func resume() {
    writer?.resume()
  }

  func recordingStart() -> NativeRecordingStart? {
    writer?.startResult
  }

  func sampleFileWriteMetrics() {
    writer?.sampleFileWriteMetrics()
  }

  func stream(_ stream: SCStream, didStopWithError error: Error) {
    NativeLog.capture.error(
      "Capture stream stopped unexpectedly: \(error.localizedDescription, privacy: .private(mask: .hash))"
    )
    writer?.interrupt(message: "The capture stream stopped unexpectedly: \(error.localizedDescription)")
  }
}
#else
final class CaptureStreamCoordinator: @unchecked Sendable {
  private var configuration: CaptureConfiguration?

  init(diagnostics: CaptureDiagnostics) {
    _ = diagnostics
  }

  func configure(_ configuration: CaptureConfiguration) {
    self.configuration = configuration
  }

  func start() async throws -> NativeRecordingStart {
    guard configuration != nil else {
      throw NativeServiceError.invalidConfiguration("Capture must be configured before it starts.")
    }
    throw NativeServiceError.captureFailure("ScreenCaptureKit is unavailable in this Swift SDK.")
  }

  func stop() async throws -> NativeRecordingResult? { nil }
  func pause() {}
  func resume() {}
  func recordingStart() -> NativeRecordingStart? { nil }
  func sampleFileWriteMetrics() {}
}
#endif
