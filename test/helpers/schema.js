'use strict'

const SwiftHyperschema = require('hyperschema-swift')
const { isBare } = require('which-runtime')

function makeSchema() {
  const schema = SwiftHyperschema.from(null)
  const ns = schema.namespace('test')

  ns.register({
    name: 'echo-request',
    fields: [{ name: 'value', type: 'uint', required: true }]
  })

  ns.register({
    name: 'echo-response',
    fields: [{ name: 'value', type: 'uint', required: true }]
  })

  ns.register({
    name: 'notify-request',
    fields: [{ name: 'code', type: 'uint', required: true }]
  })

  return schema
}

const PIPE_CLASS = `
final class Pipe: Transport, @unchecked Sendable {
  let input: AsyncStream<Data>
  private let continuation: AsyncStream<Data>.Continuation
  var peer: Pipe?
  var captured = Data()
  var captureMode = false

  init() {
    (input, continuation) = AsyncStream.makeStream()
  }

  func receive(_ data: Data) {
    continuation.yield(data)
  }

  func write(_ data: Data) async throws {
    if captureMode {
      captured.append(data)
    } else {
      peer?.receive(data)
    }
  }

  func close() async {
    continuation.finish()
  }

  func makeAsyncIterator() -> AsyncStream<Data>.AsyncIterator {
    input.makeAsyncIterator()
  }
}
`

// A transport that prints the first frame written and exits, so a test can
// read it without waiting.
const PRINT_FIRST_FRAME_STRUCT = `
struct PrintFirstFrame: Transport {
  func write(_ data: Data) async throws {
    print(data.base64EncodedString())
    exit(0)
  }

  func close() async {}

  func makeAsyncIterator() -> AsyncStream<Data>.AsyncIterator {
    AsyncStream<Data> { _ in }.makeAsyncIterator()
  }
}
`

// Set BARE_RPC_SWIFT_PATH to build the tests against a local checkout of
// bare-rpc-swift rather than its main branch.
function bareRpcSwiftLocalPath() {
  return env().BARE_RPC_SWIFT_PATH || null
}

function bareRpcSwiftDependency() {
  const local = bareRpcSwiftLocalPath()
  if (local) return `.package(path: ${JSON.stringify(local)})`
  return '.package(url: "https://github.com/holepunchto/bare-rpc-swift", branch: "main")'
}

function env() {
  return isBare ? require('bare-env') : process.env
}

module.exports = {
  makeSchema,
  PIPE_CLASS,
  PRINT_FIRST_FRAME_STRUCT,
  bareRpcSwiftLocalPath,
  bareRpcSwiftDependency
}
