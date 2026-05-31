'use strict'

const test = require('brittle')
const SwiftHRPC = require('../index.js')
const { runSwiftMultiModule } = require('./helpers/swift-multimodule')
const { makeSchema } = require('./helpers/schema')
const { isWindows } = require('which-runtime')

// The single-module workspace (helpers/swift.js) strips `public` and
// `import Schema` so everything compiles in one target. That leaves the
// shipped shape — a `public class HRPC` in its own module importing a separate
// Schema module — compiled by nothing. This test closes that gap: it generates
// the real `Schema` and `HRPC` packages with their own `Package.swift` (via
// each generator's `toDisk`), wires them by path dependency, and runs a real
// roundtrip — the same consumer flow the example demonstrates, without an
// out-of-band `npm install`.

test(
  'multimodule: public HRPC compiles against a separate Schema module',
  { skip: isWindows },
  (t) => {
    const schema = makeSchema()

    const hrpc = SwiftHRPC.from(schema)
    const rpc = hrpc.namespace('test')
    rpc.register({
      name: 'echo',
      request: { name: '@test/echo-request', stream: false },
      response: { name: '@test/echo-response', stream: false }
    })

    const main = `
import Foundation
import BareRPC
import HRPC
import Schema

class Pipe: RPCDelegate {
  var peer: HRPC?
  private var pendingDelivery: Task<Void, Never> = Task {}
  func rpc(_ rpc: RPC, send data: Data) {
    let peer = self.peer
    let prev = pendingDelivery
    pendingDelivery = Task {
      await prev.value
      await peer?.receive(data)
    }
  }
}

let pipeA = Pipe()
let pipeB = Pipe()
let client = HRPC(delegate: pipeA)
let server = HRPC(delegate: pipeB)
pipeA.peer = server
pipeB.peer = client

server.onEcho { req in
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

    const result = runSwiftMultiModule(schema, hrpc, main)
    t.ok(result.ok, result.stderr)
    t.ok(result.stdout.includes('OK'), 'cross-module roundtrip printed OK')
  }
)
