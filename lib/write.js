'use strict'

const fs = require('fs')
const path = require('path')
const generateSwift = require('./codegen')

const BARE_RPC_SWIFT_URL = 'https://github.com/holepunchto/bare-rpc-swift'

function writeToDisk(
  hrpc,
  dir,
  { schemaPackagePath = '../schema', schemaPackageName = 'Schema', schemaPackageId = 'schema' } = {}
) {
  const root = path.resolve(dir)
  const sources = path.join(root, 'Sources')
  fs.mkdirSync(sources, { recursive: true })

  // hrpc.json — same append-only schema snapshot as JS codegen
  fs.writeFileSync(path.join(root, 'hrpc.json'), JSON.stringify(hrpc.toJSON(), null, 2) + '\n', {
    encoding: 'utf-8'
  })

  // Sources/HRPC.swift
  fs.writeFileSync(path.join(sources, 'HRPC.swift'), generateSwift(hrpc), {
    encoding: 'utf-8'
  })

  // Package.swift
  fs.writeFileSync(
    path.join(root, 'Package.swift'),
    generatePackageSwift({
      schemaPackagePath,
      schemaPackageName,
      schemaPackageId
    }),
    { encoding: 'utf-8' }
  )
}

function generatePackageSwift({ schemaPackagePath, schemaPackageName, schemaPackageId }) {
  return `// swift-tools-version: 5.10
import PackageDescription

let package = Package(
  name: "HRPC",
  platforms: [.macOS(.v11), .iOS(.v14)],
  products: [
    .library(name: "HRPC", targets: ["HRPC"])
  ],
  dependencies: [
    .package(url: "${BARE_RPC_SWIFT_URL}", branch: "main"),
    .package(path: "${schemaPackagePath.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}")
  ],
  targets: [
    .target(
      name: "HRPC",
      dependencies: [
        .product(name: "BareRPC", package: "bare-rpc-swift"),
        .product(name: "${schemaPackageName}", package: "${schemaPackageId}")
      ],
      path: "Sources"
    )
  ]
)
`
}

module.exports = writeToDisk
