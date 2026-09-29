import Foundation
import OSLog

public struct NativeCommandServer {
  private let service: CaptureService
  private let logger = Logger(subsystem: "com.screenrecorder.capture-service", category: "protocol")

  public init() {
    self.service = CaptureService()
  }

  init(service: CaptureService) {
    self.service = service
  }

  public func run() async {
    while let line = readLine(strippingNewline: true) {
      let response = await service.handleLine(line)
      write(response)

      if await service.isExitRequested() {
        break
      }
    }

    await service.shutdown()
  }

  private func write(_ response: NativeResponse) {
    do {
      let data = try JSONEncoder().encode(response)
      FileHandle.standardOutput.write(data)
      FileHandle.standardOutput.write(Data([0x0a]))
    } catch {
      logger.error("Unable to encode response: \(error.localizedDescription, privacy: .public)")
    }
  }
}
