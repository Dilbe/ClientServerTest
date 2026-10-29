// Classes, defined as data (design.md, Class and rank and Advanced classes):
// per class its name, how its max level is worked out, its base stats with
// their upgrade costs, and which rank gives which ability. Adding a class
// should mostly mean adding an entry here.

// Only a type from abilities.ts: it reads this file, and type imports
// disappear when the code runs, so there is no import cycle.
import type { AbilityId } from "./abilities.ts";
import { STAT_IDS, type StatId, type Stats } from "./stats.ts";

export const CLASS_IDS = ["adventurer", "tank", "healer", "ranger", "caster"] as const;
export type ClassId = (typeof CLASS_IDS)[number];

/**
 * The classes made from two rank 5 adventurers (design.md, Advanced
 * classes). They can't be bought.
 */
export const ADVANCED_CLASS_IDS = ["tank", "healer", "ranger", "caster"] as const satisfies readonly ClassId[];
export type AdvancedClassId = (typeof ADVANCED_CLASS_IDS)[number];

/** One stat of a class: what a new character starts with, and what upgrading it costs. */
export interface ClassStat {
  /** The value every new character of the class starts with. */
  base: number;
  /**
   * What upgrading the stat costs, in upgrade points (design.md, Upgrade
   * points): the n-th upgrade costs firstUpgradeCost × n^upgradeCostExponent,
   * rounded up. See `upgradeCost` in upgrades.ts.
   */
  firstUpgradeCost: number;
  upgradeCostExponent: number;
}

export interface ClassDefinition {
  /** What the game shows. */
  name: string;
  /**
   * Levels on top of rank × 10 for the max level: 0 for an adventurer, 10
   * for an advanced class (design.md, Advanced classes).
   */
  extraMaxLevels: number;
  stats: Record<StatId, ClassStat>;
  /** Which rank unlocks which ability; higher ranks keep it. */
  abilities: readonly { ability: AbilityId; fromRank: number }[];
}

const ADVENTURER_STATS: Record<StatId, ClassStat> = {
  actions: { base: 1, firstUpgradeCost: 20, upgradeCostExponent: 2 },
  movement: { base: 1, firstUpgradeCost: 5, upgradeCostExponent: 1.5 },
  attackDamage: { base: 1, firstUpgradeCost: 5, upgradeCostExponent: 1.5 },
  hitPoints: { base: 10, firstUpgradeCost: 1, upgradeCostExponent: 1 },
};

/**
 * An advanced class whose own design isn't built yet (issue #241): the
 * adventurer's stats and costs, and no abilities.
 */
function placeholder(name: string): ClassDefinition {
  return { name, extraMaxLevels: 10, stats: ADVENTURER_STATS, abilities: [] };
}

export const CLASSES: Record<ClassId, ClassDefinition> = {
  adventurer: {
    name: "Adventurer",
    extraMaxLevels: 0,
    stats: ADVENTURER_STATS,
    abilities: [
      { ability: "heavyStrike", fromRank: 2 },
      { ability: "charge", fromRank: 3 },
      { ability: "cleave", fromRank: 4 },
      { ability: "stun", fromRank: 5 },
    ],
  },
  tank: placeholder("Tank"),
  healer: placeholder("Healer"),
  ranger: placeholder("Ranger"),
  caster: placeholder("Caster"),
};

/** What the game shows for each class. */
export const CLASS_NAMES = Object.fromEntries(CLASS_IDS.map((id) => [id, CLASSES[id].name])) as Record<ClassId, string>;

/** Whether a class is one of the advanced classes. */
export function isAdvancedClass(classId: ClassId): classId is AdvancedClassId {
  return (ADVANCED_CLASS_IDS as readonly ClassId[]).includes(classId);
}

/** The stats of a character of this class that hasn't improved any of them yet. */
export function baseStats(classId: ClassId): Stats {
  const stats = CLASSES[classId].stats;
  return Object.fromEntries(STAT_IDS.map((id) => [id, stats[id].base])) as Stats;
}
