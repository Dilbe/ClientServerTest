// The WebSocket endpoint: one long-lived connection per open browser tab,
// only for logged-in players.

import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import { clientMessage, MAX_MESSAGE_BYTES, parseMessage, type ServerMessage } from "../shared/protocol.ts";
import { findAccount, type Account } from "./accounts.ts";
import { readCookie, SESSION_COOKIE } from "./cookies.ts";
import type { Db } from "./database.ts";
import { isAllowedOrigin } from "./origin.ts";
import { useSession } from "./sessions.ts";

export const WEBSOCKET_PATH = "/ws";

export interface WebSocketOptions {
  db: Db;
  /** The version of the client files being served. */
  version: () => string;
  publicOrigin: string | undefined;
}

/** The open connections, by session, so logging out can close them. */
export class Connections {
  private readonly bySession = new Map<string, Set<WebSocket>>();

  add(tokenHash: string, ws: WebSocket): void {
    let set = this.bySession.get(tokenHash);
    if (!set) this.bySession.set(tokenHash, (set = new Set()));
    set.add(ws);
    ws.on("close", () => {
      set.delete(ws);
      if (set.size === 0) this.bySession.delete(tokenHash);
    });
  }

  closeSession(tokenHash: string): void {
    for (const ws of this.bySession.get(tokenHash) ?? []) ws.close(4001, "logged out");
  }
}

export function attachWebSocket(httpServer: Server, connections: Connections, options: WebSocketOptions): void {
  // noServer: we decide ourselves which upgrade requests become our
  // WebSockets. Others are left alone (in development Vite uses one too).
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });

  httpServer.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (new URL(request.url ?? "/", "http://placeholder").pathname !== WEBSOCKET_PATH) return;

    // Check before accepting: a refused connection never becomes a WebSocket.
    if (!isAllowedOrigin(request, options.publicOrigin)) return refuse(socket, 403, "Forbidden");
    const token = readCookie(request, SESSION_COOKIE);
    const session = token === undefined ? undefined : useSession(options.db, token);
    const account = session && findAccount(options.db, session.accountId);
    if (!session || !account) return refuse(socket, 401, "Unauthorized");

    wss.handleUpgrade(request, socket, head, (ws) => {
      connections.add(session.tokenHash, ws);
      onConnection(ws, account, options.version());
    });
  });
}

/** Answers the upgrade request with an HTTP error and closes the connection. */
function refuse(socket: Duplex, status: number, text: string): void {
  socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

function onConnection(ws: WebSocket, account: Account, version: string): void {
  send(ws, { type: "hello", version, displayName: account.displayName });

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
