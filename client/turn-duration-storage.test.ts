import { test } from "node:test";
import assert from "node:assert/strict";
import { loadTurnDuration, saveTurnDuration, TURN_DURATION_KEY } from "./turn-duration-storage.ts";
import type { KeyValueStorage } from "./character-filter-storage.ts";

/** A stand-in for the browser's localStorage. */
function memoryStorage(entries: Record<string, string> = {}): KeyValueStorage {
  const map = new Map(Object.entries(entries));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

test("without a remembered turn duration, a new game gets Normal", () => {
  assert.equal(loadTurnDuration(memoryStorage()), "normal");
});

test("the turn duration a game started with is the next game's default (issue #399)", () => {
  const storage = memoryStorage();
  saveTurnDuration(storage, "crawl");
  assert.equal(loadTurnDuration(storage), "crawl");
});

test("a stored turn duration that isn't one of the choices gives Normal", () => {
  assert.equal(loadTurnDuration(memoryStorage({ [TURN_DURATION_KEY]: "warp" })), "normal");
  assert.equal(loadTurnDuration(memoryStorage({ [TURN_DURATION_KEY]: "" })), "normal");
});
