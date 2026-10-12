import { test } from "node:test";
import assert from "node:assert/strict";
import { fits, GROUPS, optionCount, shownText, summaryText, type FilterSetting } from "./character-filter-rules.ts";

const [LEVEL, STATUS] = GROUPS as [(typeof GROUPS)[number], (typeof GROUPS)[number]];

/** The default setting, with "In a game" not selected. */
const DEFAULTS: FilterSetting = { maxLevel: false, belowMaxLevel: true, available: true, resting: false, inGame: false };

const available = { atMaxLevel: false, ready: true, inGame: false };
const resting = { atMaxLevel: false, ready: false, inGame: false };
const inGame = { atMaxLevel: false, ready: true, inGame: true };
const maxedAvailable = { atMaxLevel: true, ready: true, inGame: false };

test("a character is shown when a selected option in each dropdown fits it", () => {
  assert.ok(fits(DEFAULTS, available));
  assert.ok(!fits(DEFAULTS, resting));
  assert.ok(!fits(DEFAULTS, maxedAvailable));
  // A ready character in a game counts only as "in a game".
  assert.ok(!fits(DEFAULTS, inGame));
  assert.ok(fits({ ...DEFAULTS, inGame: true, available: false }, inGame));
});

test("a closed dropdown names what it has selected, in the order of the options", () => {
  assert.equal(summaryText(LEVEL, DEFAULTS), "Level: Below max level");
  assert.equal(summaryText(STATUS, DEFAULTS), "Status: Available");
  assert.equal(summaryText(STATUS, { ...DEFAULTS, inGame: true }), "Status: Available, In a game");
  assert.equal(summaryText(LEVEL, { ...DEFAULTS, maxLevel: true }), "Level: Max level, Below max level");
  assert.equal(summaryText(LEVEL, { ...DEFAULTS, belowMaxLevel: false }), "Level: none");
  assert.equal(summaryText(STATUS, { ...DEFAULTS, available: false }), "Status: none");
});

test("an option counts the characters it would show, given the other dropdown", () => {
  const characters = [available, available, resting, inGame, maxedAvailable];
  // The status options count only characters below max level, as that is all "Level" selects...
  assert.equal(optionCount("available", DEFAULTS, characters), 2);
  assert.equal(optionCount("resting", DEFAULTS, characters), 1);
  assert.equal(optionCount("inGame", DEFAULTS, characters), 1);
  // ...and the level options only available characters.
  assert.equal(optionCount("belowMaxLevel", DEFAULTS, characters), 2);
  assert.equal(optionCount("maxLevel", DEFAULTS, characters), 1);
  // Whether an option is selected, or the others in its dropdown are, doesn't change its count.
  assert.equal(optionCount("resting", { ...DEFAULTS, resting: true, available: false }, characters), 1);
  // With nothing selected in the other dropdown, nothing would be shown.
  const noLevel = { ...DEFAULTS, belowMaxLevel: false };
  for (const { id } of STATUS.options) assert.equal(optionCount(id, noLevel, characters), 0);
  // Selecting more in the other dropdown raises the counts.
  assert.equal(optionCount("available", { ...DEFAULTS, maxLevel: true }, characters), 3);
});

test("the counts follow the characters, such as one that finishes resting", () => {
  const before = [available, resting];
  const after = [available, { ...resting, ready: true }];
  assert.equal(optionCount("available", DEFAULTS, before), 1);
  assert.equal(optionCount("resting", DEFAULTS, before), 1);
  assert.equal(optionCount("available", DEFAULTS, after), 2);
  assert.equal(optionCount("resting", DEFAULTS, after), 0);
});

test("a line under the dropdowns says when characters are hidden", () => {
  assert.equal(shownText(2, 5), "Showing 2 of 5 characters.");
  assert.equal(shownText(0, 5), "None of your 5 characters fit these filters.");
  assert.equal(shownText(5, 5), "");
  assert.equal(shownText(0, 0), "");
});
