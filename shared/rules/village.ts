// The village (design.md, The village; issue #295). Shared so the server and
// the client agree on what a job takes and gives.
//
// Times here are wall-clock times, like the rests in rest.ts: a job goes on
// while the server is down, like real time does.

/**
 * The fixed id of every building. The database stores each account's
 * buildings and jobs by these ids, so **an id must never change or be reused
 * once it is in use**; rename the building's `name` instead.
 */
export const BUILDING_IDS = ["woodcutter", "quarry"] as const;
export type BuildingId = (typeof BUILDING_IDS)[number];

/** The resources the village brings. Stored on the account, like silver. */
export const RESOURCE_IDS = ["wood", "stone"] as const;
export type ResourceId = (typeof RESOURCE_IDS)[number];

/** What something in the village costs: the account's wood, stone and silver. */
export interface Cost {
  wood: number;
  stone: number;
  silver: number;
}

export interface Building {
  name: string;
  /** What a job in it earns. */
  resource: ResourceId;
  /** How many characters can work in it at the same time, at a building level. */
  slots: (level: number) => number;
  /**
   * What each upgrade costs (issue #296): the first entry takes it from
   * level 1 to 2, the next from 2 to 3, and so on. The last entry gives its
   * max level, so a longer list is a higher max level.
   */
  upgradeCosts: readonly Cost[];
}

/**
 * Every building, in the order the village page shows them. Balance numbers:
 * change them freely. The woodcutter and the quarry are upgraded mostly
 * with the other one's resource, so neither can be built up alone.
 */
export const BUILDINGS: Record<BuildingId, Building> = {
  woodcutter: {
    name: "Woodcutter",
    resource: "wood",
    slots: (level) => level,
    upgradeCosts: [
      { wood: 0, stone: 25, silver: 0 },
      { wood: 40, stone: 100, silver: 25 },
      { wood: 100, stone: 300, silver: 75 },
      { wood: 500, stone: 1000, silver: 150 },
    ],
  },
  quarry: {
    name: "Quarry",
    resource: "stone",
    slots: (level) => level,
    upgradeCosts: [
      { wood: 25, stone: 0, silver: 0 },
      { wood: 100, stone: 40, silver: 25 },
      { wood: 300, stone: 100, silver: 75 },
      { wood: 1000, stone: 500, silver: 150 },
    ],
  },
};

/** The highest level a building can reach. */
export function maxBuildingLevel(building: BuildingId): number {
  return BUILDINGS[building].upgradeCosts.length + 1;
}

/** What upgrading a building from `level` to the next level costs, or null at its max level. */
export function upgradeCost(building: BuildingId, level: number): Cost | null {
  return BUILDINGS[building].upgradeCosts[level - 1] ?? null;
}

/** Whether these resources pay for this cost. */
export function canPay(have: Cost, cost: Cost): boolean {
  return have.wood >= cost.wood && have.stone >= cost.stone && have.silver >= cost.silver;
}

/** A cost as the village page writes it, for example "40 wood, 100 stone, 25 silver". */
export function costText(cost: Cost): string {
  const parts = (["wood", "stone", "silver"] as const).filter((key) => cost[key] > 0).map((key) => `${cost[key]} ${key}`);
  return parts.length > 0 ? parts.join(", ") : "nothing";
}

/** The buildings a player has as soon as they get the village, at level 1. */
export const STARTING_BUILDINGS: readonly BuildingId[] = ["woodcutter", "quarry"];

export const HOUR_MS = 60 * 60_000;

/** How long a job lasts: 1 hour per level of the character. A balance number. */
export function jobLengthMs(characterLevel: number): number {
  return characterLevel * HOUR_MS;
}

/** What a job earns per full hour: 1 per rank of the character. A balance number. */
export function earnedPerHour(rank: number): number {
  return rank;
}

/**
 * What a job earned from `startedAt` until `until`: only full hours count,
 * so a character taken out early keeps what it earned in the hours it
 * finished (design.md, The buildings).
 */
export function earned(perHour: number, startedAt: number, until: number): number {
  return Math.floor(Math.max(0, until - startedAt) / HOUR_MS) * perHour;
}
