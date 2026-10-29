import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULTS,
  loadFilter,
  saveFilter,
  SHARED_KEY,
  storageKey,
  type KeyValueStorage,
} from "./character-filter-storage.ts";

/** A stand-in for the browser's localStorage. */
function memoryStorage(entries: Record<string, string> = {}): KeyValueStorage & { entries: Map<string, string> } {
  const map = new Map(Object.entries(entries));
  return {
    entries: map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

const allSelected = { maxLevel: true, belowMaxLevel: true, resting: true, available: true, working: true };

test("a screen without a remembered setting starts from the defaults", () => {
  const storage = memoryStorage();
  assert.deepEqual(loadFilter(storage, "characters"), DEFAULTS);
  assert.deepEqual(loadFilter(storage, "choice"), DEFAULTS);
});

test("each screen remembers its own setting, under its own key", () => {
  const storage = memoryStorage();
  saveFilter(storage, "choice", allSelected);
  assert.deepEqual(loadFilter(storage, "choice"), allSelected);
  assert.deepEqual(loadFilter(storage, "characters"), DEFAULTS);
  assert.ok(storage.entries.has(storageKey("choice")));
  assert.ok(!storage.entries.has(storageKey("characters")));
});

test("'In a game' isn't remembered", () => {
  const storage = memoryStorage();
  const setting = { ...DEFAULTS, inGame: true };
  saveFilter(storage, "characters", setting);
  assert.ok(!storage.entries.get(storageKey("characters"))!.includes("inGame"));
});

test("a stored setting that isn't valid gives the defaults", () => {
  const storage = memoryStorage({
    [storageKey("characters")]: "not json",
    [storageKey("choice")]: JSON.stringify({ maxLevel: "yes" }),
  });
  assert.deepEqual(loadFilter(storage, "characters"), DEFAULTS);
  assert.deepEqual(loadFilter(storage, "choice"), DEFAULTS);
});

test("a setting saved before 'Working' existed gets it unselected (issue #295)", () => {
  const { working: _, ...before } = allSelected;
  const storage = memoryStorage({ [storageKey("characters")]: JSON.stringify(before) });
  assert.deepEqual(loadFilter(storage, "characters"), { ...allSelected, working: false });
});

test("the setting both screens shared is copied to each screen, then removed", () => {
  const storage = memoryStorage({ [SHARED_KEY]: JSON.stringify(allSelected) });
  assert.deepEqual(loadFilter(storage, "characters"), allSelected);
  assert.ok(!storage.entries.has(SHARED_KEY));
  // The other screen got it too, also though it loads after the shared key is gone.
  assert.deepEqual(loadFilter(storage, "choice"), allSelected);
});

test("a screen's own setting wins over the shared one", () => {
  const storage = memoryStorage({
    [SHARED_KEY]: JSON.stringify(allSelected),
    [storageKey("choice")]: JSON.stringify(DEFAULTS),
  });
  assert.deepEqual(loadFilter(storage, "choice"), DEFAULTS);
  assert.deepEqual(loadFilter(storage, "characters"), allSelected);
});
