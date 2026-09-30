import Foundation

#if canImport(AppKit)
import AppKit
#endif

#if canImport(AVFoundation)
import AVFoundation
#endif

#if canImport(CoreAudio)
import CoreAudio
#endif

#if canImport(CoreGraphics)
import CoreGraphics
#endif

final class PermissionInspector: @unchecked Sendable {
  private let lock = NSLock()
  private var screenPermissionWasRequested: Bool
  private let screenPermissionKey = "CaptureService.screenPermissionWasRequested"
  private let screenPermissionGrantedAtLaunch: Bool
  private var screenPermissionWasRevokedAfterLaunch = false

  init() {
    screenPermissionWasRequested = UserDefaults.standard.bool(forKey: screenPermissionKey)
#if canImport(CoreGraphics)
    screenPermissionGrantedAtLaunch = CGPreflightScreenCaptureAccess()
#else
    screenPermissionGrantedAtLaunch = false
#endif
  }

  func inspect() -> NativePermissions {
    lock.lock()
    let wasRequested = screenPermissionWasRequested
    lock.unlock()
    let screenRecording = screenRecordingState(wasRequested: wasRequested)

    lock.lock()
    if screenPermissionGrantedAtLaunch, screenRecording != .granted {
      screenPermissionWasRevokedAfterLaunch = true
    }
    let requiresRestart = screenRecording == .granted &&
      (!screenPermissionGrantedAtLaunch || screenPermissionWasRevokedAfterLaunch)
    lock.unlock()

    return NativePermissions(
      screenRecording: screenRecording,
      microphone: microphoneState(),
      // ScreenCaptureKit may not see newly granted or re-granted TCC access until process restart.
      screenRecordingRequiresRestart: requiresRestart
    )
  }

  func request(microphone: Bool) async -> NativePermissions {
    markScreenPermissionRequested()

#if canImport(CoreGraphics)
    _ = CGRequestScreenCaptureAccess()
#endif

#if canImport(AVFoundation)
    if microphone, AVCaptureDevice.authorizationStatus(for: .audio) == .notDetermined {
      _ = await AVCaptureDevice.requestAccess(for: .audio)
    }
#else
    _ = microphone
#endif

    return inspect()
  }

  private func markScreenPermissionRequested() {
    lock.lock()
    screenPermissionWasRequested = true
    UserDefaults.standard.set(true, forKey: screenPermissionKey)
    lock.unlock()
  }

  private func screenRecordingState(wasRequested: Bool) -> NativePermissionState {
#if canImport(CoreGraphics)
    if CGPreflightScreenCaptureAccess() {
      return .granted
    }

    return wasRequested ? .denied : .notDetermined
#else
    return .notDetermined
#endif
  }

  private func microphoneState() -> NativePermissionState {
#if canImport(AVFoundation)
    switch AVCaptureDevice.authorizationStatus(for: .audio) {
    case .authorized:
      return .granted
    case .denied:
      return .denied
    case .restricted:
      return .restricted
    case .notDetermined:
      return .notDetermined
    @unknown default:
      return .denied
    }
#else
    return .notDetermined
#endif
  }
}
