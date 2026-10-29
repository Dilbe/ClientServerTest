import { test } from "node:test";
import assert from "node:assert/strict";
import {
  adventurerPrice,
  canMakeAdvancedClass,
  canRankUp,
  DAY_MS,
  levelFromXp,
  levelInGame,
  levelsGained,
  maxLevel,
  maxXp,
  nextAdventurerPrice,
  progressInGame,
  upgradePointsEarned,
  xpForLevel,
} from "./advancement.ts";
import { ADVANCED_CLASS_IDS } from "./classes.ts";

test("the total XP for each level follows the table in design.md, Levels", () => {
  const table: [number, number][] = [
    [1, 0],
    [2, 5],
    [3, 15],
    [4, 30],
    [5, 50],
    [10, 225],
    [20, 950],
    [50, 6125],
  ];
  for (const [level, xp] of table) assert.equal(xpForLevel(level), xp, `level ${level}`);
});

test("going from level L to L + 1 takes 5 × L XP", () => {
  for (let level = 1; level < 50; level++) {
    assert.equal(xpForLevel(level + 1) - xpForLevel(level), 5 * level, `level ${level}`);
  }
});

test("max level is rank × 10: rank 1 tops out at 225 XP, rank 5 at 6,125", () => {
  assert.equal(maxLevel("adventurer", 1), 10);
  assert.equal(maxXp("adventurer", 1), 225);
  assert.equal(maxLevel("adventurer", 5), 50);
  assert.equal(maxXp("adventurer", 5), 6125);
});

test("an advanced class has 10 levels more than an adventurer of the same rank: 20 at rank 1, 60 at rank 5", () => {
  for (const classId of ADVANCED_CLASS_IDS) {
    assert.equal(maxLevel(classId, 1), 20, classId);
    assert.equal(maxLevel(classId, 5), 60, classId);
    // The XP per level is the same as for adventurers.
    assert.equal(maxXp(classId, 1), xpForLevel(20), classId);
  }
  // Levelling: a rank 1 tank goes past level 10, and stops at 20.
  assert.equal(levelFromXp(maxXp("adventurer", 1), "tank", 1), 10);
  assert.equal(levelFromXp(100_000, "tank", 1), 20);
  // In a game too: a new rank 1 tank can gain all the XP up to level 20.
  assert.equal(levelInGame("tank", 1, maxXp("tank", 1), maxXp("tank", 1)), 20);
});

test("the level follows from the total XP; leftover XP counts towards the next level", () => {
  const cases: [xp: number, level: number][] = [
    [0, 1],
    [4, 1],
    [5, 2],
    [14, 2],
    [15, 3],
    [224, 9],
    [225, 10],
  ];
  for (const [xp, level] of cases) assert.equal(levelFromXp(xp, "adventurer", 1), level, `${xp} XP`);
  // The table's levels, from their total XP, at the highest rank.
  for (const level of [2, 3, 4, 5, 10, 20, 50]) assert.equal(levelFromXp(xpForLevel(level), "adventurer", 5), level);
});

test("the level stops at the max level of the rank", () => {
  assert.equal(levelFromXp(950, "adventurer", 1), 10);
  assert.equal(levelFromXp(950, "adventurer", 2), 20);
  assert.equal(levelFromXp(100_000, "adventurer", 5), 50);
});

test("stored characters keep their XP and go up in level with the new curve (issue #93)", () => {
  // 30 XP was level 3 with the old curve (10 × L per level); now it is level 4.
  assert.equal(levelFromXp(30, "adventurer", 1), 4);
  assert.equal(upgradePointsEarned(levelFromXp(30, "adventurer", 1)), 2 + 3 + 4);
  // 450 XP was the old max for rank 1: now far past it, still level 10, and it can rank up.
  assert.equal(levelFromXp(450, "adventurer", 1), 10);
  assert.equal(canRankUp(450, "adventurer", 1), true);
  // 1,900 XP was the old level 20 of rank 2: now past the max too.
  assert.equal(levelFromXp(1900, "adventurer", 2), 20);
});

test("reaching level L gives L upgrade points: 54 in total at level 10", () => {
  assert.equal(upgradePointsEarned(1), 0);
  assert.equal(upgradePointsEarned(2), 2);
  assert.equal(upgradePointsEarned(3), 5);
  assert.equal(upgradePointsEarned(5), 2 + 3 + 4 + 5);
  assert.equal(upgradePointsEarned(10), 54);
});

test("an adventurer of a rank never bought costs its base price", () => {
  assert.deepEqual(
    [1, 2, 3, 4, 5].map((rank) => adventurerPrice(rank, undefined, 0)),
    [10, 90, 450, 1000, 2500],
  );
});

test("buying one adds its rank's base price to what was paid", () => {
  assert.deepEqual(
    [1, 2, 3, 4, 5].map((rank) => nextAdventurerPrice(rank, adventurerPrice(rank, undefined, 0))),
    [20, 180, 900, 2000, 5000],
  );
  // After waiting: 162 paid for a rank 2, so the next one costs 162 + 90.
  assert.equal(nextAdventurerPrice(2, 162), 252);
});

