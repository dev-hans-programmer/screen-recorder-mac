import Foundation

public enum CaptureServiceSmokeChecks {
  public static func run() throws {
    let value: JSONValue = .object([
      "name": .string("CaptureService"),
      "version": .number(1),
      "ready": .boolean(true),
    ])
    let encoded = try JSONEncoder().encode(value)
    let decoded = try JSONDecoder().decode(JSONValue.self, from: encoded)

    guard decoded == value else {
      throw SmokeCheckError.failed("JSON value round trip failed.")
    }

    let configuration = CaptureConfigurationPayload(
      sourceId: "display:1",
      sourceKind: "display",
      region: nil,
      width: 1920,
      height: 1080,
      frameRate: 60,
      profileId: "compatible",
      outputDirectory: NSTemporaryDirectory(),
      showsCursor: true,
      showsMouseClicks: false,
      systemAudio: false,
      microphone: false,
      microphoneDeviceId: nil
    )
    let validatedConfiguration = try CaptureConfiguration(payload: configuration)

    guard validatedConfiguration.profileId == .compatible else {
      throw SmokeCheckError.failed("Compatible profile validation failed.")
    }

    for profile in NativeRecordingProfileId.allCases {
      let profileConfiguration = CaptureConfigurationPayload(
        sourceId: "display:1",
        sourceKind: "display",
        region: nil,
        width: 3840,
        height: 2160,
        frameRate: 60,
        profileId: profile.rawValue,
        outputDirectory: NSTemporaryDirectory(),
        showsCursor: true,
        showsMouseClicks: false,
        systemAudio: false,
        microphone: false,
        microphoneDeviceId: nil
      )
      let validatedProfile = try CaptureConfiguration(payload: profileConfiguration)
      guard validatedProfile.profileId == profile else {
        throw SmokeCheckError.failed("Recording profile validation failed for \(profile.rawValue).")
      }
    }

    let diagnostics = CaptureDiagnostics(maxPendingSamples: 2)
    diagnostics.record(sampleKind: .video, timestamp: nil, isValid: false)
    let health = diagnostics.health(state: "capturing", lastHeartbeatAt: 1)

    guard health.droppedFrames == 1, health.pendingVideoSamples == 0 else {
      throw SmokeCheckError.failed("Diagnostics invariant failed.")
    }
  }
}

enum SmokeCheckError: Error, LocalizedError {
  case failed(String)

  var errorDescription: String? {
    switch self {
    case .failed(let message):
      return message
    }
  }
}
