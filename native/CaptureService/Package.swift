// swift-tools-version: 6.0

import PackageDescription

let package = Package(
  name: "CaptureService",
  platforms: [
    .macOS(.v15),
  ],
  products: [
    .executable(name: "CaptureService", targets: ["CaptureService"]),
  ],
  targets: [
    .target(
      name: "CaptureServiceCore",
      path: "Sources/CaptureService",
      swiftSettings: [
        .define("CAPTURE_SERVICE_NATIVE"),
      ]
    ),
    .executableTarget(
      name: "CaptureService",
      dependencies: ["CaptureServiceCore"],
      path: "Sources/CaptureServiceApp"
    ),
    .executableTarget(
      name: "CaptureServiceSmokeTests",
      dependencies: ["CaptureServiceCore"],
      path: "Tests/CaptureServiceSmokeTests"
    ),
  ]
)
