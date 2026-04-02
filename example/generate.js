'use strict'

const path = require('path')
const SwiftHyperschema = require('hyperschema-swift')
const SwiftHRPC = require('hrpc-swift')

const SCHEMA_DIR = path.join(__dirname, 'swift', 'schema')
const HRPC_DIR = path.join(__dirname, 'swift', 'hrpc')

// -- Define schema types --

const schema = SwiftHyperschema.from(null)
const ns = schema.namespace('chat')

ns.register({
  name: 'message',
  fields: [
    { name: 'id', type: 'uint', required: true },
    { name: 'text', type: 'string', required: true },
    { name: 'timestamp', type: 'uint', required: true }
  ]
})

ns.register({
  name: 'send-message-request',
  fields: [{ name: 'text', type: 'string', required: true }]
})

ns.register({
  name: 'send-message-response',
  fields: [
    { name: 'id', type: 'uint', required: true },
    { name: 'timestamp', type: 'uint', required: true }
  ]
})

ns.register({
  name: 'get-history-request',
  fields: [{ name: 'limit', type: 'uint', required: true }]
})

ns.register({
  name: 'get-history-response',
  fields: [{ name: 'messages', type: '@chat/message', array: true, required: true }]
})

// -- Define RPC handlers --

const hrpc = SwiftHRPC.from(schema)
const rpc = hrpc.namespace('chat')

rpc.register({
  name: 'send-message',
  request: { name: '@chat/send-message-request', stream: false },
  response: { name: '@chat/send-message-response', stream: false }
})

rpc.register({
  name: 'get-history',
  request: { name: '@chat/get-history-request', stream: false },
  response: { name: '@chat/get-history-response', stream: false }
})

rpc.register({
  name: 'new-message',
  request: { name: '@chat/message', stream: false, send: true },
  response: null
})

// -- Write to disk --

SwiftHyperschema.toDisk(schema, SCHEMA_DIR)
console.log('Wrote schema to', SCHEMA_DIR)

SwiftHRPC.toDisk(hrpc, HRPC_DIR, {
  schemaPackagePath: '../schema',
  schemaPackageName: 'Schema',
  schemaPackageId: 'schema'
})
console.log('Wrote HRPC to', HRPC_DIR)
