'use strict'

const test = require('brittle')
const fs = require('fs')
const path = require('path')
const generateSwift = require('../lib/codegen')
const writeToDisk = require('../lib/write')
const { runSwift } = require('./helpers/swift')
const { makeSchema, PIPE_CLASS } = require('./helpers/schema')
const { isWindows } = require('which-runtime')

test('swift: request/response roundtrip', { skip: isWindows }, (t) => {
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

let pipeA = Pipe()
let pipeB = Pipe()
let client = HRPC(delegate: pipeA)
let server = HRPC(delegate: pipeB)
pipeA.peer = server
pipeB.peer = client

server.onEcho { req in
  precondition(req!.value == 21, "server got wrong value: \\(req!.value)")
  return EchoResponse(value: req!.value * 2)
}

Task {
  let resp = try await client.echo(EchoRequest(value: 21))
  precondition(resp.value == 42, "expected 42, got \\(resp.value)")
  print("OK")
  exit(0)
}
RunLoop.main.run()
`

  const result = runSwift(schema, hrpc, main)
  t.ok(result.ok, result.stderr)
  t.ok(result.stdout.includes('OK'), 'roundtrip printed OK')
})

test('swift: send-only event', { skip: isWindows }, (t) => {
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

let pipeA = Pipe()
let pipeB = Pipe()
let client = HRPC(delegate: pipeA)
let server = HRPC(delegate: pipeB)
pipeA.peer = server
pipeB.peer = client

server.onNotify { req in
  precondition(req!.code == 99, "server got wrong code: \\(req!.code)")
  print("OK")
  exit(0)
}

Task {
  try await client.notify(NotifyRequest(code: 99))
}
RunLoop.main.run()
`

  const result = runSwift(schema, hrpc, main)
  t.ok(result.ok, result.stderr)
  t.ok(result.stdout.includes('OK'), 'send-only printed OK')
})

