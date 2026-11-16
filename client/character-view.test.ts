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

test("a rank 1 ranks up with another rank 1 at max level", () => {
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

test("a higher rank ranks up with one of the rank below it, at max level (issue #406)", () => {
  const rank3 = atMax({ number: 1, rank: 3 });
  const all = [
    rank3,
    atMax({ number: 2, rank: 3 }), // the same rank
    atMax({ number: 3, rank: 2 }),
    character({ number: 4, rank: 2 }), // not at max level
    atMax({ number: 5, rank: 1 }), // two ranks lower
  ];
  assert.deepEqual(
    rankUpPartners(rank3, all).map((c) => c.number),
    [3],
  );
  // The rank 2 doesn't rank up with the rank 3: it ranks up with the rank 1.
  assert.deepEqual(
    rankUpPartners(all[2]!, all).map((c) => c.number),
    [5],
  );
  // A rank 6 tank ranks up with a rank 5 adventurer.
  const tank = character({ number: 6, class: "tank", rank: 6, xp: xpForLevel(20) });
  assert.deepEqual(
    rankUpPartners(tank, [tank, atMax({ number: 7, rank: 5 }), atMax({ number: 8, rank: 4 })]).map((c) => c.number),
    [7],
  );
});

test("advanced class partners of a rank 5 adventurer are rank 4 adventurers at max level", () => {
  const first = atMax({ number: 1, rank: 5 });
  const all = [first, atMax({ number: 2, rank: 5 }), atMax({ number: 3, rank: 4 }), character({ number: 4, rank: 4 })];
  assert.deepEqual(
    advancedClassPartners(first, all).map((c) => c.number),
    [3],
  );
  // It starts on the rank 5.
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
