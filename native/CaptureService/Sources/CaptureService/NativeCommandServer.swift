import Foundation

public struct NativeCommandServer {
  private let service: CaptureService

  public init() {
    self.service = CaptureService()
  }

  init(service: CaptureService) {
    self.service = service
  }

  public func run() async {
    let service = self.service
    let writer = NativeResponseWriter()

    // ScreenCaptureKit discovery and startup calls can occasionally take several seconds. Keep
    // reading the protocol while one request is suspended so lightweight requests such as
    // getPermissions and getHealth are not trapped behind it.
    await withTaskGroup(of: Void.self) { group in
      while let line = readLine(strippingNewline: true) {
        group.addTask {
          let response = await service.handleLine(line)
          await writer.write(response)
        }
      }
    }

    await service.shutdown()
  }
}

/// Serializes stdout writes from concurrently handled commands so each response remains one
/// complete newline-delimited JSON message.
private actor NativeResponseWriter {
  func write(_ response: NativeResponse) {
    do {
      let data = try JSONEncoder().encode(response)
      var message = data
      message.append(0x0a)
      FileHandle.standardOutput.write(message)
    } catch {
      NativeLog.protocolLog.error(
        "Unable to encode response: \(error.localizedDescription, privacy: .public)"
      )
    }
  }
}