test('swift: multiple handlers dispatch correctly', { skip: isWindows }, (t) => {
  const schema = makeSchema()
  const hrpc = {
    handlers: [
      {
        id: 0,
        name: '@test/echo',
        request: { name: '@test/echo-request', stream: false },
        response: { name: '@test/echo-response', stream: false }
      },
      {
        id: 1,
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

let pipeA = Pipe()
let pipeB = Pipe()
let client = HRPC(delegate: pipeA)
let server = HRPC(delegate: pipeB)
pipeA.peer = server
pipeB.peer = client

var notifyReceived = false

server.onEcho { req in
  return EchoResponse(value: req!.value + 1)
}

server.onNotify { req in
  notifyReceived = true
}

Task {
  let resp = try await client.echo(EchoRequest(value: 10))
  precondition(resp.value == 11, "echo: expected 11, got \\(resp.value)")

  try await client.notify(NotifyRequest(code: 1))
  try await Task.sleep(nanoseconds: 500_000_000)
  precondition(notifyReceived, "notify handler was not called")

  print("OK")
  exit(0)
}
RunLoop.main.run()
`

  const result = runSwift(schema, hrpc, main)
  t.ok(result.ok, result.stderr)
  t.ok(result.stdout.includes('OK'), 'multiple handlers printed OK')
})

test('swift: handler.id is used, not array index', { skip: isWindows }, (t) => {
  const schema = makeSchema()
  const hrpc = {
    handlers: [
      {
        id: 10,
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

let pipeA = Pipe()
let pipeB = Pipe()
let client = HRPC(delegate: pipeA)
let server = HRPC(delegate: pipeB)
pipeA.peer = server
pipeB.peer = client

server.onEcho { req in
  return EchoResponse(value: req!.value)
}

Task {
  let resp = try await client.echo(EchoRequest(value: 77))
  precondition(resp.value == 77, "expected 77, got \\(resp.value)")
  print("OK")
  exit(0)
}
RunLoop.main.run()
`

  const result = runSwift(schema, hrpc, main)
  t.ok(result.ok, result.stderr)
  t.ok(result.stdout.includes('OK'), 'non-zero handler.id printed OK')
})

test('swift: zero handlers compiles', { skip: isWindows }, (t) => {
  const schema = makeSchema()
  const hrpc = { handlers: [] }

  const main = `
import Foundation
import BareRPC

${PIPE_CLASS}

let pipeA = Pipe()
let client = HRPC(delegate: pipeA)
print("OK")
exit(0)
`

  const result = runSwift(schema, hrpc, main)
  t.ok(result.ok, result.stderr)
  t.ok(result.stdout.includes('OK'), 'zero handlers printed OK')
})

test('swift: null payload delivers nil args to handler', { skip: isWindows }, (t) => {
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

let pipeA = Pipe()
let pipeB = Pipe()
let client = HRPC(delegate: pipeA)
let server = HRPC(delegate: pipeB)
pipeA.peer = server
pipeB.peer = client

server.onEcho { req in
  precondition(req == nil, "expected nil args, got \\(String(describing: req))")
  print("OK")
  exit(0)
}

Task {
  _ = try await client.echo(nil)
}
RunLoop.main.run()
`

  const result = runSwift(schema, hrpc, main)
  t.ok(result.ok, result.stderr)
  t.ok(result.stdout.includes('OK'), 'nil args delivered to handler')
})

test('swift: null payload send-only delivers nil args to handler', { skip: isWindows }, (t) => {
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

let pipeA = Pipe()
let pipeB = Pipe()
let client = HRPC(delegate: pipeA)
let server = HRPC(delegate: pipeB)
pipeA.peer = server
pipeB.peer = client

server.onNotify { req in
  precondition(req == nil, "expected nil args, got \\(String(describing: req))")
  print("OK")
  exit(0)
}

Task {
  try await client.notify(nil)
}
RunLoop.main.run()
`

  const result = runSwift(schema, hrpc, main)
  t.ok(result.ok, result.stderr)
  t.ok(result.stdout.includes('OK'), 'nil args delivered to send-only handler')
})

test('swift: primitive type request/response roundtrip', { skip: isWindows }, (t) => {
  const schema = makeSchema()
  const hrpc = {
    handlers: [
      {
        id: 0,
        name: '@test/double',
        request: { name: 'uint', stream: false },
        response: { name: 'uint', stream: false }
      }
    ]
  }

  const main = `
import Foundation
import BareRPC

${PIPE_CLASS}

let pipeA = Pipe()
let pipeB = Pipe()
let client = HRPC(delegate: pipeA)
let server = HRPC(delegate: pipeB)
pipeA.peer = server
pipeB.peer = client

server.onDouble { req in
  return req! * 2
}

Task {
  let resp = try await client.double(UInt(21))
  precondition(resp == 42, "expected 42, got \\(resp)")
  print("OK")
  exit(0)
}
RunLoop.main.run()
`

  const result = runSwift(schema, hrpc, main)
  t.ok(result.ok, result.stderr)
  t.ok(result.stdout.includes('OK'), 'primitive uint roundtrip printed OK')
})

test(
  'swift: response-stream — server writes chunks, client reads all',
  { skip: isWindows },
  (t) => {
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

    const main = `
import Foundation
import BareRPC

${PIPE_CLASS}

let pipeA = Pipe()
let pipeB = Pipe()
let client = HRPC(delegate: pipeA)
let server = HRPC(delegate: pipeB)
pipeA.peer = server
pipeB.peer = client

server.onFeed { req, stream in
  for i: UInt in 0..<(req?.value ?? 0) {
    await stream.write(try encode(echoResponse, EchoResponse(value: i)))
  }
  await stream.end()
}

Task {
  let responseStream = try await client.feed(EchoRequest(value: 3))
  var collected: [UInt] = []
  for try await chunk in responseStream {
    let resp = try decode(echoResponse, chunk)
    collected.append(resp.value)
  }
  precondition(collected == [0, 1, 2], "got \\(collected)")
  print("OK")
  exit(0)
}
RunLoop.main.run()
`

    const result = runSwift(schema, hrpc, main)
    t.ok(result.ok, result.stderr)
    t.ok(result.stdout.includes('OK'), 'response-stream test printed OK')
  }
)

test(
  'swift: request-stream — client writes chunks, server sums and replies',
  { skip: isWindows },
  (t) => {
    const schema = makeSchema()
    const hrpc = {
      handlers: [
        {
          id: 0,
          name: '@test/collect',
          request: { name: '@test/echo-request', stream: true },
          response: { name: '@test/echo-response', stream: false }
        }
      ]
    }

    const main = `
import Foundation
import BareRPC

${PIPE_CLASS}

let pipeA = Pipe()
let pipeB = Pipe()
let client = HRPC(delegate: pipeA)
let server = HRPC(delegate: pipeB)
pipeA.peer = server
pipeB.peer = client

server.onCollect { stream in
  var total: UInt = 0
  for try await chunk in stream {
    let req = try decode(echoRequest, chunk)
    total += req.value
  }
  return EchoResponse(value: total)
}

Task {
  let response = try await client.collect { stream in
    await stream.write(try encode(echoRequest, EchoRequest(value: 10)))
    await stream.write(try encode(echoRequest, EchoRequest(value: 32)))
  }
  precondition(response?.value == 42, "expected 42, got \\(String(describing: response?.value))")
  print("OK")
  exit(0)
}
RunLoop.main.run()
`

    const result = runSwift(schema, hrpc, main)
    t.ok(result.ok, result.stderr)
    t.ok(result.stdout.includes('OK'), 'request-stream test printed OK')
  }
)

// --- JS-level tests (no Swift compilation needed) ---

test('uses delegate forwarder instead of closure wiring', (t) => {
  const hrpc = {
    handlers: [
      {
        id: 0,
        name: '@test/echo',
        request: { name: '@test/echo-request', stream: false },
        response: { name: '@test/echo-response', stream: false }
      },
      {
        id: 1,
        name: '@test/notify',
        request: { name: '@test/notify-request', stream: false, send: true },
        response: null
      }
    ]
  }

  const swift = generateSwift(hrpc)
  t.ok(swift.includes('_HRPCDelegateForwarder'), 'emits forwarder class')
  t.ok(swift.includes('public func receive(_ data: Data) async {'), 'receive is async')
  t.absent(swift.includes('onRequest ='), 'no closure wiring for requests')
  t.absent(swift.includes('onEvent ='), 'no closure wiring for events')
  t.ok(swift.includes('await req.reject('), 'dispatch uses await on reject')
  t.ok(swift.includes('await req.reply('), 'dispatch uses await on reply')
  t.ok(swift.includes('let transport: any RPCDelegate'), 'transport is a strong let')
  t.ok(swift.includes('didFailWith error: Error'), 'forwarder forwards didFailWith')
  t.ok(swift.includes('(EchoRequest?) async throws'), 'request handler takes optional arg')
  t.ok(swift.includes('(NotifyRequest?) async'), 'event handler takes optional arg')
})

test('primitive types use Primitive.Xxx() codecs', (t) => {
  const hrpc = {
    handlers: [
      {
        id: 0,
        name: '@test/ping',
        request: { name: 'uint', stream: false },
        response: { name: 'string', stream: false }
      },
      {
        id: 1,
        name: '@test/flag',
        request: { name: 'bool', stream: false, send: true },
        response: null
      }
    ]
  }

  const swift = generateSwift(hrpc)
  t.ok(swift.includes('Primitive.UInt()'), 'uint maps to Primitive.UInt()')
  t.ok(swift.includes('Primitive.UTF8()'), 'string maps to Primitive.UTF8()')
  t.ok(swift.includes('Primitive.Bool()'), 'bool maps to Primitive.Bool()')
  t.ok(swift.includes('(_ args: UInt?'), 'uint request arg type is UInt?')
  t.ok(swift.includes('-> String'), 'string response type is String')
  t.ok(swift.includes('(_ args: Bool?'), 'bool send-only arg type is Bool?')
  t.absent(swift.includes('Schema.'), 'no Schema. references for primitives')
})

test('request-stream: generates callback client method and IncomingStream server handler', (t) => {
  const hrpc = {
    handlers: [
      {
        id: 1,
        name: '@test/collect',
        request: { name: '@test/echo-request', stream: true },
        response: { name: '@test/echo-response', stream: false }
      }
    ]
  }
  const swift = generateSwift(hrpc)
  t.ok(
    swift.includes(
      'func collect(_ body: (OutgoingStream) async throws -> Void) async throws -> EchoResponse?'
    ),
    'client method signature'
  )
  t.ok(swift.includes('(IncomingStream) async throws -> EchoResponse?'), 'server handler type')
  t.ok(swift.includes('try await _rpc.streamRequest(command: 1)'), 'uses try await for actor call')
  t.ok(swift.includes('_requestStreamCommands: Set<UInt> = [1]'), 'emits routing set')
  t.ok(swift.includes('_requestStreamCommands.contains(req.command)'), 'router gates on command id')
  t.ok(swift.includes('outgoing.destroy('), 'destroys stream when body throws')
})

test('duplex: generates tuple client method and command-ID set', (t) => {
  const hrpc = {
    handlers: [
      {
        id: 3,
        name: '@test/pipe',
        request: { name: '@test/echo-request', stream: true },
        response: { name: '@test/echo-response', stream: true }
      }
    ]
  }
  const swift = generateSwift(hrpc)
  t.ok(
    swift.includes(
      'func pipe(_ body: (OutgoingStream, IncomingStream) async throws -> Void) async throws'
    ),
    'client method signature'
  )
  t.ok(
    swift.includes('(IncomingStream, OutgoingStream) async throws -> Void'),
    'server handler type'
  )
  t.ok(swift.includes('createBidirectionalStream(command: 3)'), 'uses createBidirectionalStream')
  t.ok(swift.includes('_duplexCommands: Set<UInt> = [3]'), 'emits duplex routing set')
  t.ok(swift.includes('_duplexCommands.contains(req.command)'), 'router gates on duplex command id')
})

test(
  'swift: duplex — client and server exchange chunks on both streams',
  { skip: isWindows },
  (t) => {
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

    const main = `
import Foundation
import BareRPC

${PIPE_CLASS}

let pipeA = Pipe()
let pipeB = Pipe()
let client = HRPC(delegate: pipeA)
let server = HRPC(delegate: pipeB)
pipeA.peer = server
pipeB.peer = client

server.onPipe { incoming, outgoing in
  for try await chunk in incoming {
    await outgoing.write(chunk)
  }
  await outgoing.end()
}

Task {
  try await client.pipe { outgoing, incoming in
    await outgoing.write(try encode(echoRequest, EchoRequest(value: 10)))
    await outgoing.write(try encode(echoRequest, EchoRequest(value: 32)))
    await outgoing.end()
    var total: UInt = 0
    for try await chunk in incoming {
      let item = try decode(echoRequest, chunk)
      total += item.value
    }
    precondition(total == 42, "expected 42, got \\(total)")
  }
  print("OK")
  exit(0)
}
RunLoop.main.run()
`

    const result = runSwift(schema, hrpc, main)
    t.ok(result.ok, result.stderr)
    t.ok(result.stdout.includes('OK'), 'duplex test printed OK')
  }
)

test('response-stream: generates IncomingStream client method and command-ID set', (t) => {
  const hrpc = {
    handlers: [
      {
        id: 2,
        name: '@test/feed',
        request: { name: '@test/echo-request', stream: false },
        response: { name: '@test/echo-response', stream: true }
      }
    ]
  }
  const swift = generateSwift(hrpc)
  t.ok(
    swift.includes('func feed(_ args: EchoRequest? = nil) async throws -> IncomingStream'),
    'client method signature'
  )
  t.ok(swift.includes('(EchoRequest?, OutgoingStream) async throws -> Void'), 'server handler type')
  t.ok(swift.includes('_responseStreamCommands'), 'emits routing set')
  t.ok(swift.includes('requestWithResponseStream(command: 2'), 'uses correct command id')
})

test('throws for unsupported primitive type at codegen time', (t) => {
  const hrpc = {
    handlers: [
      {
        id: 0,
        name: '@test/ping',
        request: { name: 'lexint', stream: false },
        response: { name: 'uint', stream: false }
      }
    ]
  }
  t.exception(
    () => generateSwift(hrpc),
    { code: 'UNSUPPORTED_TYPE' },
    'throws for unknown bare type'
  )
})

test('primitive-only schema omits import Schema', (t) => {
  const hrpc = {
    handlers: [
      {
        id: 0,
        name: '@test/double',
        request: { name: 'uint', stream: false },
        response: { name: 'uint', stream: false }
      }
    ]
  }
  const swift = generateSwift(hrpc)
  t.absent(swift.includes('import Schema'), 'no import Schema for primitive-only schema')
  t.ok(swift.includes('import CompactEncoding'), 'still imports CompactEncoding')
})

test('struct-type schema includes import Schema', (t) => {
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
  const swift = generateSwift(hrpc)
  t.ok(swift.includes('import Schema'), 'import Schema present when structs used')
})

test('toDisk writes hrpc.json, HRPC.swift, and Package.swift', async (t) => {
  const tmpDir = await t.tmp()
  const outDir = path.join(tmpDir, 'hrpc')

  const hrpcJson = {
    version: 1,
    schema: [
      {
        id: 0,
        name: '@test/hello',
        request: { name: '@test/hello-request', stream: false },
        response: { name: '@test/hello-response', stream: false },
        version: 1
      }
    ]
  }

  const fakeHrpc = {
    toJSON: () => hrpcJson,
    handlers: hrpcJson.schema
  }

  writeToDisk(fakeHrpc, outDir, {
    schemaPackagePath: '../schema',
    schemaPackageName: 'Schema',
    schemaPackageId: 'schema'
  })

  t.ok(fs.existsSync(path.join(outDir, 'hrpc.json')), 'hrpc.json exists')
  t.ok(fs.existsSync(path.join(outDir, 'Sources', 'HRPC.swift')), 'HRPC.swift exists')
  t.ok(fs.existsSync(path.join(outDir, 'Package.swift')), 'Package.swift exists')

  const swift = fs.readFileSync(path.join(outDir, 'Sources', 'HRPC.swift'), 'utf-8')
  t.ok(swift.includes('public class HRPC'), 'HRPC.swift has class definition')
  t.ok(swift.includes('case 0:'), 'HRPC.swift has dispatch for command 0')

  const pkg = fs.readFileSync(path.join(outDir, 'Package.swift'), 'utf-8')
  t.ok(pkg.includes('.library(name: "HRPC"'), 'Package.swift has library product')
  t.ok(pkg.includes('name: "HRPC"'), 'Package.swift has HRPC target')
  t.ok(pkg.includes('bare-rpc-swift'), 'Package.swift references bare-rpc-swift')
  t.ok(pkg.includes('../schema'), 'Package.swift uses schemaPackagePath')

  const json = JSON.parse(fs.readFileSync(path.join(outDir, 'hrpc.json'), 'utf-8'))
  t.is(json.version, 1, 'hrpc.json has version')
  t.ok(Array.isArray(json.schema), 'hrpc.json has schema array')
})

test('throws for invalid handler name', (t) => {
  t.exception(
    () =>
      generateSwift({
        handlers: [
          { id: 0, name: 'bad-name', request: { name: 'uint', stream: false }, response: null }
        ]
      }),
    { code: 'INVALID_HANDLER_NAME' }
  )
  t.exception(
    () =>
      generateSwift({
        handlers: [
          { id: 0, name: '@ns/Bad_Name', request: { name: 'uint', stream: false }, response: null }
        ]
      }),
    { code: 'INVALID_HANDLER_NAME' }
  )
})

test('throws for request-stream handler with no response', (t) => {
  t.exception(
    () =>
      generateSwift({
        handlers: [
          {
            id: 0,
            name: '@test/upload',
            request: { name: 'uint', stream: true },
            response: null
          }
        ]
      }),
    { code: 'STREAM_WITHOUT_RESPONSE' }
  )
})

test('throws for duplicate swift method name', (t) => {
  t.exception(
    () =>
      generateSwift({
        handlers: [
          {
            id: 0,
            name: '@ns/echo',
            request: { name: 'uint', stream: false },
            response: { name: 'uint', stream: false }
          },
          {
            id: 1,
            name: '@other/echo',
            request: { name: 'uint', stream: false },
            response: { name: 'uint', stream: false }
          }
        ]
      }),
    { code: 'DUPLICATE_METHOD_NAME' }
  )
})

test('duplex-only schema omits import Schema', (t) => {
  const hrpc = {
    handlers: [
      {
        id: 0,
        name: '@test/pipe',
        request: { name: '@test/pipe-request', stream: true },
        response: { name: '@test/pipe-response', stream: true }
      }
    ]
  }
  const swift = generateSwift(hrpc)
  t.absent(swift.includes('import Schema'), 'no import Schema for duplex-only schema')
})

test('throws for unary handler with null response and no send flag', (t) => {
  t.exception(
    () =>
      generateSwift({
        handlers: [
          { id: 0, name: '@test/void', request: { name: 'uint', stream: false }, response: null }
        ]
      }),
    { code: 'MISSING_RESPONSE' }
  )
})

test('throws for Swift keyword as method name', (t) => {
  t.exception(
    () =>
      generateSwift({
        handlers: [
          {
            id: 0,
            name: '@ns/for',
            request: { name: 'uint', stream: false },
            response: { name: 'uint', stream: false }
          }
        ]
      }),
    { code: 'RESERVED_KEYWORD' }
  )
})

test('response-stream dispatch rejects when createResponseStream returns nil', (t) => {
  const hrpc = {
    handlers: [
      {
        id: 0,
        name: '@test/feed',
        request: { name: 'uint', stream: false },
        response: { name: 'uint', stream: true }
      }
    ]
  }
  const swift = generateSwift(hrpc)
  t.ok(
    swift.includes('req.reject("Stream already open"'),
    'nil createResponseStream path calls req.reject'
  )
})

test('event dispatch decode error forwards to delegate rather than swallowing', (t) => {
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
  const swift = generateSwift(hrpc)
  t.ok(
    swift.includes('_forwarder.transport.rpc(_rpc, didFailWith: error)'),
    'decode error forwarded to delegate'
  )
})
