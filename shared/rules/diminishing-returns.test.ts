// Diminishing returns (design.md, Rewards, Diminishing returns): the XP a
// monster gives after earlier kills, kill counts per dungeon, difficulty and
// monster, and the XP percentage the party screen shows.

import { test } from "node:test";
import assert from "node:assert/strict";
import { addKills, dungeonXpPercent, killsIn, xpAfterKills, type KillCounts } from "./diminishing-returns.ts";
import { FIRST_DUNGEON_MAP, RAT_WARREN_MAP } from "./dungeon-map.ts";
import { MONSTER_TYPES } from "./stats.ts";

/** 0, 1, 2, ... n. */
const kills = (n: number) => Array.from({ length: n + 1 }, (_, i) => i);
const rat = { type: "rat" as const, position: FIRST_DUNGEON_MAP.monsters[0]!.position };

test("a rat's 2 XP gives 2, 2, 2, 2, 2, 1, 1, 1, 1, 1 and then nothing", () => {
  // After 4 kills 60% is left: 1.2 XP, rounded up to 2.
  assert.equal(MONSTER_TYPES.rat.xp, 2);
  assert.deepEqual(
    kills(11).map((k) => xpAfterKills(2, k)),
    [2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 0, 0],
  );
});

test("every earlier kill takes off 10% of the full XP, rounded up, down to 0 after 10 kills", () => {
  assert.deepEqual(
    kills(10).map((k) => xpAfterKills(10, k)),
    [10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
  );
  // 15 XP on Hard (5 × 3): 13.5 rounds up to 14, 1.5 to 2.
  assert.deepEqual(
    kills(10).map((k) => xpAfterKills(15, k)),
    [15, 14, 12, 11, 9, 8, 6, 5, 3, 2, 0],
  );
  for (const full of [1, 2, 5, 6, 8, 10, 30, 50]) {
    for (let k = 0; k < 10; k++) assert.ok(xpAfterKills(full, k) >= 1, `${full} XP after ${k} kills`);
    assert.equal(xpAfterKills(full, 10), 0);
    assert.equal(xpAfterKills(full, 25), 0);
  }
});

test("kills are counted per dungeon, per difficulty and per monster", () => {
  let counts: KillCounts = {};
  counts = addKills(counts, "warren", "normal", [0, 2]);
  counts = addKills(counts, "warren", "normal", [2]);
  counts = addKills(counts, "warren", "hard", [1]);
  counts = addKills(counts, "first", "normal", [0, 1]);
  assert.deepEqual(killsIn(counts, "warren", "normal"), [1, 0, 2]);
  assert.deepEqual(killsIn(counts, "warren", "hard"), [0, 1]);
  assert.deepEqual(killsIn(counts, "warren", "heroic"), []);
  assert.deepEqual(killsIn(counts, "first", "normal"), [1, 1]);
  assert.deepEqual(killsIn(counts, "hallway", "normal"), []);
});

test("adding kills leaves the old counts as they were", () => {
  const before: KillCounts = { warren: { normal: [1] } };
  const after = addKills(before, "warren", "normal", [0]);
  assert.deepEqual(before, { warren: { normal: [1] } });
  assert.deepEqual(after, { warren: { normal: [2] } });
});

test("the party screen's percentage: the dungeon's XP at these kill counts, against its full XP", () => {
  // No kills: everything.
  assert.equal(dungeonXpPercent(RAT_WARREN_MAP, "normal", []), 100);
  // The first dungeon has two monsters of 5 XP: after 3 kills of the first
  // one and none of the second, 4 + 5 of 10.
  assert.equal(FIRST_DUNGEON_MAP.monsters.length, 2);
  assert.equal(dungeonXpPercent(FIRST_DUNGEON_MAP, "normal", [3]), 90);
  // Cleared 3 times: 4 + 4 of 10, on every difficulty.
  assert.equal(dungeonXpPercent(FIRST_DUNGEON_MAP, "normal", [3, 3]), 80);
  // On Heroic they give 25 XP: 17.5 rounds up to 18, so 18 + 18 of 50.
  assert.equal(dungeonXpPercent(FIRST_DUNGEON_MAP, "heroic", [3, 3]), 72);
  // With a rat added (12 XP in all): one kill of a 5 XP monster still gives
  // 4.5, rounded up to 5, so 100%. After 3 kills, 4 + 5 + 2 of 12 is 91.7%,
  // rounded down.
  const withRat = { ...FIRST_DUNGEON_MAP, monsters: [...FIRST_DUNGEON_MAP.monsters, rat] };
  assert.equal(dungeonXpPercent(withRat, "normal", [1]), 100);
  assert.equal(dungeonXpPercent(withRat, "normal", [3]), 91);
  // Nothing left.
  assert.equal(dungeonXpPercent(FIRST_DUNGEON_MAP, "normal", [10, 12]), 0);
});

test("the percentage is rounded down, but isn't 0% while some XP is left", () => {
  // Three rats of 2 XP, the first killed 9 times: 1 + 2 + 2 of 6 is 83.3%.
  const rats = { ...RAT_WARREN_MAP, monsters: [rat, rat, rat] };
  assert.equal(dungeonXpPercent(rats, "normal", [9]), 83);
  // 150 rats, all but one killed 10 times: 1 of 300 XP is left.
  const many = { ...RAT_WARREN_MAP, monsters: Array.from({ length: 150 }, () => rat) };
  assert.equal(dungeonXpPercent(many, "normal", [9, ...Array.from({ length: 149 }, () => 10)]), 1);
  assert.equal(dungeonXpPercent(many, "normal", Array.from({ length: 150 }, () => 10)), 0);
});
