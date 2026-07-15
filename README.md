# hrpc-swift

Swift code generator for [HRPC](https://github.com/holepunchto/hrpc). Given an HRPC schema it emits a Swift package with a typed `HRPC` class for type-safe RPC over [bare-rpc-swift](https://github.com/holepunchto/bare-rpc-swift), using [compact-encoding-swift](https://github.com/holepunchto/compact-encoding-swift) for the wire format.

```
npm i hrpc-swift
```

## Usage

`hrpc-swift` extends the [`hrpc`](https://github.com/holepunchto/hrpc) builder. Define your types with [`hyperschema-swift`](https://github.com/holepunchto/hyperschema-swift), register RPC handlers, then write both packages to disk.

```js
const SwiftHyperschema = require('hyperschema-swift')
const SwiftHRPC = require('hrpc-swift')

// Define schema types
const schema = SwiftHyperschema.from('./spec/schema')
const types = schema.namespace('chat')

types.register({
  name: 'send-message-request',
  fields: [{ name: 'text', type: 'string', required: true }]
})

types.register({
  name: 'send-message-response',
  fields: [{ name: 'id', type: 'uint', required: true }]
})

// Define RPC handlers
const hrpc = SwiftHRPC.from(schema)
const rpc = hrpc.namespace('chat')

rpc.register({
  name: 'send-message',
  request: { name: '@chat/send-message-request', stream: false },
  response: { name: '@chat/send-message-response', stream: false }
})

// Write the generated Swift packages
SwiftHyperschema.toDisk(schema, './spec/schema')
SwiftHRPC.toDisk(hrpc, './spec/hrpc', {
  schemaPackagePath: '../schema',
  schemaPackageName: 'Schema',
  schemaPackageId: 'schema'
})
```

`SwiftHRPC.toDisk(hrpc, dir, opts)` writes three files into `dir`:

- `Sources/HRPC.swift` - the generated `HRPC` class (typed client methods and server handler registration).
- `Package.swift` - an SPM manifest depending on `bare-rpc-swift` and the generated schema package.
- `hrpc.json` - the append-only schema snapshot, shared with the JavaScript `hrpc` output so the two stay wire-compatible.

### Options

`toDisk` takes an options object describing the generated schema package the HRPC package depends on:

| Option              | Default     | Description                                                         |
| ------------------- | ----------- | ------------------------------------------------------------------- |
| `schemaPackagePath` | `../schema` | Path to the generated schema package, relative to the HRPC package. |
| `schemaPackageName` | `Schema`    | The schema module's product name.                                   |
| `schemaPackageId`   | `schema`    | The schema package's SPM identity.                                  |

See [`example/generate.js`](example/generate.js) for a complete script.

## License

Apache-2.0
