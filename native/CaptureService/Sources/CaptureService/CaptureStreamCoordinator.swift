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

  init(diagnostics: CaptureDiagnostics) {
    self.diagnostics = diagnostics
  }

  func configure(_ configuration: CaptureConfiguration) {
    self.configuration = configuration
  }

  func start() async throws {
    guard let configuration else {
      throw NativeServiceError.invalidConfiguration("Capture must be configured before it starts.")
    }

    // Source discovery and filter construction are intentionally isolated here. Phase 5 will
    // connect these bounded outputs to AVAssetWriter without moving sample buffers through IPC.
    let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
    let filter = try makeFilter(configuration: configuration, content: content)
    let streamConfiguration = SCStreamConfiguration()
    streamConfiguration.width = configuration.width
    streamConfiguration.height = configuration.height
    if let region = configuration.region {
      // Region coordinates are already normalized by the application layer. The native source
      // rectangle is applied before scaling so the encoder receives the requested output size.
      streamConfiguration.sourceRect = CGRect(
        x: region.x,
        y: region.y,
        width: region.width,
        height: region.height
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
      streamConfiguration.microphoneCaptureDeviceID = configuration.microphoneDeviceId
      streamConfiguration.captureDynamicRange = .SDR
    }
    streamConfiguration.queueDepth = 5
    streamConfiguration.capturesAudio = configuration.systemAudio
    streamConfiguration.sampleRate = 48_000
    streamConfiguration.channelCount = 2

    let stream = SCStream(filter: filter, configuration: streamConfiguration, delegate: self)
    let output = CaptureStreamOutput(diagnostics: diagnostics)
    try stream.addStreamOutput(output, type: .screen, sampleHandlerQueue: DispatchQueue(label: "capture-service.video", qos: .userInitiated))

    if configuration.systemAudio {
      try stream.addStreamOutput(output, type: .audio, sampleHandlerQueue: DispatchQueue(label: "capture-service.audio", qos: .userInitiated))
    }

    self.stream = stream
    self.output = output
    try await stream.startCapture()
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

  func stop() async throws {
    guard let stream else { return }
    try await stream.stopCapture()
    self.stream = nil
    self.output = nil
  }

  func stream(_ stream: SCStream, didStopWithError error: Error) {
    NSLog("CaptureService stream stopped: %@", error.localizedDescription)
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

  func start() async throws {
    guard configuration != nil else {
      throw NativeServiceError.invalidConfiguration("Capture must be configured before it starts.")
    }
    throw NativeServiceError.captureFailure("ScreenCaptureKit is unavailable in this Swift SDK.")
  }

  func stop() async throws {}
}
#endif
