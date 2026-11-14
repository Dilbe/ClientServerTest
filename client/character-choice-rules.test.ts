import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canPickForSlot,
  defaultChoice,
  pickForSlot,
  roomForPlayer,
  slotFromAddress,
  slotStates,
  takeOutOfSlot,
} from "./character-choice-rules.ts";
import type { LobbyGame } from "../shared/protocol.ts";
import { DUNGEONS } from "../shared/rules/dungeon-map.ts";

/** An open game in the first dungeon (room for 4), with these characters per player. */
function game(players: Record<string, number>): LobbyGame {
  return {
    id: "g",
    creator: Object.keys(players)[0]!,
    players: Object.entries(players).map(([displayName, count]) => ({
      displayName,
      online: true,
      characters: Array.from({ length: count }, (_, i) => ({ number: i + 1, name: `C${i + 1}` })),
    })),
    turnOrder: [],
    dungeonId: "first",
    difficulty: "normal",
    turnDuration: "normal",
    private: false,
    started: false,
  };
}

test("outside a party there is room for 3", () => {
  assert.equal(roomForPlayer(null, "me"), 3);
});

test("in a party the room is what the dungeon leaves next to the others, at most 3", () => {
  assert.equal(DUNGEONS.first.maxCharacters, 4);
  assert.equal(roomForPlayer(game({ me: 1 }), "me"), 3);
  assert.equal(roomForPlayer(game({ me: 1, a: 2 }), "me"), 2);
  assert.equal(roomForPlayer(game({ me: 1, a: 2, b: 1 }), "me"), 1);
});

test("the chosen characters fill the first slots; the empty ones are open while there is room", () => {
  assert.deepEqual(slotStates(1, 3), ["filled", "open", "open"]);
  assert.deepEqual(slotStates(2, 2), ["filled", "filled", "noRoom"]);
  assert.deepEqual(slotStates(1, 1), ["filled", "noRoom", "noRoom"]);
  assert.deepEqual(slotStates(3, 3), ["filled", "filled", "filled"]);
});

test("the address names slot 1 to 3; anything else is no slot", () => {
  assert.equal(slotFromAddress("1"), 0);
  assert.equal(slotFromAddress("3"), 2);
  for (const typed of ["0", "4", "01", " 1", "1.0", "", "abc"]) assert.equal(slotFromAddress(typed), -1, typed);
});

test("the picker opens for a filled or an open slot, and for nothing else", () => {
  assert.equal(canPickForSlot(0, 1, 1), true); // swap the only one
  assert.equal(canPickForSlot(1, 1, 3), true); // add one
  assert.equal(canPickForSlot(1, 1, 1), false); // no room
  for (const slot of [-1, 3, 1.5, NaN]) assert.equal(canPickForSlot(slot, 1, 3), false, String(slot));
});

test("picking for a filled slot swaps; it works with room for only 1 (issue #331)", () => {
  assert.deepEqual(pickForSlot([3], 0, 5), [5]);
  assert.deepEqual(pickForSlot([3, 4], 1, 5), [3, 5]);
});

test("picking for an open slot adds the character, in that slot", () => {
  assert.deepEqual(pickForSlot([3], 1, 1), [3, 1]);
});

test("a character already in another slot can't be picked again", () => {
  assert.deepEqual(pickForSlot([3, 4], 0, 4), [3, 4]);
  assert.deepEqual(pickForSlot([3], 1, 3), [3]);
});

test("taking a character out empties its slot, but never the last one", () => {
  assert.deepEqual(takeOutOfSlot([1, 3, 5], 1), [1, 5]);
  assert.deepEqual(takeOutOfSlot([3], 0), [3]);
});

/** A character for defaultChoice, in the order given (the character-page order). */
const c = (number: number, rank: number, level: number) => ({ number, class: "adventurer" as const, rank, level });
const all = () => true;

test("the default skips a character at its max level for a lower one", () => {
  // Rank 2 level 20 is at its max level; rank 1 level 7 isn't.
  assert.equal(defaultChoice([c(1, 2, 20), c(2, 2, 14), c(3, 1, 7)], all)?.number, 2);
  assert.equal(defaultChoice([c(1, 2, 20), c(3, 1, 7)], all)?.number, 3);
});

test("with every ready character at its max level, the default is the first ready one", () => {
  assert.equal(defaultChoice([c(1, 2, 20), c(2, 1, 10)], all)?.number, 1);
});

test("the default skips characters that aren't ready", () => {
  const ready = (n: number) => n !== 2;
  assert.equal(defaultChoice([c(1, 2, 20), c(2, 2, 14), c(3, 1, 7)], ready)?.number, 3);
  assert.equal(defaultChoice([c(1, 2, 20), c(2, 2, 14)], ready)?.number, 1);
  assert.equal(defaultChoice([c(1, 2, 14)], () => false), undefined);
});

test("an advanced class is below its max level until rank × 10 + 10", () => {
  const tank = (number: number, level: number) => ({ number, class: "tank" as const, rank: 1, level });
  assert.equal(defaultChoice([tank(1, 20), tank(2, 15)], all)?.number, 2);
  assert.equal(defaultChoice([tank(1, 18), tank(2, 15)], all)?.number, 1);
});
