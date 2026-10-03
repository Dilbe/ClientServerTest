import { test } from "node:test";
import assert from "node:assert/strict";
import { clientMessage, parseMessage } from "./protocol.ts";

test("parses a valid message", () => {
  assert.deepEqual(parseMessage(clientMessage, '{"type":"ping","id":3}'), { type: "ping", id: 3 });
});

test("rejects text that isn't JSON", () => {
  assert.equal(parseMessage(clientMessage, "not json"), undefined);
});

test("rejects an unknown message type", () => {
  assert.equal(parseMessage(clientMessage, '{"type":"delete-everything"}'), undefined);
});

test("rejects a message with a field of the wrong type", () => {
  assert.equal(parseMessage(clientMessage, '{"type":"ping","id":"3"}'), undefined);
  assert.equal(parseMessage(clientMessage, '{"type":"ping","id":-1}'), undefined);
});
