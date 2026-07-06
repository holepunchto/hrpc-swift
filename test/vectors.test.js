'use strict'

// Cross-language conformance: decode hrpc-test's wire vectors in Swift (via
// bare-rpc-swift) and assert they match the fixtures - a non-JS check on the
// canonical bytes. Mirrors hrpc-c/test/vectors.test.js.
const test = require('brittle')
const path = require('path')
const SwiftHyperschema = require('hyperschema-swift')
const SwiftHRPC = require('../index.js')
const { runSwift, runSwiftRaw } = require('./helpers/swift')
const { isWindows } = require('which-runtime')

// hrpc-test is Node-only (no Bare imports map): require() throws under bare, so skip the file.
const isBare = typeof Bare !== 'undefined'
const skip = isBare || isWindows

// Swift string literal escaping for hex/text embedded in generated drivers.
function swiftString(s) {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function hexToDataLiteral(hex) {
  return `hexToData("${hex}")`
}

const PREAMBLE = `
import Foundation
@testable import BareRPC

func hexToData(_ hex: String) -> Data {
  var bytes = [UInt8]()
  var idx = hex.startIndex
  while idx < hex.endIndex {
    let next = hex.index(idx, offsetBy: 2)
    bytes.append(UInt8(hex[idx..<next], radix: 16)!)
    idx = next
  }
  return Data(bytes)
}
`

// null and a zero-length buffer are indistinguishable on the wire (both encode
// dataLen 0), so both fixture shapes assert only data == nil.
function assertData(dataVar, data) {
  if (data === null || data.length === 0) {
    return `precondition(${dataVar} == nil, "expected nil data, got \\(String(describing: ${dataVar}))")`
  }
  return `precondition(${dataVar} == ${hexToDataLiteral(data)}, "data mismatch")`
}

function assertError(errorVar, error) {
  return [
    `precondition(${errorVar}.message == "${swiftString(error.message)}", "message mismatch: \\(${errorVar}.message)")`,
    `precondition(${errorVar}.code == "${swiftString(error.code)}", "code mismatch: \\(${errorVar}.code)")`,
    `precondition(${errorVar}.errno == ${error.errno}, "errno mismatch: \\(${errorVar}.errno)")`
  ].join('\n  ')
}

// Decode one frame in Swift and assert every field the descriptor pins (union rules per WIRE.md).
function decodeDriver(hex, descriptor) {
  const lines = [
    `let msg = try Messages.decodeFrame(${hexToDataLiteral(hex)})`,
    'precondition(msg != nil, "decoded to nil")'
  ]

  if (descriptor.type === 1) {
    lines.push(
      'guard case .request(let req) = msg! else { print("wrong case: \\(msg!)"); exit(1) }'
    )
    lines.push(`precondition(req.id == ${descriptor.id}, "id mismatch: \\(req.id)")`)
    lines.push(
      `precondition(req.command == ${descriptor.command}, "command mismatch: \\(req.command)")`
    )
    lines.push(
      `precondition(req.stream == ${descriptor.stream}, "stream mismatch: \\(req.stream)")`
    )
    if (descriptor.stream === 0) lines.push(assertData('req.data', descriptor.data))
  } else if (descriptor.type === 2) {
    lines.push(
      'guard case .response(let resp) = msg! else { print("wrong case: \\(msg!)"); exit(1) }'
    )
    lines.push(`precondition(resp.id == ${descriptor.id}, "id mismatch: \\(resp.id)")`)
    lines.push(
      `precondition(resp.stream == ${descriptor.stream}, "stream mismatch: \\(resp.stream)")`
    )
    if (descriptor.error) {
      lines.push(
        'guard case .remoteError(let message, let code, let errno) = resp.result else { print("expected remoteError, got \\(resp.result)"); exit(1) }'
      )
      lines.push(`let respError = RPCRemoteError(message: message, code: code, errno: errno)`)
      lines.push(assertError('respError', descriptor.error))
    } else {
      lines.push(
        'guard case .success(let data) = resp.result else { print("expected success, got \\(resp.result)"); exit(1) }'
      )
      if (descriptor.stream === 0) lines.push(assertData('data', descriptor.data))
    }
  } else if (descriptor.type === 3) {
    lines.push('guard case .stream(let s) = msg! else { print("wrong case: \\(msg!)"); exit(1) }')
    lines.push(`precondition(s.id == ${descriptor.id}, "id mismatch: \\(s.id)")`)
    lines.push(`precondition(s.flags == ${descriptor.stream}, "flags mismatch: \\(s.flags)")`)
    if (descriptor.error) {
      lines.push('precondition(s.error != nil, "expected error, got nil")')
      lines.push(assertError('s.error!', descriptor.error))
    } else if (descriptor.stream & 0x10) {
      lines.push(assertData('s.data', descriptor.data))
    }
  }

  lines.push('print("ok")')

  return `${PREAMBLE}
${lines.join('\n')}
exit(0)
`
}

if (!skip) {
  const { loadFamily } = require('hrpc-test')

  for (const family of ['envelope', 'error', 'boundary']) {
    const { messages, frames } = loadFamily(family)
    for (let i = 0; i < frames.length; i++) {
      const { note, descriptor } = messages[i]
      test(`Swift decodes ${family}[${i}] - ${note}`, { skip }, (t) => {
        const result = runSwiftRaw(decodeDriver(frames[i], descriptor))
        t.ok(result.ok, result.ok ? 'decoded ok' : result.stderr)
        if (result.ok) t.is(result.stdout.trim(), 'ok', 'driver printed success marker')
      })
    }
  }

  // Load hrpc-test's frozen fixtures/dispatch/{schema,hrpc} directly - no hand-copied schema to drift.
  const HRPC_TEST_DIR = path.dirname(require.resolve('hrpc-test'))
  const DISPATCH_SCHEMA_DIR = path.join(HRPC_TEST_DIR, 'fixtures', 'dispatch', 'schema')
  const DISPATCH_HRPC_DIR = path.join(HRPC_TEST_DIR, 'fixtures', 'dispatch', 'hrpc')

  function buildDispatchGreeter() {
    const schema = SwiftHyperschema.from(DISPATCH_SCHEMA_DIR)
    const hrpc = SwiftHRPC.from(DISPATCH_SCHEMA_DIR, DISPATCH_HRPC_DIR)
    return { schema, hrpc }
  }

  test('Swift decodes dispatch[0] - hello request payload', { skip }, (t) => {
    const { schema, hrpc } = buildDispatchGreeter()
    const { frames } = loadFamily('dispatch')

    const main = `${PREAMBLE}
let msg = try Messages.decodeFrame(${hexToDataLiteral(frames[0])})
guard case .request(let req) = msg! else { print("wrong case: \\(msg!)"); exit(1) }
precondition(req.id == 1, "id mismatch: \\(req.id)")
precondition(req.command == 0, "command mismatch: \\(req.command)")

let payload = try decode(helloRequest, req.data!)
precondition(payload.name == "ada", "name mismatch: \\(payload.name)")

print("ok")
exit(0)
`
    const result = runSwift(schema, hrpc, main)
    t.ok(result.ok, result.ok ? 'decoded ok' : result.stderr)
    if (result.ok) t.is(result.stdout.trim(), 'ok', 'driver printed success marker')
  })

  test('Swift decodes dispatch[1] - hello response payload', { skip }, (t) => {
    const { schema, hrpc } = buildDispatchGreeter()
    const { frames } = loadFamily('dispatch')

    const main = `${PREAMBLE}
let msg = try Messages.decodeFrame(${hexToDataLiteral(frames[1])})
guard case .response(let resp) = msg! else { print("wrong case: \\(msg!)"); exit(1) }
precondition(resp.id == 1, "id mismatch: \\(resp.id)")
guard case .success(let data) = resp.result else { print("expected success, got \\(resp.result)"); exit(1) }

let payload = try decode(helloResponse, data!)
precondition(payload.text == "hi ada", "text mismatch: \\(payload.text)")

print("ok")
exit(0)
`
    const result = runSwift(schema, hrpc, main)
    t.ok(result.ok, result.ok ? 'decoded ok' : result.stderr)
    if (result.ok) t.is(result.stdout.trim(), 'ok', 'driver printed success marker')
  })

  test('Swift decodes dispatch[2] - ping event payload', { skip }, (t) => {
    const { schema, hrpc } = buildDispatchGreeter()
    const { frames } = loadFamily('dispatch')

    const main = `${PREAMBLE}
let msg = try Messages.decodeFrame(${hexToDataLiteral(frames[2])})
guard case .request(let req) = msg! else { print("wrong case: \\(msg!)"); exit(1) }
precondition(req.id == 0, "id mismatch: \\(req.id)")
precondition(req.command == 1, "command mismatch: \\(req.command)")

let payload = try decode(pingRequest, req.data!)
precondition(payload.seq == 7, "seq mismatch: \\(payload.seq)")

print("ok")
exit(0)
`
    const result = runSwift(schema, hrpc, main)
    t.ok(result.ok, result.ok ? 'decoded ok' : result.stderr)
    if (result.ok) t.is(result.stdout.trim(), 'ok', 'driver printed success marker')
  })

  // Encode-match spot-check: Swift encodes a representative subset; bytes must
  // equal the fixture hex exactly. Kept to a logged subset so decode-only
  // coverage is visible, mirroring the C retrofit's spot-check.
  const ENCODE_CHECKED = [
    'dispatch[0] hello request (unary request)',
    'error[0] response error basic (error response)',
    "envelope[9] 'stream request data' (stream data frame)"
  ]
  console.log('encode-match spot-check covers:', ENCODE_CHECKED.join('; '))

  test('Swift encodes dispatch[0] - hello request matches fixture bytes', { skip }, (t) => {
    const { frames } = loadFamily('dispatch')

    const main = `${PREAMBLE}
let encoded = Messages.encodeRequest(id: 1, command: 0, data: try encode(helloRequest, HelloRequest(name: "ada")))
print(encoded.map { String(format: "%02x", $0) }.joined())
exit(0)
`
    const schema = SwiftHyperschema.from(DISPATCH_SCHEMA_DIR)
    const hrpc = SwiftHRPC.from(DISPATCH_SCHEMA_DIR, DISPATCH_HRPC_DIR)
    const result = runSwift(schema, hrpc, main)
    t.ok(result.ok, result.ok ? 'compiled and ran' : result.stderr)
    if (result.ok)
      t.is(result.stdout.trim(), frames[0], 'Swift-encoded bytes equal the fixture hex')
  })

  test('Swift encodes error[0] response matches fixture bytes', { skip }, (t) => {
    const { messages, frames } = loadFamily('error')
    const { descriptor } = messages[0]

    const main = `${PREAMBLE}
let encoded = Messages.encodeErrorResponse(
  id: ${descriptor.id},
  message: "${swiftString(descriptor.error.message)}",
  code: "${swiftString(descriptor.error.code)}",
  errno: ${descriptor.error.errno}
)
print(encoded.map { String(format: "%02x", $0) }.joined())
exit(0)
`
    const result = runSwiftRaw(main)
    t.ok(result.ok, result.ok ? 'compiled and ran' : result.stderr)
    if (result.ok)
      t.is(result.stdout.trim(), frames[0], 'Swift-encoded bytes equal the fixture hex')
  })

  test('Swift encodes envelope stream-data frame matches fixture bytes', { skip }, (t) => {
    const { messages, frames } = loadFamily('envelope')
    const i = messages.findIndex((m) => m.note === 'stream request data')
    const { descriptor } = messages[i]

    const main = `${PREAMBLE}
let encoded = Messages.encodeStream(id: ${descriptor.id}, flags: ${descriptor.stream}, data: ${hexToDataLiteral(descriptor.data)})
print(encoded.map { String(format: "%02x", $0) }.joined())
exit(0)
`
    const result = runSwiftRaw(main)
    t.ok(result.ok, result.ok ? 'compiled and ran' : result.stderr)
    if (result.ok)
      t.is(result.stdout.trim(), frames[i], 'Swift-encoded bytes equal the fixture hex')
  })
}
