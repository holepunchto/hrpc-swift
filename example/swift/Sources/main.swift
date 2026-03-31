import Foundation
import BareRPC
import HRPC
import Schema

// In-memory transport: routes data between two HRPC instances
class Pipe: RPCDelegate {
  var peer: HRPC?
  func rpc(_ rpc: RPC, send data: Data) {
    peer?.receive(data)
  }
}

// -- Set up server and client --

let serverPipe = Pipe()
let clientPipe = Pipe()
let server = HRPC(delegate: serverPipe)
let client = HRPC(delegate: clientPipe)
serverPipe.peer = client
clientPipe.peer = server

// -- Server-side: message storage and handlers --

var messages: [Message] = []
var nextId: UInt = 1

server.onSendMessage { req in
  let id = nextId
  nextId += 1
  let timestamp = UInt(Date().timeIntervalSince1970)
  let msg = Message(id: id, text: req.text, timestamp: timestamp)
  messages.append(msg)

  // Notify the client about the new message
  try server.newMessage(msg)

  return SendMessageResponse(id: id, timestamp: timestamp)
}

server.onGetHistory { req in
  let limit = Int(req.limit)
  let slice = Array(messages.suffix(limit))
  return GetHistoryResponse(messages: slice)
}

// -- Client-side: listen for new message events --

client.onNewMessage { msg in
  print("[event] New message #\(msg.id): \"\(msg.text)\"")
}

// -- Run the demo --

Task {
  // Send some messages
  let resp1 = try await client.sendMessage(SendMessageRequest(text: "Hello!"))
  print("[client] Sent message, got id=\(resp1.id)")

  let resp2 = try await client.sendMessage(SendMessageRequest(text: "How's it going?"))
  print("[client] Sent message, got id=\(resp2.id)")

  let resp3 = try await client.sendMessage(SendMessageRequest(text: "This is hrpc-swift in action"))
  print("[client] Sent message, got id=\(resp3.id)")

  // Small delay to let events propagate
  try await Task.sleep(nanoseconds: 100_000_000)

  // Fetch history
  let history = try await client.getHistory(GetHistoryRequest(limit: 10))
  print("\n[client] Chat history (\(history.messages.count) messages):")
  for msg in history.messages {
    print("  #\(msg.id): \"\(msg.text)\"")
  }

  // Terminate the process since RunLoop.main.run() below blocks indefinitely
  exit(0)
}

RunLoop.main.run()
