// Upgrading stats and abilities, and resetting upgrades (design.md, Upgrade
// points, Ability upgrades and Resetting upgrades). Shared so the server and the client work out costs,
// points and stats the same way.
//
// A character stores every upgrade it bought, with what was paid for it.
// Its stats and the points it has left follow from those and its level
// (architecture.md, Characters).

import {
  ABILITIES,
  abilitiesOf,
  type AbilityId,
  type AbilityUpgradeCounts,
  type AbilityUpgradeId,
} from "./abilities.ts";
import { upgradePointsEarned, xpForLevel, type ClassId } from "./advancement.ts";
import type { CharacterId, GameState } from "./game-state.ts";
import { baseStats, STATS, type StatId, type Stats, type UpgradableStatId } from "./stats.ts";

/** One stat upgrade a character bought: +1 to the stat, for `paid` upgrade points. */
export interface StatUpgrade {
  stat: StatId;
  /**
   * What it cost when it was bought. Stored rather than worked out again,
   * so a later change to the costs doesn't change what was already paid.
   */
  paid: number;
}

/**
 * One ability upgrade a character bought (design.md, Ability upgrades), such
 * as a turn off the cooldown of charge, for `paid` upgrade points.
 */
export interface AbilityUpgrade {
  ability: AbilityId;
  upgrade: AbilityUpgradeId;
  /** What it cost when it was bought, as for a stat upgrade. */
  paid: number;
}

export type Upgrade = StatUpgrade | AbilityUpgrade;

/**
 * What a player asks to upgrade: a stat, or one upgrade of an ability. Never
 * the cost: that is worked out with `buyUpgrade`.
 */
export type UpgradeChoice = { stat: UpgradableStatId } | { ability: AbilityId; upgrade: AbilityUpgradeId };

/** An upgrade that can be bought today: movement can't (design.md, Upgrade points). */
export type BoughtUpgrade = (StatUpgrade & { stat: UpgradableStatId }) | AbilityUpgrade;

export type BuyUpgradeResult =
  | { ok: true; upgrade: BoughtUpgrade }
  | { ok: false; reason: "no-ability" | "not-upgradable" | "not-enough-points" };

/**
 * Whether a character can buy an upgrade, and if so the upgrade with what it
 * costs now (design.md, Upgrade points and Ability upgrades). `upgrades` are
 * all it bought so far and `level` its level now: on the character page the
 * record's, in a game (issue #153) also what it bought and gained there.
 * Shared by both, so the rules are the same wherever the points are spent.
 */
export function buyUpgrade(
  character: { class: ClassId; rank: number },
  level: number,
  upgrades: readonly Upgrade[],
  choice: UpgradeChoice,
): BuyUpgradeResult {
  let upgrade: BoughtUpgrade;
  if ("stat" in choice) {
    upgrade = { stat: choice.stat, paid: nextUpgradeCost(upgrades, choice.stat) };
  } else {
    if (!abilitiesOf(character.class, character.rank).includes(choice.ability)) return { ok: false, reason: "no-ability" };
    const cost = nextAbilityUpgradeCost(upgrades, choice.ability, choice.upgrade);
    if (cost === undefined) return { ok: false, reason: "not-upgradable" };
    upgrade = { ability: choice.ability, upgrade: choice.upgrade, paid: cost };
  }
  if (upgrade.paid > pointsLeft(level, upgrades)) return { ok: false, reason: "not-enough-points" };
  return { ok: true, upgrade };
}

/**
 * Returns a new game state with an upgrade bought during the game (issue
 * #153): it counts at once. A hit points upgrade raises the max hit points
 * and, for a living character, its current hit points by the same amount.
 * A dead character stays dead. The given state isn't changed.
 */
