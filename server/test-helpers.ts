// Helpers for tests that talk to a real server over HTTP and WebSocket.

import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";
import { createAppServer } from "./app.ts";
import { openDatabase, type Db } from "./database.ts";

export interface TestServer {
  db: Db;
  origin: string;
  /** Sends a request as our own page would: with the right Origin and JSON. */
  post(path: string, body: unknown, cookie?: string): Promise<Response>;
  get(path: string, cookie?: string): Promise<Response>;
  /** Signs up and returns the session cookie ("session=..."). */
  signup(accountName: string, displayName?: string, password?: string): Promise<string>;
  connect(cookie: string | undefined, origin?: string): Promise<TestSocket>;
  /**
   * Stops the server like a normal shutdown (the games save the server
   * time). The database is closed too, unless the test passed its own.
   */
  close(): Promise<void>;
}

export interface TestSocket {
  ws: WebSocket;
  next(): Promise<any>;
  /** The next message of this type; skips messages of other types. */
  nextOf(type: string): Promise<any>;
}

export async function startTestServer(
  options: {
    production?: boolean;
    signupsPerHour?: number;
    turnCycleMs?: number;
    /** As if behind the hosting platform's proxy (see config.ts). */
    trustProxy?: boolean;
    /** A database to use, to start a second server on it later ("a restart"). */
    db?: Db;
  } = {},
): Promise<TestServer> {
  const db = options.db ?? openDatabase(":memory:");
  const { httpServer, stopGames } = createAppServer({
    db,
    production: options.production ?? false,
    trustProxy: options.trustProxy ?? false,
    publicOrigin: undefined,
    contactEmail: "owner@example.com",
    version: () => "test-version",
    signupsPerHour: options.signupsPerHour ?? 1000,
    turnCycleMs: options.turnCycleMs ?? 60_000,
  });
  httpServer.listen(0, "127.0.0.1");
  await once(httpServer, "listening");
  const origin = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;

  const server: TestServer = {
    db,
    origin,
    post: (path, body, cookie) =>
      fetch(origin + path, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: origin, ...(cookie ? { Cookie: cookie } : {}) },
        body: JSON.stringify(body),
      }),
    get: (path, cookie) => fetch(origin + path, { headers: cookie ? { Cookie: cookie } : {} }),
    async signup(accountName, displayName = accountName, password = "correct horse battery") {
      const response = await server.post("/api/signup", { accountName, displayName, password });
      if (response.status !== 201) throw new Error(`signup failed: ${response.status} ${await response.text()}`);
      return sessionCookie(response)!;
    },
    async connect(cookie, wsOrigin = origin) {
      const ws = new WebSocket(origin.replace("http", "ws") + "/ws", {
        headers: { Origin: wsOrigin, ...(cookie ? { Cookie: cookie } : {}) },
      });
      const queue: unknown[] = [];
      const waiting: ((m: unknown) => void)[] = [];
      ws.on("message", (data) => {
        const message = JSON.parse(data.toString());
        const resolve = waiting.shift();
        if (resolve) resolve(message);
        else queue.push(message);
      });
      await new Promise<void>((resolve, reject) => {
        ws.once("open", () => resolve());
        ws.once("unexpected-response", (_request, response) => reject(new Error(`HTTP ${response.statusCode}`)));
        ws.once("error", reject);
      });
      const next = (): Promise<any> =>
        queue.length > 0 ? Promise.resolve(queue.shift()) : new Promise((r) => waiting.push(r));
      return {
        ws,
        next,
        async nextOf(type) {
          for (;;) {
            const message = await next();
            if (message.type === type) return message;
          }
        },
      };
    },
    async close() {
      stopGames();
      httpServer.closeAllConnections();
      httpServer.close();
      if (!options.db) db.close();
    },
  };
  return server;
}

/** The "session=..." part of a response's Set-Cookie header. */
export function sessionCookie(response: Response): string | undefined {
  return response.headers
    .getSetCookie()
    .find((c) => c.startsWith("session="))
    ?.split(";")[0];
}
