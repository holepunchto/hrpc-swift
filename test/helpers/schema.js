'use strict'

const SwiftHyperschema = require('hyperschema-swift')

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
class Pipe: RPCDelegate {
  var peer: HRPC?
  var captured = Data()
  var captureMode = false
  func rpc(_ rpc: RPC, send data: Data) {
    if captureMode {
      captured.append(data)
    } else {
      peer?.receive(data)
    }
  }
}
`

module.exports = { makeSchema, PIPE_CLASS }
