import Foundation
import OSLog

actor CaptureService {
  private let logger = Logger(subsystem: "com.screenrecorder.capture-service", category: "service")
  private let permissions = PermissionInspector()
  private let discovery = SourceDiscovery()
  private let diagnostics = CaptureDiagnostics()
  private let streamCoordinator: CaptureStreamCoordinator
  private var configuration: CaptureConfiguration?
  private var state = "idle"
  private var lastHeartbeatAt = Date().timeIntervalSince1970
  private var shouldExit = false

  init() {
    streamCoordinator = CaptureStreamCoordinator(diagnostics: diagnostics)
  }

  func handle(_ request: NativeRequest) async -> NativeResponse {
    lastHeartbeatAt = Date().timeIntervalSince1970

    do {
      guard request.protocolVersion == nativeProtocolVersion else {
        throw NativeServiceError.unsupportedProtocol(request.protocolVersion)
      }

      let data = try await dispatch(request)
      return NativeResponse(
        protocolVersion: nativeProtocolVersion,
        serviceVersion: nativeServiceVersion,
        requestId: request.requestId,
        command: request.command,
        ok: true,
        data: data,
        error: nil
      )
    } catch {
      logger.error("Command failed: \(request.command, privacy: .public)")
      return makeErrorResponse(for: error, request: request)
    }
  }

  func handleLine(_ line: String) async -> NativeResponse {
    do {
      let request = try JSONDecoder().decode(NativeRequest.self, from: Data(line.utf8))
      return await handle(request)
    } catch {
      return makeErrorResponse(for: error, request: nil)
    }
  }

  func shutdown() async {
    guard !shouldExit else { return }
    shouldExit = true
    try? await streamCoordinator.stop()
    state = "stopped"
  }

  func isExitRequested() -> Bool {
    shouldExit
  }

  private func dispatch(_ request: NativeRequest) async throws -> JSONValue {
    switch request.command {
    case "hello":
      _ = try decodePayload(HelloPayload.self, from: request.payload)
      return try encodePayload(
        HelloResponse(
          serviceVersion: nativeServiceVersion,
          protocolVersion: nativeProtocolVersion,
          capabilities: [
            "hello",
            "getCapabilities",
            "listSources",
            "getPermissions",
            "requestPermissions",
            "configureCapture",
            "startCapture",
            "stopCapture",
            "getHealth",
            "shutdown",
          ]
        )
      )

    case "getCapabilities":
      return try encodePayload(await discovery.capabilities())

    case "listSources":
      return try encodePayload(await discovery.listSources())

    case "getPermissions":
      return try encodePayload(permissions.inspect())

    case "requestPermissions":
      let payload = try decodePayload(RequestPermissionsPayload.self, from: request.payload)
      return try encodePayload(await permissions.request(microphone: payload.microphone))

    case "configureCapture":
      let payload = try decodePayload(CaptureConfigurationPayload.self, from: request.payload)
      let validated = try CaptureConfiguration(payload: payload)
      configuration = validated
      streamCoordinator.configure(validated)
      state = "prepared"
      return try encodePayload(validated)

    case "startCapture":
      guard let configuration else {
        throw NativeServiceError.invalidConfiguration("Capture must be configured before it starts.")
      }
      let currentPermissions = permissions.inspect()
      guard currentPermissions.screenRecording == .granted else {
        throw NativeServiceError.permissionDenied("Screen Recording permission is required before capture starts.")
      }
      if configuration.microphone, currentPermissions.microphone != .granted {
        throw NativeServiceError.permissionDenied("Microphone permission is required for microphone capture.")
      }
      state = "capturing"
      do {
        try await streamCoordinator.start()
      } catch {
        state = "failed"
        throw error
      }
      return try encodePayload(health())

    case "stopCapture":
      state = "stopping"
      try await streamCoordinator.stop()
      state = "idle"
      return try encodePayload(health())

    case "getHealth", "heartbeat":
      return try encodePayload(health())

    case "shutdown":
      await shutdown()
      return try encodePayload(Acknowledgement(status: "stopped"))

    default:
      throw NativeServiceError.unsupportedCommand(request.command)
    }
  }

  private func health() -> NativeHealth {
    diagnostics.health(state: state, lastHeartbeatAt: lastHeartbeatAt)
  }
}

struct RequestPermissionsPayload: Codable, Sendable {
  let microphone: Bool
}

struct Acknowledgement: Codable, Sendable {
  let status: String
}
