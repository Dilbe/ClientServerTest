// Stats and monster types, defined as data (design.md, Built to grow):
// adding a stat or a monster type should mostly mean adding an entry here.

export const STAT_IDS = ["movement", "attackDamage", "hitPoints"] as const;
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
  movement: { name: "Movement", description: "Hexes moved per move action.", base: 1 },
  attackDamage: { name: "Attack damage", description: "Damage done to an adjacent enemy per attack.", base: 1 },
  hitPoints: { name: "Hit points", description: "Damage that can be taken before dying.", base: 10 },
};

/** The stats of a character that hasn't improved any of them yet. */
export function baseStats(): Stats {
  return {
    movement: STATS.movement.base,
    attackDamage: STATS.attackDamage.base,
    hitPoints: STATS.hitPoints.base,
  };
}

export const MONSTER_TYPE_IDS = ["basic"] as const;
export type MonsterTypeId = (typeof MONSTER_TYPE_IDS)[number];

export interface MonsterType {
  id: MonsterTypeId;
  name: string;
  stats: Stats;
}

export const MONSTER_TYPES: Record<MonsterTypeId, MonsterType> = {
  basic: {
    id: "basic",
    name: "Monster",
    stats: { movement: 1, attackDamage: 1, hitPoints: 10 },
  },
};
