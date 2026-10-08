import { test } from "node:test";
import assert from "node:assert/strict";
import {
  adventurerPrice,
  canRankUp,
  levelFromXp,
  levelInGame,
  maxLevel,
  maxXp,
  progressInGame,
  upgradePointsEarned,
  xpForLevel,
} from "./advancement.ts";

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
  assert.equal(maxLevel(1), 10);
  assert.equal(maxXp(1), 225);
  assert.equal(maxLevel(5), 50);
  assert.equal(maxXp(5), 6125);
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
  for (const [xp, level] of cases) assert.equal(levelFromXp(xp, 1), level, `${xp} XP`);
  // The table's levels, from their total XP, at the highest rank.
  for (const level of [2, 3, 4, 5, 10, 20, 50]) assert.equal(levelFromXp(xpForLevel(level), 5), level);
});

test("the level stops at the max level of the rank", () => {
  assert.equal(levelFromXp(950, 1), 10);
  assert.equal(levelFromXp(950, 2), 20);
  assert.equal(levelFromXp(100_000, 5), 50);
});

test("stored characters keep their XP and go up in level with the new curve (issue #93)", () => {
  // 30 XP was level 3 with the old curve (10 × L per level); now it is level 4.
  assert.equal(levelFromXp(30, 1), 4);
  assert.equal(upgradePointsEarned(levelFromXp(30, 1)), 2 + 3 + 4);
  // 450 XP was the old max for rank 1: now far past it, still level 10, and it can rank up.
  assert.equal(levelFromXp(450, 1), 10);
  assert.equal(canRankUp(450, 1), true);
  // 1,900 XP was the old level 20 of rank 2: now past the max too.
  assert.equal(levelFromXp(1900, 2), 20);
});

test("reaching level L gives L upgrade points: 54 in total at level 10", () => {
  assert.equal(upgradePointsEarned(1), 0);
  assert.equal(upgradePointsEarned(2), 2);
  assert.equal(upgradePointsEarned(3), 5);
  assert.equal(upgradePointsEarned(5), 2 + 3 + 4 + 5);
  assert.equal(upgradePointsEarned(10), 54);
});

test("an adventurer costs its rank's base price times the purchases of that rank plus 1", () => {
  assert.deepEqual(
    [1, 2, 3, 4, 5].map((rank) => adventurerPrice(rank, 0)),
    [10, 90, 450, 1000, 2500],
  );
  assert.deepEqual(
    [1, 2, 3, 4, 5].map((rank) => adventurerPrice(rank, 1)),
    [20, 180, 900, 2000, 5000],
  );
  assert.deepEqual(
    [1, 2, 3, 4, 5].map((rank) => adventurerPrice(rank, 2)),
    [30, 270, 1350, 3000, 7500],
  );
});

test("only a character at the max level of its rank, below rank 5, can rank up", () => {
  assert.equal(canRankUp(maxXp(1), 1), true);
  assert.equal(canRankUp(maxXp(1) - 1, 1), false); // level 9
  assert.equal(canRankUp(maxXp(1), 2), false); // level 10 of 20
  assert.equal(canRankUp(maxXp(4), 4), true);
  assert.equal(canRankUp(maxXp(5), 5), false); // there is no rank 6
});

test("the level in a game follows from the rank, the XP it can still gain and the XP gained", () => {
  // Rank 1 (max 225 XP), started with 10 XP: level 2.
  assert.equal(levelInGame(1, 215, 0), 2);
  // 5 more XP make 15: level 3.
  assert.equal(levelInGame(1, 215, 5), 3);
  // Started at its max level: nothing to gain, and it stays there.
  assert.equal(levelInGame(1, 0, 0), 10);
  // A new rank 2 character: level 1.
  assert.equal(levelInGame(2, maxXp(2), 0), 1);
});

test("progressInGame says whether a game gave a level and reached a max level to rank up from", () => {
  // A new rank 1 character (225 XP to gain) that gains 4 XP: still level 1.
  assert.deepEqual(progressInGame(1, 225, 4), { levelledUp: false, reachedMaxLevel: false });
  // 5 XP: level 2.
  assert.deepEqual(progressInGame(1, 225, 5), { levelledUp: true, reachedMaxLevel: false });
  // From level 9 (180 XP, so 45 to gain) to its max level, 10.
  assert.deepEqual(progressInGame(1, 45, 45), { levelledUp: true, reachedMaxLevel: true });
  // Already at its max level: it gains nothing, so neither.
  assert.deepEqual(progressInGame(1, 0, 0), { levelledUp: false, reachedMaxLevel: false });
  // Rank 5 can't rank up: reaching its max level levels up, but gives no max-level hint.
  assert.deepEqual(progressInGame(5, xpForLevel(50) - xpForLevel(49), xpForLevel(50) - xpForLevel(49)), {
    levelledUp: true,
    reachedMaxLevel: false,
  });
});
