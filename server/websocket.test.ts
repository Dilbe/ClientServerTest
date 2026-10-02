import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";
import { MAX_MESSAGE_BYTES } from "../shared/protocol.ts";
import { attachWebSocket } from "./websocket.ts";

const httpServer = createServer();
attachWebSocket(httpServer, "test-version");
httpServer.listen(0, "127.0.0.1");
await once(httpServer, "listening");
const url = `ws://127.0.0.1:${(httpServer.address() as AddressInfo).port}/ws`;
after(() => httpServer.close());

/** Opens a connection and collects every message the server sends. */
async function connect(): Promise<{ ws: WebSocket; next: () => Promise<unknown> }> {
  const ws = new WebSocket(url);
  const queue: unknown[] = [];
  const waiting: ((m: unknown) => void)[] = [];
  ws.on("message", (data) => {
    const message = JSON.parse(data.toString());
    const resolve = waiting.shift();
    if (resolve) resolve(message);
    else queue.push(message);
  });
  await once(ws, "open");
  return {
    ws,
    next: () => (queue.length > 0 ? Promise.resolve(queue.shift()) : new Promise((r) => waiting.push(r))),
  };
}

test("sends hello with the version on connect", async () => {
  const { ws, next } = await connect();
  assert.deepEqual(await next(), { type: "hello", version: "test-version" });
  ws.close();
});

test("answers a ping, and ignores invalid messages without disconnecting", async () => {
  const { ws, next } = await connect();
  await next(); // hello
  ws.send("garbage");
  ws.send('{"type":"ping","id":"wrong"}');
  ws.send('{"type":"ping","id":7}');
  assert.deepEqual(await next(), { type: "pong", id: 7 });
  ws.close();
});

test("closes the connection on a message that is too large", async () => {
  const { ws, next } = await connect();
  await next(); // hello
  ws.send("x".repeat(MAX_MESSAGE_BYTES + 1));
  const [code] = await once(ws, "close");
  assert.equal(code, 1009); // 1009 = "message too big"
});
