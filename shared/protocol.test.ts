import { test } from "node:test";
import assert from "node:assert/strict";
import { clientMessage, MAX_PLANNED_ACTIONS, parseMessage } from "./protocol.ts";

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

test("parses a plan, and rejects one that doesn't match its type", () => {
  assert.deepEqual(
    parseMessage(clientMessage, '{"type":"set-plan","characterId":1,"plan":[{"type":"attack","monsterId":0}]}'),
    { type: "set-plan", characterId: 1, plan: [{ type: "attack", monsterId: 0 }] },
  );
  assert.equal(
    parseMessage(clientMessage, '{"type":"set-plan","characterId":1,"plan":[{"type":"attack","to":{"q":0,"r":0}}]}'),
    undefined,
  );
  assert.equal(
    parseMessage(clientMessage, '{"type":"set-plan","characterId":1,"plan":[{"type":"teleport","to":{"q":0,"r":0}}]}'),
    undefined,
  );
  // A single action instead of a list, as before plans had several actions.
  assert.equal(
    parseMessage(clientMessage, '{"type":"set-plan","characterId":1,"plan":{"type":"attack","monsterId":0}}'),
    undefined,
  );
  assert.equal(parseMessage(clientMessage, '{"type":"clear-plan","characterId":0}'), undefined);
});

test("a plan has at least one action and at most MAX_PLANNED_ACTIONS", () => {
  const plan = (n: number) =>
    JSON.stringify({ type: "set-plan", characterId: 1, plan: Array(n).fill({ type: "attack", monsterId: 0 }) });
  assert.equal(parseMessage(clientMessage, plan(0)), undefined);
  assert.notEqual(parseMessage(clientMessage, plan(MAX_PLANNED_ACTIONS)), undefined);
  assert.equal(parseMessage(clientMessage, plan(MAX_PLANNED_ACTIONS + 1)), undefined);
});