test("the price drops 10% for each full day since the last purchase of that rank", () => {
  const last = { nextPrice: 180, boughtAt: 1000 };
  assert.equal(adventurerPrice(2, last, 1000), 180);
  assert.equal(adventurerPrice(2, last, 1000 + DAY_MS - 1), 180); // not a full day yet
  assert.equal(adventurerPrice(2, last, 1000 + DAY_MS), 162);
  assert.equal(adventurerPrice(2, last, 1000 + 2 * DAY_MS), 146); // 145.8, rounded
  assert.equal(adventurerPrice(2, last, 1000 + 3 * DAY_MS), 131); // 131.22: from 180, not from 146
});

test("the price never drops below the base price of its rank", () => {
  const last = { nextPrice: 2000, boughtAt: 0 };
  assert.equal(adventurerPrice(4, last, 6 * DAY_MS), 1063); // 1062.882
  assert.equal(adventurerPrice(4, last, 7 * DAY_MS), 1000); // 956.6, but 1000 is the base
  assert.equal(adventurerPrice(4, last, 1000 * DAY_MS), 1000);
});

test("a clock that went back in time never makes the price go up", () => {
  assert.equal(adventurerPrice(1, { nextPrice: 20, boughtAt: 5 * DAY_MS }, 0), 20);
});

test("only a character at the max level of its rank, below rank 5, can rank up", () => {
  assert.equal(canRankUp(maxXp("adventurer", 1), "adventurer", 1), true);
  assert.equal(canRankUp(maxXp("adventurer", 1) - 1, "adventurer", 1), false); // level 9
  assert.equal(canRankUp(maxXp("adventurer", 1), "adventurer", 2), false); // level 10 of 20
  assert.equal(canRankUp(maxXp("adventurer", 4), "adventurer", 4), true);
  assert.equal(canRankUp(maxXp("adventurer", 5), "adventurer", 5), false); // there is no rank 6
});

test("an advanced class ranks up at its own max level", () => {
  assert.equal(canRankUp(maxXp("adventurer", 1), "tank", 1), false); // level 10 of 20
  assert.equal(canRankUp(maxXp("tank", 1), "tank", 1), true);
  assert.equal(canRankUp(maxXp("tank", 4), "tank", 4), true);
  assert.equal(canRankUp(maxXp("tank", 5), "tank", 5), false); // there is no rank 6
});

test("only a rank 5 adventurer at its max level can make an advanced class", () => {
  assert.equal(canMakeAdvancedClass(maxXp("adventurer", 5), "adventurer", 5), true);
  assert.equal(canMakeAdvancedClass(maxXp("adventurer", 5) - 1, "adventurer", 5), false); // level 49
  assert.equal(canMakeAdvancedClass(maxXp("adventurer", 4), "adventurer", 4), false);
  // An advanced class can't be made from another one.
  assert.equal(canMakeAdvancedClass(maxXp("tank", 5), "tank", 5), false);
});

test("the level in a game follows from the rank, the XP it can still gain and the XP gained", () => {
  // Rank 1 (max 225 XP), started with 10 XP: level 2.
  assert.equal(levelInGame("adventurer", 1, 215, 0), 2);
  // 5 more XP make 15: level 3.
  assert.equal(levelInGame("adventurer", 1, 215, 5), 3);
  // Started at its max level: nothing to gain, and it stays there.
  assert.equal(levelInGame("adventurer", 1, 0, 0), 10);
  // A new rank 2 character: level 1.
  assert.equal(levelInGame("adventurer", 2, maxXp("adventurer", 2), 0), 1);
});

test("progressInGame says whether a game gave a level and reached a max level to rank up from", () => {
  // A new rank 1 character (225 XP to gain) that gains 4 XP: still level 1.
  assert.deepEqual(progressInGame("adventurer", 1, 225, 4), { levelledUp: false, reachedMaxLevel: false });
  // 5 XP: level 2.
  assert.deepEqual(progressInGame("adventurer", 1, 225, 5), { levelledUp: true, reachedMaxLevel: false });
  // From level 9 (180 XP, so 45 to gain) to its max level, 10.
  assert.deepEqual(progressInGame("adventurer", 1, 45, 45), { levelledUp: true, reachedMaxLevel: true });
  // Already at its max level: it gains nothing, so neither.
  assert.deepEqual(progressInGame("adventurer", 1, 0, 0), { levelledUp: false, reachedMaxLevel: false });
  // Rank 5 can't rank up: reaching its max level levels up, but gives no max-level hint.
  assert.deepEqual(progressInGame("adventurer", 5, xpForLevel(50) - xpForLevel(49), xpForLevel(50) - xpForLevel(49)), {
    levelledUp: true,
    reachedMaxLevel: false,
  });
});

test("levelsGained counts the levels between two amounts of XP gained in a game", () => {
  // A new rank 1 character (225 XP to gain): 4 XP is still level 1, 15 XP is level 3.
  assert.equal(levelsGained("adventurer", 1, 225, 0, 4), 0);
  assert.equal(levelsGained("adventurer", 1, 225, 0, 15), 2);
  // One kill from 4 to 5 XP gained: level 1 to 2.
  assert.equal(levelsGained("adventurer", 1, 225, 4, 5), 1);
  // Already at its max level: it gains nothing.
  assert.equal(levelsGained("adventurer", 1, 0, 0, 0), 0);
});
