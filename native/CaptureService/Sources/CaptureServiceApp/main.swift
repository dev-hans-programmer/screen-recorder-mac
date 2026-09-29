import CaptureServiceCore

@main
struct CaptureServiceMain {
  static func main() async {
    await NativeCommandServer().run()
  }
}
