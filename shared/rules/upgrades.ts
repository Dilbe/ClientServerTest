// Upgrading stats and resetting upgrades (design.md, Upgrade points and
// Resetting upgrades). Shared so the server and the client work out costs,
// points and stats the same way.
//
// A character stores every upgrade it bought, with what was paid for it.
// Its stats and the points it has left follow from those and its level
// (architecture.md, Characters).

import { upgradePointsEarned, xpForLevel } from "./advancement.ts";
import { baseStats, STATS, type StatId, type Stats } from "./stats.ts";

/** One stat upgrade a character bought: +1 to the stat, for `paid` upgrade points. */
export interface Upgrade {
  stat: StatId;
  /**
   * What it cost when it was bought. Stored rather than worked out again,
   * so a later change to the costs doesn't change what was already paid.
   */
  paid: number;
}

/**
 * What the n-th upgrade of a stat costs (n = 1 for the first):
 * first upgrade cost × n^exponent, rounded up.
 *
 * Powers with a fractional exponent are calculated with floating point,
 * which can be a hair off: 32^1.6 comes out as 256.00000000000006 instead
 * of 256. Rounding that up would charge one point too many, so a result
 * within a tiny margin of a whole number counts as that whole number.
 */
export function upgradeCost(stat: StatId, n: number): number {
  const { firstUpgradeCost, upgradeCostExponent } = STATS[stat];
  const exact = firstUpgradeCost * n ** upgradeCostExponent;
  return Math.ceil(exact - 1e-9);
}

/** How many times the character upgraded this stat. */
export function timesUpgraded(upgrades: readonly Upgrade[], stat: StatId): number {
  return upgrades.filter((upgrade) => upgrade.stat === stat).length;
}

/** What upgrading the stat once more costs now. */
export function nextUpgradeCost(upgrades: readonly Upgrade[], stat: StatId): number {
  return upgradeCost(stat, timesUpgraded(upgrades, stat) + 1);
}

/** The points spent so far: what was paid, not what the upgrades would cost today. */
export function pointsSpent(upgrades: readonly Upgrade[]): number {
  return upgrades.reduce((total, upgrade) => total + upgrade.paid, 0);
}

/** The upgrade points the character can still spend at this level. */
export function pointsLeft(level: number, upgrades: readonly Upgrade[]): number {
  return upgradePointsEarned(level) - pointsSpent(upgrades);
}

/** The character's stats: the base stats plus 1 for every upgrade. */
export function statsWithUpgrades(upgrades: readonly Upgrade[]): Stats {
  const stats = baseStats();
  for (const upgrade of upgrades) stats[upgrade.stat] += 1;
  return stats;
}

/** Resetting needs a level to lose: level 2 or higher. */
export const MIN_LEVEL_TO_RESET = 2;

/**
 * The total XP after resetting all upgrades: the character loses one level,
 * and the XP towards the next level is lost too. A level 5 character with
 * 120 XP goes back to level 4 with 60 XP.
 */
export function xpAfterReset(level: number): number {
  return xpForLevel(level - 1);
}
