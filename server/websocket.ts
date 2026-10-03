// The WebSocket endpoint: one long-lived connection per open browser tab.

import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import { clientMessage, MAX_MESSAGE_BYTES, parseMessage, type ServerMessage } from "../shared/protocol.ts";

export const WEBSOCKET_PATH = "/ws";

export function attachWebSocket(httpServer: Server, version: string): void {
  // noServer: we decide ourselves which upgrade requests become our
  // WebSockets. Others are left alone (in development Vite uses one too).
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });

  httpServer.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (new URL(request.url ?? "/", "http://placeholder").pathname !== WEBSOCKET_PATH) return;
    wss.handleUpgrade(request, socket, head, (ws) => onConnection(ws, version));
  });
}

function onConnection(ws: WebSocket, version: string): void {
  send(ws, { type: "hello", version });

  ws.on("message", (data, isBinary) => {
    // Every message is checked against its schema; anything else is dropped.
    // The connection stays open, so a client bug doesn't disconnect the player.
    const message = isBinary ? undefined : parseMessage(clientMessage, data.toString());
    if (message === undefined) return;

    switch (message.type) {
      case "ping":
        send(ws, { type: "pong", id: message.id });
        break;
    }
  });

  // Without an "error" listener, an error on one socket would crash the
  // whole process (an unhandled error event, like an unhandled exception).
  ws.on("error", () => ws.terminate());
}

function send(ws: WebSocket, message: ServerMessage): void {
  ws.send(JSON.stringify(message));
}
