import Foundation

#if canImport(CoreGraphics)
import CoreGraphics
#endif

#if canImport(AppKit)
import AppKit
#endif

#if canImport(ScreenCaptureKit)
import ScreenCaptureKit
#endif

struct SourceDiscovery: Sendable {
  func listSources() async throws -> [NativeSource] {
#if canImport(ScreenCaptureKit)
    let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
    return contentSources(content)
#else
    return []
#endif
  }

  func capabilities() async throws -> NativeCapabilities {
#if canImport(ScreenCaptureKit)
    let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
    let displayGeometries = content.displays.map(displayGeometry)
    let width = min(displayGeometries.map(\.pixelWidth).max() ?? 3840, 3840)
    let height = min(displayGeometries.map(\.pixelHeight).max() ?? 2160, 2160)

    return NativeCapabilities(
      maxOutputWidth: width,
      maxOutputHeight: height,
      supportedProfileIds: ["compatible", "balanced", "master"],
      hardwareEncoderProfileIds: NativeEncoderCapabilities.hardwareProfileIds,
      supportedFrameRates: [30, 60],
      supportsSystemAudio: true,
      supportsMicrophone: true,
      supportsHDR: content.displays.contains(where: supportsExtendedDynamicRange)
    )
#else
    return NativeCapabilities(
      maxOutputWidth: 3840,
      maxOutputHeight: 2160,
      supportedProfileIds: ["compatible", "balanced", "master"],
      hardwareEncoderProfileIds: [],
      supportedFrameRates: [30, 60],
      supportsSystemAudio: false,
      supportsMicrophone: false,
      supportsHDR: false
    )
#endif
  }

#if canImport(ScreenCaptureKit)
  private func contentSources(_ content: SCShareableContent) -> [NativeSource] {
    let referenceDisplay = content.displays.first
    let referenceGeometry = referenceDisplay.map(displayGeometry)
    let displays = content.displays.map { display in
      let geometry = displayGeometry(display)
      return NativeSource(
        id: "display:\(display.displayID)",
        kind: "display",
        name: "Display \(display.displayID)",
        width: geometry.pixelWidth,
        height: geometry.pixelHeight,
        scaleFactor: geometry.scaleFactor,
        isAvailable: true
      )
    }
    let windows = content.windows.compactMap { window -> NativeSource? in
      guard window.windowID != 0 else { return nil }
      return NativeSource(
        id: "window:\(window.windowID)",
        kind: "window",
        name: window.title?.isEmpty == false ? window.title ?? "Window" : "Window \(window.windowID)",
        width: max(Int((window.frame.width * (referenceGeometry?.scaleFactor ?? 1)).rounded()), 2),
        height: max(Int((window.frame.height * (referenceGeometry?.scaleFactor ?? 1)).rounded()), 2),
        scaleFactor: referenceGeometry?.scaleFactor,
        isAvailable: window.isOnScreen
      )
    }
    let applications = content.applications.map { application in
      let applicationIdentifier = application.bundleIdentifier.isEmpty
        ? String(application.processID)
        : application.bundleIdentifier
      return NativeSource(
        id: "application:\(applicationIdentifier)",
        kind: "application",
        name: application.applicationName.isEmpty ? applicationIdentifier : application.applicationName,
        // Application filters are rendered from a display. Use that display's pixel envelope
        // so the application layer can validate a request before the native stream starts.
        width: referenceGeometry?.pixelWidth,
        height: referenceGeometry?.pixelHeight,
        scaleFactor: referenceGeometry?.scaleFactor,
        isAvailable: true
      )
    }

    return displays + windows + applications
  }

  private func displayGeometry(
    _ display: SCDisplay
  ) -> (pixelWidth: Int, pixelHeight: Int, scaleFactor: Double) {
#if canImport(CoreGraphics)
    if let mode = CGDisplayCopyDisplayMode(display.displayID), display.width > 0 {
      return (
        pixelWidth: mode.pixelWidth,
        pixelHeight: mode.pixelHeight,
        scaleFactor: Double(mode.pixelWidth) / Double(display.width)
      )
    }
#else
    _ = display
#endif
    return (pixelWidth: display.width, pixelHeight: display.height, scaleFactor: 1)
  }

  private func supportsExtendedDynamicRange(_ display: SCDisplay) -> Bool {
#if canImport(AppKit)
    guard
      let screen = NSScreen.screens.first(where: { screen in
        (screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? CGDirectDisplayID)
          == display.displayID
      })
    else {
      return false
    }

    return screen.maximumPotentialExtendedDynamicRangeColorComponentValue > 1.0
#else
    _ = display
    return false
#endif
  }
#endif
}
