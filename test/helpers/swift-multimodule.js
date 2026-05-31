'use strict'

const { spawnSync } = require('child_process')
const path = require('path')
const fs = require('fs')
const SwiftHyperschema = require('hyperschema-swift')
const SwiftHRPC = require('../../index.js')

const WORKSPACE = path.join(__dirname, '../swift-multimodule-workspace')
const TIMEOUT = 120000

// Builds the exact multi-package layout the generators ship: a `Schema`
// package from `SwiftHyperschema.toDisk` and an `HRPC` package from
// `SwiftHRPC.toDisk`, each with its own generated `Package.swift`, wired
// together by path dependencies under a small executable that runs a real
// roundtrip. This is what the (removed) `npm install` example job used to
// cover — the generated `Package.swift` and the public cross-module surface
// the single-module helper in swift.js strips away — now part of `npm test`.

const EXECUTABLE_PACKAGE_SWIFT = `// swift-tools-version: 5.10
import PackageDescription

let package = Package(
  name: "HRPCMultiModule",
  platforms: [.macOS(.v11), .iOS(.v14)],
  dependencies: [
    .package(path: "schema"),
    .package(path: "hrpc"),
    .package(url: "https://github.com/holepunchto/bare-rpc-swift", branch: "main")
  ],
  targets: [
    .executableTarget(
      name: "HRPCMultiModule",
      dependencies: [
        .product(name: "Schema", package: "schema"),
        .product(name: "HRPC", package: "hrpc"),
        .product(name: "BareRPC", package: "bare-rpc-swift")
      ],
      path: "Sources"
    )
  ]
)
`

function runSwiftMultiModule(schema, hrpc, mainSwift) {
  // Clear the prior layout (but keep .build for caching): the executable
  // target compiles everything under Sources/, so a stale Schema.swift left
  // there would collide with the separate Schema module.
  for (const entry of ['Sources', 'schema', 'hrpc', 'Package.swift', 'Package.resolved']) {
    fs.rmSync(path.join(WORKSPACE, entry), { recursive: true, force: true })
  }

  const execSources = path.join(WORKSPACE, 'Sources')
  fs.mkdirSync(execSources, { recursive: true })

  // Generate the two packages exactly as they ship — public API, `import
  // Schema`, and the generated Package.swift files all kept verbatim — so the
  // build proves the real layout resolves and links across module boundaries.
  SwiftHyperschema.toDisk(schema, path.join(WORKSPACE, 'schema'))
  SwiftHRPC.toDisk(hrpc, path.join(WORKSPACE, 'hrpc'), {
    schemaPackagePath: '../schema',
    schemaPackageName: 'Schema',
    schemaPackageId: 'schema'
  })

  fs.writeFileSync(path.join(execSources, 'main.swift'), mainSwift, { encoding: 'utf-8' })
  fs.writeFileSync(path.join(WORKSPACE, 'Package.swift'), EXECUTABLE_PACKAGE_SWIFT, {
    encoding: 'utf-8'
  })

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
