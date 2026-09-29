import Foundation

let nativeProtocolVersion = 1
let nativeServiceVersion = "0.1.0"

enum JSONValue: Codable, Equatable, Sendable {
  case object([String: JSONValue])
  case array([JSONValue])
  case string(String)
  case number(Double)
  case boolean(Bool)
  case null

  init(from decoder: Decoder) throws {
    let container = try decoder.singleValueContainer()

    if container.decodeNil() {
      self = .null
    } else if let value = try? container.decode(Bool.self) {
      self = .boolean(value)
    } else if let value = try? container.decode(Double.self) {
      self = .number(value)
    } else if let value = try? container.decode(String.self) {
      self = .string(value)
    } else if let value = try? container.decode([String: JSONValue].self) {
      self = .object(value)
    } else if let value = try? container.decode([JSONValue].self) {
      self = .array(value)
    } else {
      throw NativeServiceError.invalidRequest("Unsupported JSON value.")
    }
  }

  func encode(to encoder: Encoder) throws {
    var container = encoder.singleValueContainer()

    switch self {
    case .object(let value):
      try container.encode(value)
    case .array(let value):
      try container.encode(value)
    case .string(let value):
      try container.encode(value)
    case .number(let value):
      try container.encode(value)
    case .boolean(let value):
      try container.encode(value)
    case .null:
      try container.encodeNil()
    }
  }
}

struct NativeRequest: Codable, Sendable {
  let protocolVersion: Int
  let requestId: String
  let command: String
  let payload: JSONValue?
}

struct NativeResponse: Codable, Sendable {
  let protocolVersion: Int
  let serviceVersion: String
  let requestId: String
  let command: String
  let ok: Bool
  let data: JSONValue?
  let error: NativeError?
}

struct NativeEvent: Codable, Sendable {
  let protocolVersion: Int
  let serviceVersion: String
  let eventId: String
  let type: String
  let data: JSONValue
}

struct NativeError: Codable, Sendable, Equatable {
  let code: String
  let message: String
  let details: [String: JSONValue]?
}

enum NativeServiceError: Error, LocalizedError, Sendable {
  case invalidRequest(String)
  case unsupportedProtocol(Int)
  case unsupportedCommand(String)
  case permissionDenied(String)
  case invalidConfiguration(String)
  case sourceUnavailable(String)
  case captureFailure(String)
  case encodingUnavailable(String)
  case fileFinalizationFailed(String)
  case recordingInterrupted(String)
  case internalFailure(String)

  var code: String {
    switch self {
    case .invalidRequest:
      return "INVALID_REQUEST"
    case .unsupportedProtocol:
      return "UNSUPPORTED_PROTOCOL"
    case .unsupportedCommand:
      return "UNSUPPORTED_COMMAND"
    case .permissionDenied:
      return "PERMISSION_DENIED"
    case .invalidConfiguration:
      return "INVALID_CONFIGURATION"
    case .sourceUnavailable:
      return "SOURCE_UNAVAILABLE"
    case .captureFailure:
      return "CAPTURE_FAILURE"
    case .encodingUnavailable:
      return "ENCODING_UNAVAILABLE"
    case .fileFinalizationFailed:
      return "FILE_FINALIZATION_FAILED"
    case .recordingInterrupted:
      return "RECORDING_INTERRUPTED"
    case .internalFailure:
      return "INTERNAL_FAILURE"
    }
  }

  var errorDescription: String? {
    switch self {
    case .invalidRequest(let message),
      .permissionDenied(let message),
      .invalidConfiguration(let message),
      .sourceUnavailable(let message),
      .captureFailure(let message),
      .encodingUnavailable(let message),
      .fileFinalizationFailed(let message),
      .recordingInterrupted(let message),
      .internalFailure(let message):
      return message
    case .unsupportedProtocol(let version):
      return "Unsupported protocol version: \(version)."
    case .unsupportedCommand(let command):
      return "Unsupported command: \(command)."
    }
  }

  var details: [String: JSONValue]? {
    switch self {
    case .unsupportedProtocol(let version):
      return ["receivedVersion": .number(Double(version)), "supportedVersion": .number(Double(nativeProtocolVersion))]
    default:
      return nil
    }
  }
}

func decodePayload<T: Decodable>(_ type: T.Type, from value: JSONValue?) throws -> T {
  guard let value else {
    throw NativeServiceError.invalidRequest("The command payload is required.")
  }

  let data = try JSONEncoder().encode(value)
  return try JSONDecoder().decode(type, from: data)
}

func encodePayload<T: Encodable>(_ value: T) throws -> JSONValue {
  let data = try JSONEncoder().encode(value)
  return try JSONDecoder().decode(JSONValue.self, from: data)
}

func makeErrorResponse(for error: Error, request: NativeRequest?) -> NativeResponse {
  let serviceError: NativeServiceError

  if let error = error as? NativeServiceError {
    serviceError = error
  } else if let error = error as? DecodingError {
    serviceError = .invalidRequest(error.localizedDescription)
  } else {
    serviceError = .internalFailure(error.localizedDescription)
  }

  return NativeResponse(
    protocolVersion: nativeProtocolVersion,
    serviceVersion: nativeServiceVersion,
    requestId: request?.requestId ?? "unknown-request",
    command: request?.command ?? "unknown-command",
    ok: false,
    data: nil,
    error: NativeError(
      code: serviceError.code,
      message: serviceError.localizedDescription,
      details: serviceError.details
    )
  )
}
