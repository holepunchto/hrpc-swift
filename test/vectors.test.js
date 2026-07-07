'use strict'

// Cross-language conformance: decode hrpc-test's wire vectors in Swift (via
// bare-rpc-swift) and assert they match the fixtures - a non-JS check on the
// canonical bytes. Mirrors hrpc-c/test/vectors.test.js.
//
// `swift run` carries heavy SwiftPM build overhead (a cold dependency
// resolve + build), so every vector - schema-free envelope/error/boundary
// decodes, their encode-match checks, and the dispatch decodes/encode-match,
// which need the generated Schema/HRPC - runs in a SINGLE `swift run` inside
// the shared swift-workspace already used by interop.test.js. Each vector
// still prints its own keyed result line, and each still gets its own
// brittle assertion, so a failure names the exact vector/family - only the
// process invocations are collapsed, not the reporting.
const test = require('brittle')
const path = require('path')
const SwiftHyperschema = require('hyperschema-swift')
const SwiftHRPC = require('../index.js')
const { runSwift } = require('./helpers/swift')
const { isWindows } = require('which-runtime')

// Swift-spawning tests run on the Bare pass only: they build and run Swift, which
// behaves identically regardless of the JS host, so running under both node and bare
// would just duplicate the heavy Swift build. hrpc-test loads under Bare (>= 0.0.3).
// Windows CI has no Swift toolchain, so skip there too.
const isBare = typeof Bare !== 'undefined'
const skip = !isBare || isWindows

