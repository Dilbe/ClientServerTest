// Classes, defined as data (design.md, Class and rank and Advanced classes):
// per class its name, how its max level is worked out, its base stats with
// their upgrade costs, and which rank gives which ability. Adding a class
// should mostly mean adding an entry here.

// Only a type from abilities.ts: it reads this file, and type imports
// disappear when the code runs, so there is no import cycle.
import type { AbilityId } from "./abilities.ts";
import { powerCost, type CostFormula } from "./costs.ts";
import type { CharacterState } from "./game-state.ts";
import { STAT_IDS, type ClassOnlyStatId, type CommonStatId, type StatId, type Stats } from "./stats.ts";

export const CLASS_IDS = ["adventurer", "tank", "healer", "ranger", "caster"] as const;
export type ClassId = (typeof CLASS_IDS)[number];

/**
 * The classes made from two rank 5 adventurers (design.md, Advanced
 * classes). They can't be bought.
 */
export const ADVANCED_CLASS_IDS = ["tank", "healer", "ranger", "caster"] as const satisfies readonly ClassId[];
export type AdvancedClassId = (typeof ADVANCED_CLASS_IDS)[number];

/**
 * One stat of a class: what a new character starts with, what one upgrade
 * adds and what upgrading it costs.
 */
export interface ClassStat {
  /** The value every new character of the class starts with. */
  base: number;
  /** What one upgrade adds: 1 unless the class says otherwise (a tank gets 2 hit points). */
  perUpgrade?: number;
  /**
   * What the n-th upgrade costs, in upgrade points, before it is rounded up
   * (design.md, Upgrade points). See `upgradeCost` in upgrades.ts.
   */
  cost: CostFormula;
}

export interface ClassDefinition {
  /** What the game shows. */
  name: string;
  /**
   * Levels on top of rank × 10 for the max level: 0 for an adventurer, 10
   * for an advanced class (design.md, Advanced classes).
   */
  extraMaxLevels: number;
  /** Every common stat, and the stats of one class that this class has (the healer's healing power). */
  stats: ClassStats;
  /** Which rank unlocks which ability; higher ranks keep it. */
  abilities: readonly { ability: AbilityId; fromRank: number }[];
  /**
   * Its melee attacks do half its attack damage, rounded down (design.md,
   * The caster). Its spells still use the full attack damage.
   */
  halfMeleeDamage?: true;
}

/** The stats of a class: every common stat, and the stats of one class it has. */
export type ClassStats = Record<CommonStatId, ClassStat> & Partial<Record<ClassOnlyStatId, ClassStat>>;

const ADVENTURER_STATS: ClassStats = {
  actions: { base: 1, cost: powerCost(20, 2) },
  movement: { base: 1, cost: powerCost(5, 1.5) },
  attackDamage: { base: 1, cost: powerCost(5, 1.5) },
  hitPoints: { base: 10, cost: powerCost(1, 1) },
};

/**
 * The tank (design.md, The tank): twice the hit points, 2 per upgrade and
 * cheap; attack damage and actions are dear.
 */
const TANK_STATS: ClassStats = {
  actions: { base: 1, cost: (n) => 20 * (n + 1) ** 2 },
  movement: ADVENTURER_STATS.movement,
  attackDamage: { base: 1, cost: powerCost(8, 1.6) },
  hitPoints: { base: 20, perUpgrade: 2, cost: powerCost(0.5, 1) },
};

/**
 * The caster (design.md, The caster): fragile, with a higher attack damage
 * for its spells that is a bit cheaper to upgrade.
 */
const CASTER_STATS: ClassStats = {
  actions: ADVENTURER_STATS.actions,
  movement: ADVENTURER_STATS.movement,
  attackDamage: { base: 2, cost: powerCost(4, 1.5) },
  hitPoints: { base: 6, cost: powerCost(1, 1) },
};

