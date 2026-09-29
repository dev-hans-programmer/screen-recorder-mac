import CaptureServiceCore
import Foundation

@main
struct CaptureServiceSmokeTests {
  static func main() {
    do {
      try CaptureServiceSmokeChecks.run()
      print("CaptureService smoke checks passed.")
    } catch {
      fputs("CaptureService smoke checks failed: \(error.localizedDescription)\n", stderr)
      exit(1)
    }
  }
}
