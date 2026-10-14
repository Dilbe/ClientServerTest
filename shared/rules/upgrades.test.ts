import { test } from "node:test";
import assert from "node:assert/strict";
import { levelFromXp, upgradePointsEarned } from "./advancement.ts";
import { STATS, UPGRADABLE_STAT_IDS, type UpgradableStatId } from "./stats.ts";
import { FIRST_DUNGEON_MAP } from "./dungeon-map.ts";
import { baseStats } from "./stats.ts";
import { newGameState } from "./turn.ts";
import {
  applyUpgrade,
  buyUpgrade,
  abilityUpgradeCost,
  abilityUpgradeCounts,
  nextAbilityUpgradeCost,
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

test("ability upgrades cost according to the table in design.md, Ability upgrades, up to their limit", () => {
  const costs = (ability: "heavyStrike" | "charge", upgrade: "cooldown" | "range") => {
    const upgrades: Upgrade[] = [];
    for (;;) {
      const paid = nextAbilityUpgradeCost(upgrades, ability, upgrade);
      if (paid === undefined) return upgrades.map((u) => u.paid);
      upgrades.push({ ability, upgrade, paid });
    }
  };
  assert.deepEqual(costs("heavyStrike", "cooldown"), [10, 40, 90]);
  assert.deepEqual(costs("charge", "cooldown"), [10, 40, 90]);
  assert.deepEqual(costs("charge", "range"), [5, 15]);
  // Heavy strike has no range.
  assert.equal(nextAbilityUpgradeCost([], "heavyStrike", "range"), undefined);
  // Each ability counts its own upgrades.
  assert.equal(nextAbilityUpgradeCost([{ ability: "heavyStrike", upgrade: "cooldown", paid: 10 }], "charge", "cooldown"), 10);
});

test("the cost of the n-th ability upgrade, for the game guide", () => {
  assert.deepEqual([1, 2, 3].map((n) => abilityUpgradeCost("cleave", "cooldown", n)), [10, 40, 90]);
  // No 4th cooldown upgrade, and heavy strike has no range.
  assert.equal(abilityUpgradeCost("cleave", "cooldown", 4), undefined);
  assert.equal(abilityUpgradeCost("heavyStrike", "range", 1), undefined);
});

test("ability upgrades cost points, but don't change the stats", () => {
  const upgrades: Upgrade[] = [
    { stat: "hitPoints", paid: 1 },
    { ability: "charge", upgrade: "range", paid: 5 },
    { ability: "charge", upgrade: "cooldown", paid: 10 },
    { ability: "charge", upgrade: "cooldown", paid: 40 },
  ];
  assert.equal(pointsSpent(upgrades), 56);
  assert.deepEqual(statsWithUpgrades(upgrades), { actions: 1, movement: 1, attackDamage: 1, hitPoints: 11 });
  assert.deepEqual(abilityUpgradeCounts(upgrades), { charge: { range: 1, cooldown: 2 } });
  assert.equal(nextUpgradeCost(upgrades, "hitPoints"), 2);
});

test("resetting follows the example in design.md: level 5 with 60 XP becomes level 4 with 30 XP and 9 points", () => {
  assert.equal(levelFromXp(60, 1), 5);
  const xp = xpAfterReset(5);
  assert.equal(xp, 30);
  assert.equal(levelFromXp(xp, 1), 4);
  assert.equal(upgradePointsEarned(4), 9);
});

const RANK_3 = { class: "adventurer", rank: 3 } as const;

test("buying an upgrade works out its cost, and refuses what the character can't have or afford (issue #153)", () => {
  assert.deepEqual(buyUpgrade(RANK_3, 2, [], { stat: "hitPoints" }), { ok: true, upgrade: { stat: "hitPoints", paid: 1 } });
  // The second hit point costs 2; level 2 has earned 2 points, and 1 is spent.
  const one: Upgrade[] = [{ stat: "hitPoints", paid: 1 }];
  assert.deepEqual(buyUpgrade(RANK_3, 2, one, { stat: "hitPoints" }), { ok: false, reason: "not-enough-points" });
  assert.deepEqual(buyUpgrade(RANK_3, 3, one, { stat: "hitPoints" }), { ok: true, upgrade: { stat: "hitPoints", paid: 2 } });

  assert.deepEqual(buyUpgrade(RANK_3, 30, [], { ability: "charge", upgrade: "range" }), {
    ok: true,
    upgrade: { ability: "charge", upgrade: "range", paid: 5 },
  });
  assert.deepEqual(buyUpgrade(RANK_3, 30, [], { ability: "cleave", upgrade: "cooldown" }), { ok: false, reason: "no-ability" });
  assert.deepEqual(buyUpgrade(RANK_3, 30, [], { ability: "heavyStrike", upgrade: "range" }), { ok: false, reason: "not-upgradable" });
});

test("an upgrade during a game counts at once; hit points heal the living, not the dead (issue #153)", () => {
  const state = newGameState(
    FIRST_DUNGEON_MAP,
    [
      { id: 1, stats: baseStats(), abilities: ["charge"], abilityUpgrades: { charge: { range: 1 } } },
      { id: 2, stats: baseStats() },
    ],
    [],
  );
  const hurt = { ...state, characters: state.characters.map((c) => ({ ...c, hp: c.id === 1 ? 4 : 0 })) };

  const living = applyUpgrade(hurt, 1, { stat: "hitPoints" }).characters[0]!;
  assert.equal(living.stats.hitPoints, 11);
  assert.equal(living.hp, 5);
  const dead = applyUpgrade(hurt, 2, { stat: "hitPoints" }).characters[1]!;
  assert.equal(dead.stats.hitPoints, 11);
  assert.equal(dead.hp, 0);

  assert.equal(applyUpgrade(hurt, 1, { stat: "actions" }).characters[0]!.stats.actions, 2);
  assert.deepEqual(applyUpgrade(hurt, 1, { ability: "charge", upgrade: "range" }).characters[0]!.abilityUpgrades, {
    charge: { range: 2 },
  });
  assert.deepEqual(applyUpgrade(hurt, 1, { ability: "charge", upgrade: "cooldown" }).characters[0]!.abilityUpgrades, {
    charge: { range: 1, cooldown: 1 },
  });
  // The given state isn't changed.
  assert.equal(hurt.characters[0]!.stats.hitPoints, 10);
  assert.throws(() => applyUpgrade(hurt, 9, { stat: "hitPoints" }), /isn't in this game/);
});
