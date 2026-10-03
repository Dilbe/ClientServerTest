import { test, after } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { MAX_MESSAGE_BYTES } from "../shared/protocol.ts";
import { startTestServer } from "./test-helpers.ts";

const server = await startTestServer();
after(() => server.close());
const cookie = await server.signup("alice", "Alice");

test("refuses a connection without a session", async () => {
  await assert.rejects(server.connect(undefined), /HTTP 401/);
  await assert.rejects(server.connect("session=made-up-token"), /HTTP 401/);
});

test("refuses a connection from another website, even with a valid session", async () => {
  await assert.rejects(server.connect(cookie, "https://evil.example"), /HTTP 403/);
});

test("sends hello with the version and display name on connect", async () => {
  const { ws, next } = await server.connect(cookie);
  assert.deepEqual(await next(), { type: "hello", version: "test-version", displayName: "Alice" });
  ws.close();
});

test("answers a ping, and ignores invalid messages without disconnecting", async () => {
  const { ws, next } = await server.connect(cookie);
  await next(); // hello
  ws.send("garbage");
  ws.send('{"type":"ping","id":"wrong"}');
  ws.send('{"type":"ping","id":7}');
  assert.deepEqual(await next(), { type: "pong", id: 7 });
  ws.close();
});

test("closes the connection on a message that is too large", async () => {
  const { ws, next } = await server.connect(cookie);
  await next(); // hello
  ws.send("x".repeat(MAX_MESSAGE_BYTES + 1));
  const [code] = await once(ws, "close");
  assert.equal(code, 1009); // 1009 = "message too big"
});

test("logging out closes that session's connections", async () => {
  const other = await server.signup("bob", "Bob");
  const { ws, next } = await server.connect(other);
  await next(); // hello
  const closed = once(ws, "close");
  await server.post("/api/logout", {}, other);
  const [code] = await closed;
  assert.equal(code, 4001);
  await assert.rejects(server.connect(other), /HTTP 401/);
});
