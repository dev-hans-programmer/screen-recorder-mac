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
    let width = min(content.displays.map(\.width).max() ?? 3840, 3840)
    let height = min(content.displays.map(\.height).max() ?? 2160, 2160)

    return NativeCapabilities(
      maxOutputWidth: width,
      maxOutputHeight: height,
      supportedProfileIds: ["compatible", "balanced", "master"],
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
      supportedFrameRates: [30, 60],
      supportsSystemAudio: false,
      supportsMicrophone: false,
      supportsHDR: false
    )
#endif
  }

#if canImport(ScreenCaptureKit)
  private func contentSources(_ content: SCShareableContent) -> [NativeSource] {
    let displays = content.displays.map { display in
      let scaleFactor = displayScaleFactor(display.displayID, pixelWidth: display.width)
      return NativeSource(
        id: "display:\(display.displayID)",
        kind: "display",
        name: "Display \(display.displayID)",
        width: display.width,
        height: display.height,
        scaleFactor: scaleFactor,
        isAvailable: true
      )
    }
    let windows = content.windows.compactMap { window -> NativeSource? in
      guard window.windowID != 0 else { return nil }
      return NativeSource(
        id: "window:\(window.windowID)",
        kind: "window",
        name: window.title?.isEmpty == false ? window.title ?? "Window" : "Window \(window.windowID)",
        width: max(Int(window.frame.width), 2),
        height: max(Int(window.frame.height), 2),
        scaleFactor: nil,
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
        width: nil,
        height: nil,
        scaleFactor: nil,
        isAvailable: true
      )
    }

    return displays + windows + applications
  }

  private func displayScaleFactor(_ displayId: CGDirectDisplayID, pixelWidth: Int) -> Double? {
#if canImport(CoreGraphics)
    let bounds = CGDisplayBounds(displayId)
    guard bounds.width > 0 else { return nil }
    return Double(pixelWidth) / bounds.width
#else
    _ = displayId
    _ = pixelWidth
    return nil
#endif
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
