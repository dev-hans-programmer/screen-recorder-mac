import Foundation

struct HelloPayload: Codable, Sendable {
  let clientVersion: String?
}

struct HelloResponse: Codable, Sendable {
  let serviceVersion: String
  let protocolVersion: Int
  let capabilities: [String]
}

struct NativeSource: Codable, Sendable, Equatable {
  let id: String
  let kind: String
  let name: String
  let width: Int?
  let height: Int?
  let scaleFactor: Double?
  let isAvailable: Bool
}

enum NativePermissionState: String, Codable, Sendable {
  case notDetermined = "not-determined"
  case granted
  case denied
  case restricted
}

struct NativePermissions: Codable, Sendable, Equatable {
  let screenRecording: NativePermissionState
  let microphone: NativePermissionState
}

struct NativeCapabilities: Codable, Sendable, Equatable {
  let maxOutputWidth: Int
  let maxOutputHeight: Int
  let supportedProfileIds: [String]
  let supportedFrameRates: [Int]
  let supportsSystemAudio: Bool
  let supportsMicrophone: Bool
  let supportsHDR: Bool
}

struct CaptureRegionPayload: Codable, Sendable, Equatable {
  let x: Double
  let y: Double
  let width: Double
  let height: Double
}

struct CaptureConfigurationPayload: Codable, Sendable, Equatable {
  let sourceId: String
  let sourceKind: String
  let region: CaptureRegionPayload?
  let width: Int
  let height: Int
  let frameRate: Int
  let showsCursor: Bool
  let showsMouseClicks: Bool
  let systemAudio: Bool
  let microphone: Bool
  let microphoneDeviceId: String?
}

struct CaptureConfiguration: Codable, Sendable, Equatable {
  let sourceId: String
  let sourceKind: String
  let region: CaptureRegionPayload?
  let width: Int
  let height: Int
  let frameRate: Int
  let showsCursor: Bool
  let showsMouseClicks: Bool
  let systemAudio: Bool
  let microphone: Bool
  let microphoneDeviceId: String?

  private init(
    sourceId: String,
    sourceKind: String,
    region: CaptureRegionPayload?,
    width: Int,
    height: Int,
    frameRate: Int,
    showsCursor: Bool,
    showsMouseClicks: Bool,
    systemAudio: Bool,
    microphone: Bool,
    microphoneDeviceId: String?
  ) {
    self.sourceId = sourceId
    self.sourceKind = sourceKind
    self.region = region
    self.width = width
    self.height = height
    self.frameRate = frameRate
    self.showsCursor = showsCursor
    self.showsMouseClicks = showsMouseClicks
    self.systemAudio = systemAudio
    self.microphone = microphone
    self.microphoneDeviceId = microphoneDeviceId
  }

  init(payload: CaptureConfigurationPayload) throws {
    guard !payload.sourceId.isEmpty else {
      throw NativeServiceError.invalidConfiguration("A capture source id is required.")
    }
    guard ["display", "window", "application", "region"].contains(payload.sourceKind) else {
      throw NativeServiceError.invalidConfiguration("Unsupported capture source kind.")
    }
    guard payload.width >= 2, payload.height >= 2, payload.width <= 7680, payload.height <= 4320 else {
      throw NativeServiceError.invalidConfiguration("Capture dimensions must be between 2x2 and 7680x4320.")
    }
    guard payload.width.isMultiple(of: 2), payload.height.isMultiple(of: 2) else {
      throw NativeServiceError.invalidConfiguration("Capture dimensions must be even values.")
    }
    guard payload.frameRate == 30 || payload.frameRate == 60 else {
      throw NativeServiceError.invalidConfiguration("Frame rate must be 30 or 60 FPS.")
    }
    if payload.microphone, payload.microphoneDeviceId?.isEmpty != false {
      throw NativeServiceError.invalidConfiguration("A microphone device id is required when microphone capture is enabled.")
    }
    if let region = payload.region {
      guard region.width >= 2, region.height >= 2 else {
        throw NativeServiceError.invalidConfiguration("Capture regions must be at least 2x2 pixels.")
      }
    }

    self = CaptureConfiguration(
      sourceId: payload.sourceId,
      sourceKind: payload.sourceKind,
      region: payload.region,
      width: payload.width,
      height: payload.height,
      frameRate: payload.frameRate,
      showsCursor: payload.showsCursor,
      showsMouseClicks: payload.showsMouseClicks,
      systemAudio: payload.systemAudio,
      microphone: payload.microphone,
      microphoneDeviceId: payload.microphoneDeviceId
    )
  }
}

struct NativeHealth: Codable, Sendable, Equatable {
  let state: String
  let lastHeartbeatAt: Double
  let droppedFrames: Int
  let lateSamples: Int
  let pendingVideoSamples: Int
  let pendingAudioSamples: Int
}