/**
 * The healer (design.md, The healer): fast and fragile, with healing power,
 * a stat only it has. Attack damage is as dear as the tank's. Movement
 * can't be upgraded; its cost formula is the adventurer's, like every
 * class's, for when it can.
 */
const HEALER_STATS: ClassStats = {
  actions: ADVENTURER_STATS.actions,
  movement: { base: 2, cost: ADVENTURER_STATS.movement.cost },
  attackDamage: { base: 1, cost: powerCost(8, 1.6) },
  hitPoints: { base: 8, cost: powerCost(1, 1) },
  healingPower: { base: 3, cost: powerCost(5, 1.6) },
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
  tank: {
    name: "Tank",
    extraMaxLevels: 10,
    stats: TANK_STATS,
    abilities: [
      { ability: "block", fromRank: 1 },
      { ability: "taunt", fromRank: 2 },
      { ability: "regen", fromRank: 3 },
      { ability: "protect", fromRank: 4 },
      { ability: "leap", fromRank: 5 },
    ],
  },
  healer: {
    name: "Healer",
    extraMaxLevels: 10,
    stats: HEALER_STATS,
    abilities: [
      { ability: "healingTouch", fromRank: 1 },
      { ability: "renew", fromRank: 2 },
      { ability: "ward", fromRank: 3 },
      { ability: "groupHeal", fromRank: 4 },
    ],
  },
  ranger: placeholder("Ranger"),
  caster: {
    name: "Caster",
    extraMaxLevels: 10,
    stats: CASTER_STATS,
    abilities: [
      { ability: "fireball", fromRank: 1 },
      { ability: "recall", fromRank: 1 },
      { ability: "frostWave", fromRank: 2 },
      { ability: "teleport", fromRank: 3 },
      { ability: "createWall", fromRank: 4 },
      { ability: "meteor", fromRank: 5 },
    ],
    halfMeleeDamage: true,
  },
};

/** What the game shows for each class. */
export const CLASS_NAMES = Object.fromEntries(CLASS_IDS.map((id) => [id, CLASSES[id].name])) as Record<ClassId, string>;

/** Whether a class is one of the advanced classes. */
export function isAdvancedClass(classId: ClassId): classId is AdvancedClassId {
  return (ADVANCED_CLASS_IDS as readonly ClassId[]).includes(classId);
}

/** Whether characters of this class have the stat: every class has the common ones. */
export function hasStat(classId: ClassId, stat: StatId): boolean {
  return CLASSES[classId].stats[stat] !== undefined;
}

/** The stats characters of this class have, in the order of `STAT_IDS`. */
export function statsOf(classId: ClassId): StatId[] {
  return STAT_IDS.filter((id) => hasStat(classId, id));
}

/** One stat of a class. Throws for a stat the class doesn't have: check with `hasStat` first. */
export function classStat(classId: ClassId, stat: StatId): ClassStat {
  const found = CLASSES[classId].stats[stat];
  if (!found) throw new Error(`The ${CLASSES[classId].name.toLowerCase()} has no ${stat}.`);
  return found;
}

/** What one upgrade of the stat adds for this class. */
export function perUpgrade(classId: ClassId, stat: StatId): number {
  return classStat(classId, stat).perUpgrade ?? 1;
}

/** The stats of a character of this class that hasn't improved any of them yet: only the ones the class has. */
export function baseStats(classId: ClassId): Stats {
  return Object.fromEntries(statsOf(classId).map((id) => [id, classStat(classId, id).base])) as Stats;
}

/**
 * The damage of a character's melee attack before abilities: its attack
 * damage, or half of it, rounded down, for a class with half melee damage
 * (design.md, The caster).
 */
export function meleeDamage(character: Pick<CharacterState, "stats" | "halfMeleeDamage">): number {
  const { attackDamage } = character.stats;
  return character.halfMeleeDamage ? Math.floor(attackDamage / 2) : attackDamage;
}
