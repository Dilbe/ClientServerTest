import { test } from "node:test";
import assert from "node:assert/strict";
import {
  adventurerPrice,
  canRankUp,
  levelFromXp,
  maxLevel,
  maxXp,
  upgradePointsEarned,
  xpForLevel,
} from "./advancement.ts";

test("the total XP for each level follows the table in design.md, Levels", () => {
  const table: [number, number][] = [
    [1, 0],
    [2, 10],
    [3, 30],
    [4, 60],
    [5, 100],
    [10, 450],
    [20, 1900],
    [50, 12250],
  ];
  for (const [level, xp] of table) assert.equal(xpForLevel(level), xp, `level ${level}`);
});

test("max level is rank × 10: rank 1 tops out at 450 XP, rank 5 at 12,250", () => {
  assert.equal(maxLevel(1), 10);
  assert.equal(maxXp(1), 450);
  assert.equal(maxLevel(5), 50);
  assert.equal(maxXp(5), 12250);
});

test("the level follows from the total XP; leftover XP counts towards the next level", () => {
  const cases: [xp: number, level: number][] = [
    [0, 1],
    [9, 1],
    [10, 2],
    [29, 2],
    [30, 3],
    [449, 9],
    [450, 10],
  ];
  for (const [xp, level] of cases) assert.equal(levelFromXp(xp, 1), level, `${xp} XP`);
  // The table's levels, from their total XP, at the highest rank.
  for (const level of [2, 3, 4, 5, 10, 20, 50]) assert.equal(levelFromXp(xpForLevel(level), 5), level);
});

test("the level stops at the max level of the rank", () => {
  assert.equal(levelFromXp(1900, 1), 10);
  assert.equal(levelFromXp(1900, 2), 20);
  assert.equal(levelFromXp(100_000, 5), 50);
});

test("reaching level L gives L upgrade points: 54 in total at level 10", () => {
  assert.equal(upgradePointsEarned(1), 0);
  assert.equal(upgradePointsEarned(2), 2);
  assert.equal(upgradePointsEarned(3), 5);
  assert.equal(upgradePointsEarned(5), 2 + 3 + 4 + 5);
  assert.equal(upgradePointsEarned(10), 54);
});

test("an adventurer costs 10 silver for every character the player has", () => {
  assert.equal(adventurerPrice(1), 10);
  assert.equal(adventurerPrice(2), 20);
  assert.equal(adventurerPrice(5), 50);
});

test("only a character at the max level of its rank, below rank 5, can rank up", () => {
  assert.equal(canRankUp(maxXp(1), 1), true);
  assert.equal(canRankUp(maxXp(1) - 1, 1), false); // level 9
  assert.equal(canRankUp(maxXp(1), 2), false); // level 10 of 20
  assert.equal(canRankUp(maxXp(4), 4), true);
  assert.equal(canRankUp(maxXp(5), 5), false); // there is no rank 6
});
