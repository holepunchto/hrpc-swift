'use strict'

const { spawnSync } = require('child_process')
const path = require('path')
const fs = require('fs')
const generateSwift = require('../../lib/codegen')

const WORKSPACE = path.join(__dirname, '../swift-multimodule-workspace')
const TIMEOUT = 120000

// Unlike the single-module helper in swift.js, this compiles the generated
// HRPC.swift exactly as it ships — `public class HRPC` and `import Schema`
// intact — across a real module boundary, against real hyperschema-swift
// output in its own `Schema` module. It is the end-to-end check that the
// shipped multi-module layout (separate Schema package, public HRPC API)
// actually links and runs.

const PACKAGE_SWIFT = `// swift-tools-version: 5.10
import PackageDescription

let package = Package(
  name: "HRPCMultiModule",
  platforms: [.macOS(.v11), .iOS(.v14)],
  dependencies: [
    .package(url: "https://github.com/holepunchto/bare-rpc-swift", branch: "main"),
    .package(url: "https://github.com/holepunchto/compact-encoding-swift", branch: "main")
  ],
  targets: [
    .target(
      name: "Schema",
      dependencies: [
        .product(name: "CompactEncoding", package: "compact-encoding-swift")
      ]
    ),
    .target(
      name: "HRPC",
      dependencies: [
        .product(name: "BareRPC", package: "bare-rpc-swift"),
        .product(name: "CompactEncoding", package: "compact-encoding-swift"),
        "Schema"
      ]
    ),
    .executableTarget(
      name: "HRPCMultiModule",
      dependencies: [
        "HRPC",
        "Schema",
        .product(name: "BareRPC", package: "bare-rpc-swift"),
        .product(name: "CompactEncoding", package: "compact-encoding-swift")
      ]
    )
  ]
)
`

function runSwiftMultiModule(schemaSwift, hrpc, mainSwift) {
  const schemaSources = path.join(WORKSPACE, 'Sources', 'Schema')
  const hrpcSources = path.join(WORKSPACE, 'Sources', 'HRPC')
  const execSources = path.join(WORKSPACE, 'Sources', 'HRPCMultiModule')

  fs.mkdirSync(schemaSources, { recursive: true })
  fs.mkdirSync(hrpcSources, { recursive: true })
  fs.mkdirSync(execSources, { recursive: true })

  // Generated HRPC.swift is written verbatim — public API and `import Schema`
  // both kept, so the build proves they resolve across the module boundary.
  fs.writeFileSync(path.join(schemaSources, 'Schema.swift'), schemaSwift, { encoding: 'utf-8' })
  fs.writeFileSync(path.join(hrpcSources, 'HRPC.swift'), generateSwift(hrpc), { encoding: 'utf-8' })
  fs.writeFileSync(path.join(execSources, 'main.swift'), mainSwift, { encoding: 'utf-8' })
  fs.writeFileSync(path.join(WORKSPACE, 'Package.swift'), PACKAGE_SWIFT, { encoding: 'utf-8' })

  const result = spawnSync('swift', ['run'], {
    cwd: WORKSPACE,
    encoding: 'utf8',
    timeout: TIMEOUT
  })

  const timedOut = result.error && result.error.code === 'ETIMEDOUT'
  return {
    ok: result.status === 0 && !timedOut,
    stdout: result.stdout ? result.stdout.toString() : '',
    stderr: timedOut
      ? `[swift run timed out after ${TIMEOUT}ms] ${result.error.message}`
      : result.stderr
        ? result.stderr.toString()
        : ''
  }
}

module.exports = { runSwiftMultiModule }
