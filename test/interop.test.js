'use strict'

const test = require('brittle')
const c = require('compact-encoding')
const { runSwift } = require('./helpers/swift')
const { makeSchema, PIPE_CLASS } = require('./helpers/schema')
const m = require('bare-rpc/messages')
const { isWindows } = require('which-runtime')

// --- Wire format helpers ---

function encodeRequestFrame(id, command, payloadBuffer) {
  const message = { type: 1, id, command, stream: 0, data: payloadBuffer }
  const header = c.encode(m.header, message)
  return payloadBuffer ? Buffer.concat([header, payloadBuffer]) : Buffer.from(header)
}

// Events are request frames (type 1) with id 0
function encodeEventFrame(command, payloadBuffer) {
  return encodeRequestFrame(0, command, payloadBuffer)
}

function decodeFrame(buf) {
  const state = c.state(0, buf.length, buf)
  return m.message.decode(state)
}

// --- Payload codecs (matching hyperschema-generated struct encodings) ---

const echoRequestCodec = {
  preencode(state, val) {
    c.uint.preencode(state, val.value)
  },
  encode(state, val) {
    c.uint.encode(state, val.value)
  },
  decode(state) {
    return { value: c.uint.decode(state) }
  }
}

const echoResponseCodec = echoRequestCodec // same shape

const notifyRequestCodec = {
  preencode(state, val) {
    c.uint.preencode(state, val.code)
  },
  encode(state, val) {
    c.uint.encode(state, val.code)
  },
  decode(state) {
    return { code: c.uint.decode(state) }
  }
}

// --- JS → Swift tests ---

test('interop: JS event frame → Swift dispatch', { skip: isWindows }, (t) => {
  const schema = makeSchema()
  const hrpc = {
    handlers: [
      {
        id: 0,
        name: '@test/notify',
        request: { name: '@test/notify-request', stream: false, send: true },
        response: null
      }
    ]
  }

  const payload = Buffer.from(c.encode(notifyRequestCodec, { code: 42 }))
  const frame = encodeEventFrame(0, payload)
  const base64 = frame.toString('base64')

  const main = `
import Foundation
import BareRPC

${PIPE_CLASS}

let pipe = Pipe()
let hrpc = HRPC(delegate: pipe)

hrpc.onNotify { req in
  precondition(req!.code == 42, "expected code 42, got \\(req!.code)")
  print("OK")
  exit(0)
}

let data = Data(base64Encoded: "${base64}")!
Task { await hrpc.receive(data) }
RunLoop.main.run()
`

  const result = runSwift(schema, hrpc, main)
  t.ok(result.ok, result.stderr)
  t.ok(result.stdout.includes('OK'), 'JS event frame decoded by Swift')
})

test(
  'interop: JS null-payload event frame → Swift handler receives nil',
  { skip: isWindows },
  (t) => {
    const schema = makeSchema()
    const hrpc = {
      handlers: [
        {
          id: 0,
          name: '@test/notify',
          request: { name: '@test/notify-request', stream: false, send: true },
          response: null
        }
      ]
    }

    // Event frame with no payload data
    const frame = encodeEventFrame(0, null)
    const base64 = frame.toString('base64')

    const main = `
import Foundation
import BareRPC

${PIPE_CLASS}

let pipe = Pipe()
let hrpc = HRPC(delegate: pipe)

hrpc.onNotify { req in
  precondition(req == nil, "expected nil args, got \\(String(describing: req))")
  print("OK")
  exit(0)
}

let data = Data(base64Encoded: "${base64}")!
Task { await hrpc.receive(data) }
RunLoop.main.run()
`

    const result = runSwift(schema, hrpc, main)
    t.ok(result.ok, result.stderr)
    t.ok(result.stdout.includes('OK'), 'nil payload delivers nil to Swift handler')
  }
)

test('interop: JS request frame → Swift dispatch + response', { skip: isWindows }, (t) => {
  const schema = makeSchema()
  const hrpc = {
    handlers: [
      {
        id: 0,
        name: '@test/echo',
        request: { name: '@test/echo-request', stream: false },
        response: { name: '@test/echo-response', stream: false }
      }
    ]
  }

  const payload = Buffer.from(c.encode(echoRequestCodec, { value: 7 }))
  const frame = encodeRequestFrame(1, 0, payload)
  const base64 = frame.toString('base64')

  const main = `
import Foundation
import BareRPC

${PIPE_CLASS}

let pipe = Pipe()
pipe.captureMode = true
let hrpc = HRPC(delegate: pipe)

hrpc.onEcho { req in
  precondition(req!.value == 7, "expected value 7, got \\(req!.value)")
  return EchoResponse(value: req!.value * 3)
}

let data = Data(base64Encoded: "${base64}")!
Task { await hrpc.receive(data) }

Task {
  try await Task.sleep(nanoseconds: 500_000_000)
  print(pipe.captured.base64EncodedString())
  exit(0)
}
RunLoop.main.run()
`

  const result = runSwift(schema, hrpc, main)
  t.ok(result.ok, result.stderr)

  // Decode the Swift response frame in JS
  const responseFrame = Buffer.from(result.stdout.trim(), 'base64')
  const message = decodeFrame(responseFrame)

  t.is(message.type, 2, 'response type')
  t.is(message.id, 1, 'response id matches request id')

  const resp = c.decode(echoResponseCodec, message.data)
  t.is(resp.value, 21, 'Swift response payload: 7 * 3 = 21')
})

// --- Swift → JS tests ---

