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
}

export const STATS: Record<StatId, StatDefinition> = {
  actions: { name: "Actions", description: "Actions done per turn.", base: 1 },
  movement: { name: "Movement", description: "Hexes moved per move action.", base: 1 },
  attackDamage: { name: "Attack damage", description: "Damage done to an adjacent enemy per attack.", base: 1 },
  hitPoints: { name: "Hit points", description: "Damage that can be taken before dying.", base: 10 },
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

export const MONSTER_TYPE_IDS = ["basic"] as const;
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
  stats: Stats;
  /** Applied in order until one player is left. */
  targetRules: readonly TargetRuleId[];
}

export const MONSTER_TYPES: Record<MonsterTypeId, MonsterType> = {
  basic: {
    id: "basic",
    name: "Monster",
    stats: { actions: 1, movement: 1, attackDamage: 1, hitPoints: 3 },
    targetRules: ["closest", "fewestHitPoints", "nextOnTrack"],
  },
};
