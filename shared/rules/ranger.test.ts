import { test } from "node:test";
import assert from "node:assert/strict";
import { attackRange, baseStats, CLASSES, classRange, hasStat, isRangedAttack, rangeText, statsOf } from "./classes.ts";
import { FIRST_DUNGEON_MAP } from "./dungeon-map.ts";
import { createTrack } from "./track.ts";
import { newGameState } from "./turn.ts";
import { applyUpgrade, buyUpgrade, statsWithUpgrades, statUpgradeLimitReached, upgradeCost, type Upgrade } from "./upgrades.ts";

test("a ranger starts with 8 hit points and a range of 2 to 3; actions, movement and attack damage are an adventurer's", () => {
  assert.deepEqual(baseStats("ranger"), { actions: 1, movement: 1, attackDamage: 1, hitPoints: 8, range: 3 });
  assert.equal(CLASSES.ranger.extraMaxLevels, 10);
  assert.deepEqual(classRange("ranger", baseStats("ranger")), { shortest: 2, longest: 3 });
  assert.equal(rangeText(classRange("ranger", baseStats("ranger"))), "2–3");
});

test("every other class has a range of 1 to 1, which isn't shown", () => {
  for (const classId of ["adventurer", "tank", "healer", "caster"] as const) {
    assert.ok(!hasStat(classId, "range"), classId);
    assert.ok(!statsOf(classId).includes("range"), classId);
    const range = classRange(classId, baseStats(classId));
    assert.deepEqual(range, { shortest: 1, longest: 1 }, classId);
    assert.ok(!isRangedAttack(range), classId);
  }
  assert.ok(isRangedAttack(classRange("ranger", baseStats("ranger"))));
});

test("a ranger in a game has its range: the shortest from its class, the longest from its stats", () => {
  const state = newGameState(
    FIRST_DUNGEON_MAP,
    [
      { id: 1, stats: baseStats("ranger"), classId: "ranger" },
      { id: 2, stats: baseStats("adventurer"), classId: "adventurer" },
    ],
    createTrack([1, 2], new Map()),
  );
  assert.equal(state.characters[0]!.shortestRange, 2);
  assert.deepEqual(attackRange(state.characters[0]!), { shortest: 2, longest: 3 });
  // Left out for 1, as halfMeleeDamage is for a class without it.
  assert.ok(!("shortestRange" in state.characters[1]!));
  assert.deepEqual(attackRange(state.characters[1]!), { shortest: 1, longest: 1 });
});

test("a ranger's upgrade costs follow design.md, The ranger", () => {
  const costs = (stat: "hitPoints" | "attackDamage" | "actions" | "range", n: number) =>
    Array.from({ length: n }, (_, i) => upgradeCost("ranger", stat, i + 1));
  assert.deepEqual(costs("hitPoints", 4), [1, 2, 3, 4]);
  assert.deepEqual(costs("attackDamage", 4), [6, 17, 32, 48]);
  assert.deepEqual(costs("actions", 3), [20, 80, 180]);
  assert.deepEqual(costs("range", 2), [15, 60]);
});

test("a range upgrade adds 1 to the longest shot, at most twice; the shortest stays 2", () => {
  const one: Upgrade[] = [{ stat: "range", paid: 15 }];
  const two: Upgrade[] = [...one, { stat: "range", paid: 60 }];
  assert.deepEqual(buyUpgrade({ class: "ranger", rank: 1 }, 20, [], { stat: "range" }), {
    ok: true,
    upgrade: { stat: "range", paid: 15 },
  });
  assert.deepEqual(buyUpgrade({ class: "ranger", rank: 1 }, 20, one, { stat: "range" }), {
    ok: true,
    upgrade: { stat: "range", paid: 60 },
  });
  assert.deepEqual(classRange("ranger", statsWithUpgrades("ranger", two)), { shortest: 2, longest: 5 });
  // Beyond the limit: refused, however many points it has.
  assert.ok(statUpgradeLimitReached("ranger", two, "range"));
  assert.ok(!statUpgradeLimitReached("ranger", one, "range"));
  assert.deepEqual(buyUpgrade({ class: "ranger", rank: 1 }, 30, two, { stat: "range" }), {
    ok: false,
    reason: "not-upgradable",
  });
  // A stored upgrade beyond the limit never counts.
  assert.equal(statsWithUpgrades("ranger", [...two, { stat: "range", paid: 135 }]).range, 5);
  // Other stats have no limit.
  assert.ok(!statUpgradeLimitReached("ranger", Array(10).fill({ stat: "hitPoints", paid: 1 }), "hitPoints"));
});

test("range can only be bought for a ranger", () => {
  for (const classId of ["adventurer", "tank", "healer", "caster"] as const) {
    assert.deepEqual(buyUpgrade({ class: classId, rank: 1 }, 20, [], { stat: "range" }), { ok: false, reason: "no-stat" });
  }
  assert.deepEqual(statsWithUpgrades("adventurer", [{ stat: "range", paid: 15 }]), baseStats("adventurer"));
});

test("a range upgrade bought in a game counts at once", () => {
  const state = newGameState(FIRST_DUNGEON_MAP, [{ id: 1, stats: baseStats("ranger"), classId: "ranger" }], createTrack([1], new Map()));
  const after = applyUpgrade(state, 1, "ranger", { stat: "range" });
  assert.deepEqual(attackRange(after.characters[0]!), { shortest: 2, longest: 4 });
});
