import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canPick,
  defaultChoice,
  emptyRows,
  pick,
  pickerAddress,
  pickerTarget,
  roomForPlayer,
  takeOut,
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

test("empty places the player can still fill are add rows; the others are for other players", () => {
  // Alone in a 4-place dungeon with 1 character: 2 to add, 1 for someone else.
  assert.deepEqual(emptyRows(4, 1, 1), { add: 2, other: 1 });
  // Bringing 3 already: every empty place is for someone else.
  assert.deepEqual(emptyRows(6, 3, 3), { add: 0, other: 3 });
  // The places run out first.
  assert.deepEqual(emptyRows(4, 3, 1), { add: 1, other: 0 });
  assert.deepEqual(emptyRows(4, 4, 1), { add: 0, other: 0 });
  // Never below 0, also with more characters than places.
  assert.deepEqual(emptyRows(4, 5, 3), { add: 0, other: 0 });
});

test("the picker's address is add or one of the player's character numbers", () => {
  assert.deepEqual(pickerTarget("add"), { kind: "add" });
  assert.deepEqual(pickerTarget("5"), { kind: "swap", number: 5 });
  for (const typed of ["", "0", "-1", "05", "1.5", "1e2", " 5", "Add", "1234567890", "constructor"]) {
    assert.equal(pickerTarget(typed), undefined, typed);
  }
  for (const target of [{ kind: "add" }, { kind: "swap", number: 7 }] as const) {
    assert.deepEqual(pickerTarget(pickerAddress(target).slice("#/choose-characters/".length)), target);
  }
});

test("the picker fits when adding with room, or swapping a character the player brings", () => {
  assert.equal(canPick({ kind: "add" }, [3], 3), true);
  assert.equal(canPick({ kind: "add" }, [3], 1), false);
  assert.equal(canPick({ kind: "swap", number: 3 }, [3], 1), true);
  assert.equal(canPick({ kind: "swap", number: 4 }, [3], 3), false);
  assert.equal(canPick(undefined, [3], 3), false);
});

test("a swap keeps the place; adding goes at the end (issue #331 still works with room for 1)", () => {
  assert.deepEqual(pick([3], { kind: "swap", number: 3 }, 5), [5]);
  assert.deepEqual(pick([3, 4], { kind: "swap", number: 3 }, 5), [5, 4]);
  assert.deepEqual(pick([3], { kind: "add" }, 1), [3, 1]);
});

test("a character the player already brings can't be picked again", () => {
  assert.deepEqual(pick([3, 4], { kind: "swap", number: 3 }, 4), [3, 4]);
  assert.deepEqual(pick([3], { kind: "add" }, 3), [3]);
});

test("taking a character out leaves the others, but never the last one", () => {
  assert.deepEqual(takeOut([1, 3, 5], 3), [1, 5]);
  assert.deepEqual(takeOut([3], 3), [3]);
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
  const tank = (number: number, level: number) => ({ number, class: "tank" as const, rank: 6, level });
  assert.equal(defaultChoice([tank(1, 20), tank(2, 15)], all)?.number, 2);
  assert.equal(defaultChoice([tank(1, 18), tank(2, 15)], all)?.number, 1);
});
