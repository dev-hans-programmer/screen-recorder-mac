import CaptureServiceCore
import Foundation

@main
struct CaptureServiceCoreTestCommand {
  static func main() async {
    do {
      try await CaptureServiceQualityChecks.run()
      print("CaptureService core tests passed.")
    } catch {
      fputs("CaptureService core tests failed: \(error.localizedDescription)\n", stderr)
      exit(1)
    }
  }
}
