import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultChoice, nextChoice, roomForPlayer } from "./character-choice-rules.ts";
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

test("with room for 1, ticking another character swaps it for the chosen one", () => {
  assert.deepEqual(nextChoice([3], 5, true, 1), [5]);
});

test("with more room, ticking adds the character", () => {
  assert.deepEqual(nextChoice([3], 1, true, 2), [1, 3]);
  assert.deepEqual(nextChoice([3], 1, true, 3), [1, 3]);
});

test("with 2 chosen and a full party, ticking still adds: the server refuses it, as before", () => {
  assert.deepEqual(nextChoice([1, 3], 5, true, 2), [1, 3, 5]);
});

test("unticking takes the character out", () => {
  assert.deepEqual(nextChoice([1, 3], 3, false, 1), [1]);
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
