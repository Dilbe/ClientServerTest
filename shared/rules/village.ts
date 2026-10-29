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

export interface Building {
  name: string;
  /** What a job in it earns. */
  resource: ResourceId;
  /** How many characters can work in it at the same time, at a building level. */
  slots: (level: number) => number;
}

/**
 * Every building, in the order the village page shows them. Balance numbers:
 * change them freely. Upgrading comes with issue #296; until then every
 * building stays at level 1.
 */
export const BUILDINGS: Record<BuildingId, Building> = {
  woodcutter: { name: "Woodcutter", resource: "wood", slots: (level) => level },
  quarry: { name: "Quarry", resource: "stone", slots: (level) => level },
};

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
