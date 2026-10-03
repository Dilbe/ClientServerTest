// The WebSocket endpoint: one long-lived connection per open browser tab,
// only for logged-in players. It carries the lobby (and later the game).

import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import {
  clientMessage,
  MAX_MESSAGE_BYTES,
  parseMessage,
  type ClientMessage,
  type ServerMessage,
} from "../shared/protocol.ts";
import { findAccount, type Account } from "./accounts.ts";
import { readCookie, SESSION_COOKIE } from "./cookies.ts";
import type { Db } from "./database.ts";
import { Lobby, type Refusal } from "./lobby.ts";
import { isAllowedOrigin } from "./origin.ts";
import { RateLimiter } from "./rate-limit.ts";
import { useSession } from "./sessions.ts";

export const WEBSOCKET_PATH = "/ws";
/** How often the server checks that each connection is still alive. */
const HEARTBEAT_MS = 30_000;
/** Messages per connection per second; more are dropped. */
const MESSAGES_PER_SECOND = 20;

export interface WebSocketOptions {
  db: Db;
  /** The version of the client files being served. */
  version: () => string;
  publicOrigin: string | undefined;
}

interface Client {
  ws: WebSocket;
  account: Account;
  tokenHash: string;
}

/** The open connections, so logging out can close them and the lobby knows who is online. */
export class Connections {
  private readonly clients = new Set<Client>();

  add(client: Client): void {
    this.clients.add(client);
  }

  remove(client: Client): void {
    this.clients.delete(client);
  }

  all(): Iterable<Client> {
    return this.clients;
  }

  isOnline(accountId: number): boolean {
    for (const client of this.clients) if (client.account.id === accountId) return true;
    return false;
  }

  closeSession(tokenHash: string): void {
    for (const client of this.clients) if (client.tokenHash === tokenHash) client.ws.close(4001, "logged out");
  }
}

export function attachWebSocket(httpServer: Server, connections: Connections, options: WebSocketOptions): void {
  // noServer: we decide ourselves which upgrade requests become our
  // WebSockets. Others are left alone (in development Vite uses one too).
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  const lobby = new Lobby((accountId) => connections.isOnline(accountId));
  /** Connections that answered the last heartbeat ping (see below). */
  const answeredPing = new WeakSet<WebSocket>();

  /** Sends every connected player the lobby as they see it. */
  function broadcastLobby(): void {
    for (const client of connections.all()) send(client.ws, lobby.snapshotFor(client.account.id));
  }

  httpServer.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (new URL(request.url ?? "/", "http://placeholder").pathname !== WEBSOCKET_PATH) return;

    // Check before accepting: a refused connection never becomes a WebSocket.
    if (!isAllowedOrigin(request, options.publicOrigin)) return refuse(socket, 403, "Forbidden");
    const token = readCookie(request, SESSION_COOKIE);
    const session = token === undefined ? undefined : useSession(options.db, token);
    const account = session && findAccount(options.db, session.accountId);
    if (!session || !account) return refuse(socket, 401, "Unauthorized");

    wss.handleUpgrade(request, socket, head, (ws) => {
      onConnection({ ws, account, tokenHash: session.tokenHash });
    });
  });

  function onConnection(client: Client): void {
    const { ws, account } = client;
    const wasOnline = connections.isOnline(account.id);
    connections.add(client);
    answeredPing.add(ws);
    ws.on("pong", () => answeredPing.add(ws));

    // Every (re)connect starts with a full snapshot, so a reconnect after a
    // dropped connection or a server restart works the same as a first visit.
    send(ws, { type: "hello", version: options.version(), displayName: account.displayName });
    if (wasOnline) send(ws, lobby.snapshotFor(account.id));
    else broadcastLobby(); // the others see this player come online

    const limiter = new RateLimiter(MESSAGES_PER_SECOND, 1000);
    ws.on("message", (data, isBinary) => {
      // Too many messages are dropped, like invalid ones, so a misbehaving
      // client can't keep the server busy.
      if (limiter.retryAfter("") > 0) return;
      limiter.record("");
      // Every message is checked against its schema; anything else is dropped.
      // The connection stays open, so a client bug doesn't disconnect the player.
      const message = isBinary ? undefined : parseMessage(clientMessage, data.toString());
      if (message === undefined) return;
      handleMessage(client, message);
    });

    ws.on("close", () => {
      connections.remove(client);
      // Disconnecting doesn't leave the game: on a phone that happens all the
      // time. The others only see the player go offline.
      if (!connections.isOnline(account.id)) broadcastLobby();
    });

    // Without an "error" listener, an error on one socket would crash the
    // whole process (an unhandled error event, like an unhandled exception).
    ws.on("error", () => ws.terminate());
  }

  function handleMessage(client: Client, message: ClientMessage): void {
    const player = { accountId: client.account.id, displayName: client.account.displayName };
    let refusal: Refusal;
    switch (message.type) {
      case "ping":
        send(client.ws, { type: "pong", id: message.id });
        return;
      case "create-game":
        refusal = lobby.create(player);
        break;
      case "join-game":
        refusal = lobby.join(player, message.gameId);
        break;
      case "leave-game":
        refusal = lobby.leave(player.accountId);
        break;
      case "start-game":
        refusal = lobby.start(player.accountId);
        break;
    }
    if (refusal !== undefined) send(client.ws, { type: "refused", reason: refusal });
    else broadcastLobby();
  }

  // Heartbeat: a phone that loses its network often doesn't close the
  // connection properly; it just goes quiet. Every 30 seconds the server
  // sends a WebSocket ping, which browsers answer automatically with a pong.
  // A connection that didn't answer the previous ping is closed.
  const heartbeat = setInterval(() => {
    for (const { ws } of connections.all()) {
      if (!answeredPing.has(ws)) {
        ws.terminate();
        continue;
      }
      answeredPing.delete(ws);
      ws.ping();
    }
  }, HEARTBEAT_MS);
  heartbeat.unref();
  httpServer.on("close", () => clearInterval(heartbeat));
}

/** Answers the upgrade request with an HTTP error and closes the connection. */
function refuse(socket: Duplex, status: number, text: string): void {
  socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

function send(ws: WebSocket, message: ServerMessage): void {
  ws.send(JSON.stringify(message));
}