// Swift string literal escaping for hex/text embedded in generated drivers.
function swiftString(s) {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function hexToDataLiteral(hex) {
  return `hexToData("${hex}")`
}

// `@testable import BareRPC` reaches the internal Messages/DecodedMessage API
// used by the schema-free checks below; the generated Schema/HRPC types used
// by the dispatch checks live in the same executable target, so both halves
// share this one preamble.
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

// The batched driver reports per-vector results instead of aborting on the
// first mismatch, so one run verifies every vector and JS can attribute
// failures. `check` throws a labelled reason; `runVector` catches it and
// prints one line per vector ("OK <key>" / "FAIL <key> <reason>"), keeping
// every later vector running. Encode checks print "ENC <key> <hex>". The
// process exits non-zero if any vector failed.
const RESULT_PREAMBLE = `${PREAMBLE}
enum CheckError: Error { case failed(String) }

func check(_ cond: Bool, _ message: @autoclosure () -> String) throws {
  if !cond { throw CheckError.failed(message()) }
}

var failed = false

func runVector(_ key: String, _ body: () throws -> Void) {
  do {
    try body()
    print("OK \\(key)")
  } catch CheckError.failed(let reason) {
    print("FAIL \\(key) \\(reason)")
    failed = true
  } catch {
    print("FAIL \\(key) \\(error)")
    failed = true
  }
}
`

// null and a zero-length buffer are indistinguishable on the wire (both encode
// dataLen 0), so both fixture shapes assert only data == nil.
function assertData(dataVar, data) {
  if (data === null || data.length === 0) {
    return `try check(${dataVar} == nil, "expected nil data, got \\(String(describing: ${dataVar}))")`
  }
  return `try check(${dataVar} == ${hexToDataLiteral(data)}, "data mismatch")`
}

function assertError(errorVar, error) {
  return [
    `try check(${errorVar}.message == "${swiftString(error.message)}", "message mismatch: \\(${errorVar}.message)")`,
    `try check(${errorVar}.code == "${swiftString(error.code)}", "code mismatch: \\(${errorVar}.code)")`,
    `try check(${errorVar}.errno == ${error.errno}, "errno mismatch: \\(${errorVar}.errno)")`
  ].join('\n    ')
}

// Decode one frame and assert every field the descriptor pins (union rules per
// WIRE.md). Returns the body of a runVector closure - identical checks to the
// old per-frame driver, only phrased as throwing `check`s.
function decodeBody(hex, descriptor) {
  const lines = [
    `let msg = try Messages.decodeFrame(${hexToDataLiteral(hex)})`,
    'try check(msg != nil, "decoded to nil")'
  ]

  if (descriptor.type === 1) {
    lines.push(
      'guard case .request(let req) = msg! else { throw CheckError.failed("wrong case: \\(msg!)") }'
    )
    lines.push(`try check(req.id == ${descriptor.id}, "id mismatch: \\(req.id)")`)
    lines.push(
      `try check(req.command == ${descriptor.command}, "command mismatch: \\(req.command)")`
    )
    lines.push(`try check(req.stream == ${descriptor.stream}, "stream mismatch: \\(req.stream)")`)
    if (descriptor.stream === 0) lines.push(assertData('req.data', descriptor.data))
  } else if (descriptor.type === 2) {
    lines.push(
      'guard case .response(let resp) = msg! else { throw CheckError.failed("wrong case: \\(msg!)") }'
    )
    lines.push(`try check(resp.id == ${descriptor.id}, "id mismatch: \\(resp.id)")`)
    lines.push(`try check(resp.stream == ${descriptor.stream}, "stream mismatch: \\(resp.stream)")`)
    if (descriptor.error) {
      lines.push(
        'guard case .remoteError(let message, let code, let errno) = resp.result else { throw CheckError.failed("expected remoteError, got \\(resp.result)") }'
      )
      lines.push('let respError = RPCRemoteError(message: message, code: code, errno: errno)')
      lines.push(assertError('respError', descriptor.error))
    } else {
      lines.push(
        'guard case .success(let data) = resp.result else { throw CheckError.failed("expected success, got \\(resp.result)") }'
      )
      if (descriptor.stream === 0) lines.push(assertData('data', descriptor.data))
    }
  } else if (descriptor.type === 3) {
    lines.push(
      'guard case .stream(let s) = msg! else { throw CheckError.failed("wrong case: \\(msg!)") }'
    )
    lines.push(`try check(s.id == ${descriptor.id}, "id mismatch: \\(s.id)")`)
    lines.push(`try check(s.flags == ${descriptor.stream}, "flags mismatch: \\(s.flags)")`)
    if (descriptor.error) {
      lines.push('try check(s.error != nil, "expected error, got nil")')
      lines.push(assertError('s.error!', descriptor.error))
    } else if (descriptor.stream & 0x10) {
      lines.push(assertData('s.data', descriptor.data))
    }
  }

  return lines.join('\n    ')
}

// Parse the batched driver's stdout into key -> result. Decode vectors yield
// { ok, reason }; encode checks yield { hex }. A key with no line at all
// (crash before it ran, or a typo in the driver) leaves the map without an
// entry, and callers below treat "no entry" as a failure rather than a skip.
function parseResults(result) {
  const map = new Map()
  if (!result || !result.stdout) return map
  for (const line of result.stdout.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const parts = trimmed.split(' ')
    const status = parts[0]
    if (status === 'OK') map.set(parts[1], { ok: true })
    else if (status === 'FAIL') map.set(parts[1], { ok: false, reason: parts.slice(2).join(' ') })
    else if (status === 'ENC') map.set(parts[1], { hex: parts[2] })
  }
  return map
}

if (!skip) {
  const { loadFamily } = require('hrpc-test')

  // Collect every schema-free decode vector, flattened across families.
  const rawVectors = []
  for (const family of ['envelope', 'error', 'boundary']) {
    const { messages, frames } = loadFamily(family)
    for (let i = 0; i < frames.length; i++) {
      rawVectors.push({
        key: `${family}:${i}`,
        family,
        i,
        note: messages[i].note,
        hex: frames[i],
        descriptor: messages[i].descriptor
      })
    }
  }

  // Two schema-free encode-match checks join the same run (they only need
  // BareRPC).
  const errorEnc = loadFamily('error')
  const envelopeEnc = loadFamily('envelope')
  const envelopeStreamIdx = envelopeEnc.messages.findIndex((m) => m.note === 'stream request data')
  const envelopeStreamDesc = envelopeEnc.messages[envelopeStreamIdx].descriptor

  // Load hrpc-test's frozen fixtures/dispatch/{schema,hrpc} directly - no hand-copied schema to drift.
  const HRPC_TEST_DIR = path.dirname(require.resolve('hrpc-test'))
  const DISPATCH_SCHEMA_DIR = path.join(HRPC_TEST_DIR, 'fixtures', 'dispatch', 'schema')
  const DISPATCH_HRPC_DIR = path.join(HRPC_TEST_DIR, 'fixtures', 'dispatch', 'hrpc')

  const dispatch = loadFamily('dispatch')

  // Everything above shares one generated Schema/HRPC and one BareRPC
  // dependency, so one `swift run` in the shared swift-workspace covers the
  // whole family: schema-free decodes, schema-free encode-match, dispatch
  // decodes, and dispatch encode-match.
  function buildMain() {
    const schema = SwiftHyperschema.from(DISPATCH_SCHEMA_DIR)
    const hrpc = SwiftHRPC.from(DISPATCH_SCHEMA_DIR, DISPATCH_HRPC_DIR)

    const decodeBlocks = rawVectors
      .map(
        (v) => `runVector("${v.key}") {
    ${decodeBody(v.hex, v.descriptor)}
  }`
      )
      .join('\n  ')

    const rawEncodeBlocks = `do {
    let encoded = Messages.encodeErrorResponse(
      id: ${errorEnc.messages[0].descriptor.id},
      message: "${swiftString(errorEnc.messages[0].descriptor.error.message)}",
      code: "${swiftString(errorEnc.messages[0].descriptor.error.code)}",
      errno: ${errorEnc.messages[0].descriptor.error.errno}
    )
    print("ENC enc:error:0 " + encoded.map { String(format: "%02x", $0) }.joined())
  }
  do {
    let encoded = Messages.encodeStream(id: ${envelopeStreamDesc.id}, flags: ${envelopeStreamDesc.stream}, data: ${hexToDataLiteral(envelopeStreamDesc.data)})
    print("ENC enc:envelope_stream " + encoded.map { String(format: "%02x", $0) }.joined())
  }`

    // A nil `data` here would otherwise trap the whole batched run on a force
    // unwrap; `check` turns it into a normal per-vector FAIL instead.
    const dispatchBlocks = `runVector("dispatch:0") {
    let msg = try Messages.decodeFrame(${hexToDataLiteral(dispatch.frames[0])})
    guard case .request(let req) = msg! else { throw CheckError.failed("wrong case: \\(msg!)") }
    try check(req.id == 1, "id mismatch: \\(req.id)")
    try check(req.command == 0, "command mismatch: \\(req.command)")
    try check(req.data != nil, "expected data, got nil")
    let payload = try decode(helloRequest, req.data!)
    try check(payload.name == "ada", "name mismatch: \\(payload.name)")
  }
  runVector("dispatch:1") {
    let msg = try Messages.decodeFrame(${hexToDataLiteral(dispatch.frames[1])})
    guard case .response(let resp) = msg! else { throw CheckError.failed("wrong case: \\(msg!)") }
    try check(resp.id == 1, "id mismatch: \\(resp.id)")
    guard case .success(let data) = resp.result else { throw CheckError.failed("expected success, got \\(resp.result)") }
    try check(data != nil, "expected data, got nil")
    let payload = try decode(helloResponse, data!)
    try check(payload.text == "hi ada", "text mismatch: \\(payload.text)")
  }
  runVector("dispatch:2") {
    let msg = try Messages.decodeFrame(${hexToDataLiteral(dispatch.frames[2])})
    guard case .request(let req) = msg! else { throw CheckError.failed("wrong case: \\(msg!)") }
    try check(req.id == 0, "id mismatch: \\(req.id)")
    try check(req.command == 1, "command mismatch: \\(req.command)")
    try check(req.data != nil, "expected data, got nil")
    let payload = try decode(pingRequest, req.data!)
    try check(payload.seq == 7, "seq mismatch: \\(payload.seq)")
  }
  do {
    let encoded = Messages.encodeRequest(id: 1, command: 0, data: try encode(helloRequest, HelloRequest(name: "ada")))
    print("ENC enc:dispatch:0 " + encoded.map { String(format: "%02x", $0) }.joined())
  } catch {
    print("FAIL enc:dispatch:0 \\(error)")
    failed = true
  }`

    const main = `${RESULT_PREAMBLE}
  ${decodeBlocks}
  ${rawEncodeBlocks}
  ${dispatchBlocks}
exit(failed ? 1 : 0)
`
    return runSwift(schema, hrpc, main)
  }

  const result = buildMain()
  const byKey = parseResults(result)

  for (const v of rawVectors) {
    test(`Swift decodes ${v.family}[${v.i}] - ${v.note}`, { skip }, (t) => {
      const r = byKey.get(v.key)
      if (!r) {
        t.fail(`no Swift result for ${v.key}: ${result.stderr}`)
        return
      }
      t.ok(r.ok, r.ok ? 'decoded ok' : r.reason)
    })
  }

  const DISPATCH_DECODE_NOTES = [
    'hello request payload',
    'hello response payload',
    'ping event payload'
  ]
  for (let i = 0; i < 3; i++) {
    test(`Swift decodes dispatch[${i}] - ${DISPATCH_DECODE_NOTES[i]}`, { skip }, (t) => {
      const r = byKey.get(`dispatch:${i}`)
      if (!r) {
        t.fail(`no Swift result for dispatch:${i}: ${result.stderr}`)
        return
      }
      t.ok(r.ok, r.ok ? 'decoded ok' : r.reason)
    })
  }

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
    const r = byKey.get('enc:dispatch:0')
    if (!r) {
      t.fail(`no Swift result for enc:dispatch:0: ${result.stderr}`)
      return
    }
    t.is(r.hex, dispatch.frames[0], 'Swift-encoded bytes equal the fixture hex')
  })

  test('Swift encodes error[0] response matches fixture bytes', { skip }, (t) => {
    const r = byKey.get('enc:error:0')
    if (!r) {
      t.fail(`no Swift result for enc:error:0: ${result.stderr}`)
      return
    }
    t.is(r.hex, errorEnc.frames[0], 'Swift-encoded bytes equal the fixture hex')
  })

  test('Swift encodes envelope stream-data frame matches fixture bytes', { skip }, (t) => {
    const r = byKey.get('enc:envelope_stream')
    if (!r) {
      t.fail(`no Swift result for enc:envelope_stream: ${result.stderr}`)
      return
    }
    t.is(r.hex, envelopeEnc.frames[envelopeStreamIdx], 'Swift-encoded bytes equal the fixture hex')
  })
}
