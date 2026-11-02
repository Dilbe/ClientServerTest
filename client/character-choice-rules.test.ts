import { test } from "node:test";
import assert from "node:assert/strict";
import { nextChoice, roomForPlayer } from "./character-choice-rules.ts";
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