test('interop: Swift event frame → JS decode', { skip: isWindows }, (t) => {
  const schema = makeSchema()
  const hrpc = {
    handlers: [
      {
        id: 0,
        name: '@test/notify',
        request: { name: '@test/notify-request', stream: false, send: true },
        response: null
      }
    ]
  }

  const main = `
import Foundation
import BareRPC

${PIPE_CLASS}

let pipe = Pipe()
pipe.captureMode = true
let hrpc = HRPC(delegate: pipe)

Task {
  try await hrpc.notify(NotifyRequest(code: 77))
  print(pipe.captured.base64EncodedString())
  exit(0)
}
RunLoop.main.run()
`

  const result = runSwift(schema, hrpc, main)
  t.ok(result.ok, result.stderr)

  const frame = Buffer.from(result.stdout.trim(), 'base64')
  const message = decodeFrame(frame)

  t.is(message.type, 1, 'request type (event)')
  t.is(message.id, 0, 'event id is 0')
  t.is(message.command, 0, 'command is 0')

  const payload = c.decode(notifyRequestCodec, message.data)
  t.is(payload.code, 77, 'Swift-encoded payload decoded in JS: code=77')
})

test('interop: Swift duplex OPEN frame decodes in JS', { skip: isWindows }, (t) => {
  const schema = makeSchema()
  const hrpc = {
    handlers: [
      {
        id: 0,
        name: '@test/pipe',
        request: { name: '@test/echo-request', stream: true },
        response: { name: '@test/echo-response', stream: true }
      }
    ]
  }

  // Custom delegate: print the first frame sent and exit immediately — no sleep needed.
  const main = `
import Foundation
import BareRPC

class PrintOnSend: RPCDelegate {
  func rpc(_ rpc: RPC, send data: Data) {
    print(data.base64EncodedString())
    exit(0)
  }
}

let hrpc = HRPC(delegate: PrintOnSend())
Task { try? await hrpc.pipe { _, _ in } }
RunLoop.main.run()
`

  const result = runSwift(schema, hrpc, main)
  t.ok(result.ok, result.stderr)

  const frame = Buffer.from(result.stdout.trim(), 'base64')
  const message = decodeFrame(frame)

  t.is(message.type, 1, 'duplex OPEN is a request frame (type=1)')
  t.ok(message.id > 0, 'has non-zero request id')
  t.is(message.command, 0, 'command id matches handler id')
  t.is(message.stream, 1, 'REQUEST-frame stream field: OPEN (0x01)')
})

test('interop: Swift request frame → JS decode', { skip: isWindows }, (t) => {
  const schema = makeSchema()
  const hrpc = {
    handlers: [
      {
        id: 0,
        name: '@test/echo',
        request: { name: '@test/echo-request', stream: false },
        response: { name: '@test/echo-response', stream: false }
      }
    ]
  }

  const main = `
import Foundation
import BareRPC

${PIPE_CLASS}

let pipe = Pipe()
pipe.captureMode = true
let hrpc = HRPC(delegate: pipe)

Task {
  _ = try? await hrpc.echo(EchoRequest(value: 55))
}

Task {
  try await Task.sleep(nanoseconds: 500_000_000)
  print(pipe.captured.base64EncodedString())
  exit(0)
}
RunLoop.main.run()
`

  const result = runSwift(schema, hrpc, main)
  t.ok(result.ok, result.stderr)

  const frame = Buffer.from(result.stdout.trim(), 'base64')
  const message = decodeFrame(frame)

  t.is(message.type, 1, 'request type')
  t.ok(message.id > 0, 'request id > 0')
  t.is(message.command, 0, 'command is 0')

  const payload = c.decode(echoRequestCodec, message.data)
  t.is(payload.value, 55, 'Swift-encoded request decoded in JS: value=55')
})

test('interop: JS request → Swift response-stream chunks → JS decode', { skip: isWindows }, (t) => {
  const schema = makeSchema()
  const hrpc = {
    handlers: [
      {
        id: 0,
        name: '@test/feed',
        request: { name: '@test/echo-request', stream: false },
        response: { name: '@test/echo-response', stream: true }
      }
    ]
  }

  const payload = Buffer.from(c.encode(echoRequestCodec, { value: 3 }))
  const frame = encodeRequestFrame(1, 0, payload)
  const base64 = frame.toString('base64')

  const main = `
import Foundation
import BareRPC

${PIPE_CLASS}

let pipe = Pipe()
pipe.captureMode = true
let hrpc = HRPC(delegate: pipe)

hrpc.onFeed { req, stream in
  for i: UInt in 0..<(req?.value ?? 0) {
    await stream.write(encode(echoResponse, EchoResponse(value: i)))
  }
  await stream.end()
}

let data = Data(base64Encoded: "${base64}")!
Task { await hrpc.receive(data) }

Task {
  try await Task.sleep(nanoseconds: 500_000_000)
  print(pipe.captured.base64EncodedString())
  exit(0)
}
RunLoop.main.run()
`

  const result = runSwift(schema, hrpc, main)
  t.ok(result.ok, result.stderr)

  // Decode all length-prefixed frames from captured output
  const captured = Buffer.from(result.stdout.trim(), 'base64')
  const state = c.state(0, captured.length, captured)
  const frames = []
  while (state.start < state.end) frames.push(m.message.decode(state))

  // Stream data frames are type=3 with a non-empty data field
  const dataFrames = frames.filter((f) => f.type === 3 && f.data && f.data.length > 0)
  t.is(dataFrames.length, 3, 'three stream data frames: values 0, 1, 2')

  const values = dataFrames.map((f) => c.decode(echoResponseCodec, f.data).value)
  t.alike(values, [0, 1, 2], 'Swift response-stream chunks decoded in JS')
})
