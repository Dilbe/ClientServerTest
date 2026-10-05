// Stats and monster types, defined as data (design.md, Built to grow):
// adding a stat or a monster type should mostly mean adding an entry here.

export const STAT_IDS = ["actions", "movement", "attackDamage", "hitPoints"] as const;
export type StatId = (typeof STAT_IDS)[number];

/** A value for every stat. Used for characters and monster types alike. */
export type Stats = Record<StatId, number>;

export interface StatDefinition {
  name: string;
  description: string;
  /** The value every new character starts with. */
  base: number;
  /**
   * What upgrading the stat costs, in upgrade points (design.md, Upgrade
   * points): the n-th upgrade costs firstUpgradeCost × n^upgradeCostExponent,
   * rounded up. See `upgradeCost` in upgrades.ts.
   */
  firstUpgradeCost: number;
  upgradeCostExponent: number;
}

export const STATS: Record<StatId, StatDefinition> = {
  actions: {
    name: "Actions",
    description: "Actions done per turn.",
    base: 1,
    firstUpgradeCost: 20,
    upgradeCostExponent: 2,
  },
  movement: {
    name: "Movement",
    description: "Hexes moved per move action.",
    base: 1,
    firstUpgradeCost: 5,
    upgradeCostExponent: 1.5,
  },
  attackDamage: {
    name: "Attack damage",
    description: "Damage done to an adjacent enemy per attack.",
    base: 1,
    firstUpgradeCost: 5,
    upgradeCostExponent: 1.5,
  },
  hitPoints: {
    name: "Hit points",
    description: "Damage that can be taken before dying.",
    base: 10,
    firstUpgradeCost: 1,
    upgradeCostExponent: 1,
  },
};

/** The stats of a character that hasn't improved any of them yet. */
export function baseStats(): Stats {
  return {
    actions: STATS.actions.base,
    movement: STATS.movement.base,
    attackDamage: STATS.attackDamage.base,
    hitPoints: STATS.hitPoints.base,
  };
}

export const MONSTER_TYPE_IDS = ["basic", "rat", "guard"] as const;
export type MonsterTypeId = (typeof MONSTER_TYPE_IDS)[number];

/**
 * The rules a monster can use to choose its target (design.md, Monsters).
 * A monster type lists the ones it uses, in order; they are applied one by
 * one until only one player is left. The descriptions are what the game
 * shows the player.
 */
export const TARGET_RULE_IDS = ["closest", "fewestHitPoints", "nextOnTrack"] as const;
export type TargetRuleId = (typeof TARGET_RULE_IDS)[number];

export const TARGET_RULES: Record<TargetRuleId, { description: string }> = {
  closest: {
    description:
      "The player it can reach in the fewest turns. If it can't reach anyone: the closest player in a straight line.",
  },
  fewestHitPoints: { description: "The player with the fewest hit points." },
  nextOnTrack: { description: "The first player after the monster on the initiative track." },
};

export interface MonsterType {
  id: MonsterTypeId;
  name: string;
  /**
   * A short mark for the map and the initiative track, in front of the
   * monster's number: "R3" is monster 3, a rat. One letter per type, so
   * types never share one.
   */
  label: string;
  stats: Stats;
  /** Gained by every character in the game when a monster of this type dies (design.md, Rewards). */
  xp: number;
  /** Applied in order until one player is left. */
  targetRules: readonly TargetRuleId[];
  /**
   * A monster with an alert range starts on guard: it skips its turns until
   * a character is within this many hexes in a straight line, or until it
   * is attacked (design.md, Guards and alert range). Doors don't wake it.
   * Without one, the monster is awake from the start, unless it is in a room
   * behind a closed door.
   */
  alertRange?: number;
}

export const MONSTER_TYPES: Record<MonsterTypeId, MonsterType> = {
  basic: {
    id: "basic",
    name: "Monster",
    label: "M",
    stats: { actions: 1, movement: 1, attackDamage: 1, hitPoints: 3 },
    xp: 5,
    targetRules: ["closest", "fewestHitPoints", "nextOnTrack"],
  },
  /** Fast and weak: the first monster type with 2 actions (issue #83). */
  rat: {
    id: "rat",
    name: "Rat",
    label: "R",
    stats: { actions: 2, movement: 1, attackDamage: 1, hitPoints: 3 },
    xp: 2,
    targetRules: ["closest", "fewestHitPoints", "nextOnTrack"],
  },
  /** Strong and patient: waits at its post until a character comes close (issue #84). */
  guard: {
    id: "guard",
    name: "Guard",
    label: "G",
    stats: { actions: 1, movement: 1, attackDamage: 2, hitPoints: 15 },
    xp: 8,
    targetRules: ["closest", "fewestHitPoints", "nextOnTrack"],
    alertRange: 3,
  },
};
