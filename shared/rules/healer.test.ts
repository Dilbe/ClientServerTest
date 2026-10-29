import { test } from "node:test";
import assert from "node:assert/strict";
import { baseStats, CLASSES, hasStat, statsOf } from "./classes.ts";
import { FIRST_DUNGEON_MAP } from "./dungeon-map.ts";
import { STATS } from "./stats.ts";
import { createTrack } from "./track.ts";
import { newGameState } from "./turn.ts";
import { applyUpgrade, buyUpgrade, statsWithUpgrades, upgradeCost, type Upgrade } from "./upgrades.ts";

test("a healer starts with 8 hit points, 2 movement and 3 healing power; actions and attack damage are an adventurer's", () => {
  assert.deepEqual(baseStats("healer"), { actions: 1, movement: 2, attackDamage: 1, hitPoints: 8, healingPower: 3 });
  assert.equal(CLASSES.healer.extraMaxLevels, 10);
});

test("only the healer has healing power", () => {
  assert.ok(hasStat("healer", "healingPower"));
  for (const classId of ["adventurer", "tank", "ranger", "caster"] as const) {
    assert.ok(!hasStat(classId, "healingPower"), classId);
    assert.ok(!("healingPower" in baseStats(classId)), classId);
    assert.ok(!statsOf(classId).includes("healingPower"), classId);
  }
  assert.equal(STATS.healingPower.name, "Healing power");
});

test("a healer's upgrade costs follow design.md, The healer", () => {
  const costs = (stat: "hitPoints" | "attackDamage" | "actions" | "healingPower", n: number) =>
    Array.from({ length: n }, (_, i) => upgradeCost("healer", stat, i + 1));
  assert.deepEqual(costs("hitPoints", 4), [1, 2, 3, 4]);
  assert.deepEqual(costs("attackDamage", 4), [8, 25, 47, 74]);
  assert.deepEqual(costs("actions", 3), [20, 80, 180]);
  assert.deepEqual(costs("healingPower", 4), [5, 16, 29, 46]);
  // Every upgrade adds 1.
  const upgrades: Upgrade[] = [
    { stat: "healingPower", paid: 5 },
    { stat: "healingPower", paid: 16 },
    { stat: "hitPoints", paid: 1 },
  ];
  assert.deepEqual(statsWithUpgrades("healer", upgrades), {
    actions: 1,
    movement: 2,
    attackDamage: 1,
    hitPoints: 9,
    healingPower: 5,
  });
});

test("healing power can only be bought for a healer, and movement for nobody", () => {
  assert.deepEqual(buyUpgrade({ class: "healer", rank: 1 }, 5, [], { stat: "healingPower" }), {
    ok: true,
    upgrade: { stat: "healingPower", paid: 5 },
  });
  for (const classId of ["adventurer", "tank", "ranger", "caster"] as const) {
    assert.deepEqual(buyUpgrade({ class: classId, rank: 1 }, 20, [], { stat: "healingPower" }), {
      ok: false,
      reason: "no-stat",
    });
  }
  // A stored upgrade of a stat the class doesn't have never counts.
  assert.deepEqual(statsWithUpgrades("adventurer", [{ stat: "healingPower", paid: 5 }]), baseStats("adventurer"));
});

test("a healing power upgrade bought in a game counts at once", () => {
  const state = newGameState(FIRST_DUNGEON_MAP, [{ id: 1, stats: baseStats("healer"), classId: "healer" }], createTrack([1], new Map()));
  const after = applyUpgrade(state, 1, "healer", { stat: "healingPower" });
  assert.equal(after.characters[0]!.stats.healingPower, 4);
});
