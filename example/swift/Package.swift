// swift-tools-version: 5.10
import PackageDescription

let package = Package(
  name: "ChatExample",
  platforms: [.macOS(.v11), .iOS(.v14)],
  dependencies: [
    .package(path: "schema"),
    .package(path: "hrpc"),
    .package(url: "https://github.com/holepunchto/bare-rpc-swift", branch: "main")
  ],
  targets: [
    .executableTarget(
      name: "ChatExample",
      dependencies: [
        .product(name: "Schema", package: "schema"),
        .product(name: "HRPC", package: "hrpc"),
        .product(name: "BareRPC", package: "bare-rpc-swift")
      ],
      path: "Sources"
    )
  ]
)
