import { test } from "node:test";
import assert from "node:assert/strict";
import { clientMessage, MAX_PLANNED_ACTIONS, parseMessage } from "./protocol.ts";
import { describeTurnDuration, TURN_DURATION_IDS } from "./turn-durations.ts";

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
  assert.deepEqual(
    parseMessage(clientMessage, '{"type":"set-plan","characterId":1,"plan":[{"type":"openDoor","door":{"q":1,"r":6}}]}'),
    { type: "set-plan", characterId: 1, plan: [{ type: "openDoor", door: { q: 1, r: 6 } }] },
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

test("choose-dungeon only takes the id of a real dungeon", () => {
  assert.deepEqual(parseMessage(clientMessage, '{"type":"choose-dungeon","dungeonId":"second"}'), {
    type: "choose-dungeon",
    dungeonId: "second",
  });
  // Ids are used to look the dungeon up in an object, so names that every
  // object has must not get through.
  for (const id of ["third", "toString", "__proto__", ""]) {
    assert.equal(parseMessage(clientMessage, JSON.stringify({ type: "choose-dungeon", dungeonId: id })), undefined);
  }
});

test("create-game takes one of the turn durations, normal when left out", () => {
  const create = (turnDuration: unknown) =>
    parseMessage(clientMessage, JSON.stringify({ type: "create-game", characters: [1], turnDuration }));
  for (const id of TURN_DURATION_IDS) assert.equal((create(id) as { turnDuration: string }).turnDuration, id);
  assert.equal((create(undefined) as { turnDuration: string }).turnDuration, "normal");
  assert.equal(create("instant"), undefined);
  assert.equal(create(10), undefined);
});

test("each turn duration is shown with its length", () => {
  assert.deepEqual(TURN_DURATION_IDS.map(describeTurnDuration), [
    "Quick (10 seconds)",
    "Normal (30 seconds)",
    "Slow (60 seconds)",
    "Crawl (5 minutes)",
  ]);
});

test("a player chooses 1 to 3 characters, each at most once", () => {
  const create = (characters: unknown) => parseMessage(clientMessage, JSON.stringify({ type: "create-game", characters }));
  assert.deepEqual(create([1, 3]), { type: "create-game", characters: [1, 3], turnDuration: "normal" });
  assert.equal(create([]), undefined);
  assert.equal(create([1, 2, 3, 4]), undefined);
  assert.equal(create([2, 2]), undefined);
  assert.equal(create([0]), undefined);
  assert.equal(create(undefined), undefined);
});