export function applyUpgrade(state: GameState, characterId: CharacterId, upgrade: UpgradeChoice): GameState {
  if (!state.characters.some((c) => c.id === characterId)) throw new Error(`Character ${characterId} isn't in this game.`);
  return {
    ...state,
    characters: state.characters.map((c) => {
      if (c.id !== characterId) return c;
      if ("stat" in upgrade) {
        const hp = upgrade.stat === "hitPoints" && c.hp > 0 ? c.hp + 1 : c.hp;
        return { ...c, stats: { ...c.stats, [upgrade.stat]: c.stats[upgrade.stat] + 1 }, hp };
      }
      const ofAbility = c.abilityUpgrades[upgrade.ability] ?? {};
      return {
        ...c,
        abilityUpgrades: {
          ...c.abilityUpgrades,
          [upgrade.ability]: { ...ofAbility, [upgrade.upgrade]: (ofAbility[upgrade.upgrade] ?? 0) + 1 },
        },
      };
    }),
  };
}

/**
 * first upgrade cost × n^exponent, rounded up: what the n-th upgrade costs
 * (n = 1 for the first), for stats and abilities alike.
 *
 * Powers with a fractional exponent are calculated with floating point,
 * which can be a hair off: 32^1.6 comes out as 256.00000000000006 instead
 * of 256. Rounding that up would charge one point too many, so a result
 * within a tiny margin of a whole number counts as that whole number.
 */
function costOf(firstUpgradeCost: number, upgradeCostExponent: number, n: number): number {
  const exact = firstUpgradeCost * n ** upgradeCostExponent;
  return Math.ceil(exact - 1e-9);
}

/** What the n-th upgrade of a stat costs (n = 1 for the first). */
export function upgradeCost(stat: StatId, n: number): number {
  const { firstUpgradeCost, upgradeCostExponent } = STATS[stat];
  return costOf(firstUpgradeCost, upgradeCostExponent, n);
}

/** How many times the character upgraded this stat. */
export function timesUpgraded(upgrades: readonly Upgrade[], stat: StatId): number {
  return upgrades.filter((upgrade) => "stat" in upgrade && upgrade.stat === stat).length;
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

/** The character's stats: the base stats plus 1 for every stat upgrade. */
export function statsWithUpgrades(upgrades: readonly Upgrade[]): Stats {
  const stats = baseStats();
  for (const upgrade of upgrades) if ("stat" in upgrade) stats[upgrade.stat] += 1;
  return stats;
}

/** How often the character upgraded each of its abilities, per upgrade. */
export function abilityUpgradeCounts(upgrades: readonly Upgrade[]): AbilityUpgradeCounts {
  const counts: AbilityUpgradeCounts = {};
  for (const upgrade of upgrades) {
    if (!("ability" in upgrade)) continue;
    const ofAbility = (counts[upgrade.ability] ??= {});
    ofAbility[upgrade.upgrade] = (ofAbility[upgrade.upgrade] ?? 0) + 1;
  }
  return counts;
}

/**
 * What upgrading an ability once more costs now, or `undefined` when it
 * can't be: the ability has no such upgrade (heavy strike has no range), or
 * it was upgraded as often as it can be.
 */
export function nextAbilityUpgradeCost(
  upgrades: readonly Upgrade[],
  ability: AbilityId,
  upgrade: AbilityUpgradeId,
): number | undefined {
  const definition = ABILITIES[ability].upgrades[upgrade];
  if (!definition) return undefined;
  const times = abilityUpgradeCounts(upgrades)[ability]?.[upgrade] ?? 0;
  if (times >= definition.maxUpgrades) return undefined;
  return costOf(definition.firstUpgradeCost, definition.upgradeCostExponent, times + 1);
}

/** Resetting needs a level to lose: level 2 or higher. */
export const MIN_LEVEL_TO_RESET = 2;

/**
 * The total XP after resetting all upgrades: the character loses one level,
 * and the XP towards the next level is lost too. A level 5 character with
 * 60 XP goes back to level 4 with 30 XP.
 */
export function xpAfterReset(level: number): number {
  return xpForLevel(level - 1);
}
