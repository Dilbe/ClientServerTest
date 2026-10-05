import { test } from "node:test";
import assert from "node:assert/strict";
import { maxLevel, maxXp, xpForLevel } from "./advancement.ts";

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
