import OSLog

enum NativeLog {
  private static let subsystem = "com.screenrecorder.capture-service"

  static let capture = Logger(subsystem: subsystem, category: "capture")
  static let encoding = Logger(subsystem: subsystem, category: "encoding")
  static let audio = Logger(subsystem: subsystem, category: "audio")
  static let permissions = Logger(subsystem: subsystem, category: "permissions")
  static let protocolLog = Logger(subsystem: subsystem, category: "protocol")
}
