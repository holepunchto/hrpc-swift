# Changelog

## 1.0.0

First stable release.

- Generates a typed Swift `HRPC` class from an HRPC schema, covering unary, send-only, response-stream, request-stream, and duplex handlers.
- Generated `Package.swift` pins `bare-rpc-swift` with `from: "1.0.0"`.
- Handler names may be kebab-case or camelCase, matching the JavaScript `hrpc` compiler.
