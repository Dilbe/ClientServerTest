import { test } from "node:test";
import assert from "node:assert/strict";
import type { CharacterSummary } from "../shared/characters.ts";
import { xpForLevel } from "../shared/rules/advancement.ts";
import {
  advancedClassPartners,
  characterView,
  characterViewAddress,
  newCharacterNumber,
  pointsToSpendText,
  rankUpPartners,
} from "./character-view.ts";

function character(overrides: Partial<CharacterSummary> = {}): CharacterSummary {
  return {
    number: 1,
    name: null,
    class: "adventurer",
    rank: 1,
    xp: 0,
    upgrades: [],
    workDoneInMs: 0,
    healedInMs: 0,
    readyInMs: 0,
    workplace: null,
    inGame: false,
    inRunningGame: false,
    ...overrides,
  };
}

/** A character at the max level of its rank (rank × 10 for an adventurer). */
function atMax(overrides: Partial<CharacterSummary> = {}): CharacterSummary {
  const rank = overrides.rank ?? 1;
  return character({ xp: xpForLevel(rank * 10), ...overrides });
}

test("the address picks the list, the buying screen or one character", () => {
  assert.deepEqual(characterView(null), { kind: "list" });
  assert.deepEqual(characterView(""), { kind: "list" });
  assert.deepEqual(characterView("buy"), { kind: "buy" });
  assert.deepEqual(characterView("3"), { kind: "character", number: 3 });
  assert.deepEqual(characterView("123456789"), { kind: "character", number: 123456789 });
});

test("an address that isn't a whole positive number shows the list", () => {
  // Number() would turn several of these into a number.
  for (const typed of ["0", "-1", "3.5", "1e3", " 3", "3 ", "03", "0x10", "1234567890", "abc", "buy/1", "constructor"]) {
    assert.deepEqual(characterView(typed), { kind: "list" }, typed);
  }
});

test("each screen's address leads back to that screen", () => {
  for (const view of [{ kind: "list" }, { kind: "buy" }, { kind: "character", number: 7 }] as const) {
    const address = characterViewAddress(view);
    const rest = address === "#/characters" ? null : address.slice("#/characters/".length);
    assert.deepEqual(characterView(rest), view);
  }
});

test("a rank-up partner has the same class and rank, and both are at max level", () => {
  const first = atMax({ number: 1 });
  const all = [
    first,
    atMax({ number: 2 }),
    character({ number: 3 }), // not at max level
    atMax({ number: 4, rank: 2 }), // another rank
    atMax({ number: 5, inRunningGame: true }), // in a running game
  ];
  assert.deepEqual(
    rankUpPartners(first, all).map((c) => c.number),
    [2],
  );
  // A character below its max level has no partners at all.
  assert.deepEqual(rankUpPartners(all[2]!, all), []);
  // Nor does one in a running game.
  assert.deepEqual(rankUpPartners(all[4]!, all), []);
});

test("advanced class partners are other rank 5 adventurers at max level", () => {
  const first = atMax({ number: 1, rank: 5 });
  const all = [first, atMax({ number: 2, rank: 5 }), atMax({ number: 3, rank: 4 }), character({ number: 4, rank: 5 })];
  assert.deepEqual(
    advancedClassPartners(first, all).map((c) => c.number),
    [2],
  );
  assert.deepEqual(advancedClassPartners(all[2]!, all), []);
});

test("the new character is the one new number, if there is exactly one", () => {
  assert.equal(newCharacterNumber([1, 2, 3], [3, 4]), 4);
  assert.equal(newCharacterNumber([1, 2], [1, 2]), undefined);
  assert.equal(newCharacterNumber([1], [1, 2, 3]), undefined);
});

test("the points to spend are counted in words, and not shown without any", () => {
  assert.equal(pointsToSpendText(4), "4 points to spend");
  assert.equal(pointsToSpendText(1), "1 point to spend");
  assert.equal(pointsToSpendText(0), "");
});
