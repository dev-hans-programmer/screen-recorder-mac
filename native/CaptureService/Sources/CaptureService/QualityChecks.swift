import Foundation

/// Framework-free native checks keep `swift run` usable on CI images that install only Apple's
/// Command Line Tools, where XCTest and Swift Testing modules are not shipped.
public enum CaptureServiceQualityChecks {
  public static func run() async throws {
    try await checkProtocolParsing()
    try checkConfigurationValidation()
    try await checkStateTransitions()
    try await checkWriterFinalization()
  }

  private static func require(_ condition: @autoclosure () -> Bool, _ message: String) throws {
    guard condition() else { throw NativeServiceError.internalFailure(message) }
  }

  private static func configurationPayload(
    width: Int = 1920,
    height: Int = 1080,
    frameRate: Int = 60,
    profileId: String = "compatible",
    outputDirectory: String = NSTemporaryDirectory()
  ) -> CaptureConfigurationPayload {
    CaptureConfigurationPayload(
      sourceId: "display:1",
      sourceKind: "display",
      region: nil,
      width: width,
      height: height,
      frameRate: frameRate,
      profileId: profileId,
      outputDirectory: outputDirectory,
      showsCursor: true,
      showsMouseClicks: false,
      systemAudio: false,
      microphone: false,
      microphoneDeviceId: nil
    )
  }

  private static func checkProtocolParsing() async throws {
    let service = CaptureService()
    let hello = await service.handleLine(
      #"{"protocolVersion":1,"requestId":"hello-1","command":"hello","payload":{"clientVersion":"test"}}"#
    )
    try require(hello.ok && hello.requestId == "hello-1", "Valid hello parsing failed.")

    let future = await service.handle(
      NativeRequest(
        protocolVersion: 999,
        requestId: "future-1",
        command: "hello",
        payload: .object(["clientVersion": .string("test")])
      )
    )
    try require(future.error?.code == "UNSUPPORTED_PROTOCOL", "Future protocol was accepted.")

    let malformed = await service.handleLine("not-json")
    try require(malformed.error?.code == "INVALID_REQUEST", "Malformed JSON was accepted.")
  }

  private static func checkConfigurationValidation() throws {
    _ = try CaptureConfiguration(payload: configurationPayload())
    try requireConfigurationFailure(configurationPayload(width: 1919))
    try requireConfigurationFailure(configurationPayload(frameRate: 120))
    try requireConfigurationFailure(configurationPayload(profileId: "raw"))
  }

  private static func requireConfigurationFailure(
    _ payload: CaptureConfigurationPayload
  ) throws {
    do {
      _ = try CaptureConfiguration(payload: payload)
      throw NativeServiceError.internalFailure("Invalid capture configuration was accepted.")
    } catch let error as NativeServiceError where error.code == "INVALID_CONFIGURATION" {
      return
    }
  }

  private static func checkStateTransitions() async throws {
    let service = CaptureService()
    let pause = await service.handle(
      NativeRequest(
        protocolVersion: nativeProtocolVersion,
        requestId: "pause-idle",
        command: "pauseCapture",
        payload: .null
      )
    )
    let resume = await service.handle(
      NativeRequest(
        protocolVersion: nativeProtocolVersion,
        requestId: "resume-idle",
        command: "resumeCapture",
        payload: .null
      )
    )
    try require(
      pause.error?.code == "INVALID_CONFIGURATION" &&
        resume.error?.code == "INVALID_CONFIGURATION",
      "Idle pause/resume transition was accepted."
    )
  }

  private static func checkWriterFinalization() async throws {
    let outputDirectory = FileManager.default.temporaryDirectory
      .appendingPathComponent("capture-service-writer-test-\(UUID().uuidString)", isDirectory: true)
    defer { try? FileManager.default.removeItem(at: outputDirectory) }
    let configuration = try CaptureConfiguration(
      payload: configurationPayload(outputDirectory: outputDirectory.path)
    )
    let writer = try RecordingAssetWriter(
      configuration: configuration,
      diagnostics: CaptureDiagnostics()
    )

    do {
      _ = try await writer.finish()
      throw NativeServiceError.internalFailure("Writer finalized without a video frame.")
    } catch let error as NativeServiceError where error.code == "CAPTURE_FAILURE" {
      let files = try FileManager.default.contentsOfDirectory(atPath: outputDirectory.path)
      try require(
        !files.contains { $0.hasSuffix(".mp4") && !$0.hasSuffix(".partial") },
        "Writer exposed an incomplete final file."
      )
    }
  }
}
