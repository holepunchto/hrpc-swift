# Chat Example

A runnable Swift project demonstrating hrpc-swift codegen with a chat service schema. Client and server communicate over an in-memory pipe in a single process.

## Setup

```bash
npm install
node generate.js
cd swift
swift run
```

## What it does

The `generate.js` script defines a chat schema with three handlers:

- **send-message** — request/response: sends a message, returns id and timestamp
- **get-history** — request/response: fetches recent messages
- **new-message** — send-only event: notifies when a new message arrives

Running `node generate.js` produces two local SPM packages (`swift/schema/` and `swift/hrpc/`) containing the generated Swift types and RPC code.

The Swift executable (`swift/Sources/main.swift`) creates an in-memory pipe between a server and client, sends a few messages, listens for new-message events, and fetches chat history.
