import { test } from "node:test";
import assert from "node:assert/strict";
import { levelFromXp, upgradePointsEarned } from "./advancement.ts";
import { STATS, UPGRADABLE_STAT_IDS, type UpgradableStatId } from "./stats.ts";
import {
  nextUpgradeCost,
  pointsLeft,
  pointsSpent,
  statsWithUpgrades,
  upgradeCost,
  xpAfterReset,
  type Upgrade,
} from "./upgrades.ts";

test("the costs of the first upgrades follow the table in design.md, Upgrade points", () => {
  const table: Record<UpgradableStatId, number[]> = {
    hitPoints: [1, 2, 3, 4],
    attackDamage: [5, 15, 26, 40],
    actions: [20, 80, 180],
  };
  for (const stat of UPGRADABLE_STAT_IDS) {
    assert.deepEqual(
      table[stat].map((_, i) => upgradeCost(stat, i + 1)),
      table[stat],
      stat,
    );
  }
});

test("a cost that is a whole number isn't rounded up past it by floating point", (t) => {
  // In floating point, 32^1.6 is 256.00000000000006 instead of 256.
  t.mock.property(STATS.movement, "upgradeCostExponent", 1.6);
  t.mock.property(STATS.movement, "firstUpgradeCost", 1);
  assert.equal(upgradeCost("movement", 32), 256);
  // A cost that isn't whole is still rounded up: 2^1.6 = 3.03...
  assert.equal(upgradeCost("movement", 2), 4);
});

test("the next upgrade of a stat costs according to how often that stat was upgraded", () => {
  const upgrades: Upgrade[] = [
    { stat: "hitPoints", paid: 1 },
    { stat: "hitPoints", paid: 2 },
    { stat: "movement", paid: 5 },
  ];
  assert.equal(nextUpgradeCost(upgrades, "hitPoints"), 3);
  assert.equal(nextUpgradeCost(upgrades, "movement"), 15);
  assert.equal(nextUpgradeCost(upgrades, "actions"), 20);
});

test("points spent are what was paid, not what the upgrades would cost today", () => {
  // Bought when hit points were cheaper: 1 point each.
  const upgrades: Upgrade[] = [
    { stat: "hitPoints", paid: 1 },
    { stat: "hitPoints", paid: 1 },
  ];
  assert.equal(pointsSpent(upgrades), 2);
  // Level 3 has earned 2 + 3 = 5 points.
  assert.equal(pointsLeft(3, upgrades), 3);
});

test("stats are the base stats plus 1 for every upgrade", () => {
  const upgrades: Upgrade[] = [
    { stat: "hitPoints", paid: 1 },
    { stat: "hitPoints", paid: 2 },
    { stat: "attackDamage", paid: 5 },
  ];
  assert.deepEqual(statsWithUpgrades(upgrades), { actions: 1, movement: 1, attackDamage: 2, hitPoints: 12 });
  assert.deepEqual(statsWithUpgrades([]), { actions: 1, movement: 1, attackDamage: 1, hitPoints: 10 });
});

test("resetting follows the example in design.md: level 5 with 60 XP becomes level 4 with 30 XP and 9 points", () => {
  assert.equal(levelFromXp(60, 1), 5);
  const xp = xpAfterReset(5);
  assert.equal(xp, 30);
  assert.equal(levelFromXp(xp, 1), 4);
  assert.equal(upgradePointsEarned(4), 9);
});
