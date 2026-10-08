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

/** How long a test waits for the server's next message before it fails. */
const MESSAGE_TIMEOUT_MS = 5000;

export interface TestSocket {
  ws: WebSocket;
  /** The next message; fails when none comes within MESSAGE_TIMEOUT_MS. */
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
    turnCycleMs: options.turnCycleMs,
  });
  httpServer.listen(0, "127.0.0.1");
  await once(httpServer, "listening");
  const origin = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  // Every socket a test opened, to close on shutdown: a test that fails
  // before closing its own sockets would otherwise keep Node running.
  const sockets: WebSocket[] = [];

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
      sockets.push(ws);
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
      // A message that never comes fails the test after a while, instead of
      // making the whole test run hang.
      const next = (): Promise<any> => {
        if (queue.length > 0) return Promise.resolve(queue.shift());
        return new Promise((resolve, reject) => {
          const deliver = (message: unknown) => {
            clearTimeout(timer);
            resolve(message);
          };
          const timer = setTimeout(() => {
            // Stop waiting, so a later message goes to the queue, not to us.
            waiting.splice(waiting.indexOf(deliver), 1);
            reject(new Error(`No message within ${MESSAGE_TIMEOUT_MS} ms`));
          }, MESSAGE_TIMEOUT_MS);
          waiting.push(deliver);
        });
      };
      return {
        ws,
        next,
        async nextOf(type) {
          for (;;) {
            const message = await next().catch((error: Error) => {
              throw new Error(`Waiting for a "${type}" message: ${error.message}`);
            });
            if (message.type === type) return message;
          }
        },
      };
    },
    async close() {
      stopGames();
      for (const ws of sockets) ws.terminate();
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
