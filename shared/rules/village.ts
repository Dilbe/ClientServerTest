// The village (design.md, The village; issue #295). Shared so the server and
// the client agree on what a job takes and gives.

import type { ClassId } from "./classes.ts";
//
// Times here are wall-clock times, like the rests in rest.ts: a job goes on
// while the server is down, like real time does.

/**
 * The fixed id of every building. The database stores each account's
 * buildings and jobs by these ids, so **an id must never change or be reused
 * once it is in use**; rename the building's `name` instead.
 */
export const BUILDING_IDS = ["woodcutter", "quarry", "trainingHouse"] as const;
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
  /** What a job in it earns: a resource for the account, or XP for the character (the training house). */
  earns: ResourceId | "xp";
  /**
   * How many characters can work in it at the same time, at a building level.
   * The training house's trainer slot comes on top of these.
   */
  slots: (level: number) => number;
  /** Whether it has a trainer slot (design.md, The training house). */
  trainerSlot: boolean;
  /**
   * What building it costs (issue #297), or null for a building the village
   * starts with. Building it gives level 1.
   */
  buildCost: Cost | null;
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
    earns: "wood",
    slots: (level) => level,
    trainerSlot: false,
    buildCost: null,
    upgradeCosts: [
      { wood: 0, stone: 25, silver: 0 },
      { wood: 40, stone: 100, silver: 25 },
      { wood: 100, stone: 300, silver: 75 },
      { wood: 500, stone: 1000, silver: 150 },
    ],
  },
  quarry: {
    name: "Quarry",
    earns: "stone",
    slots: (level) => level,
    trainerSlot: false,
    buildCost: null,
    upgradeCosts: [
      { wood: 25, stone: 0, silver: 0 },
      { wood: 100, stone: 40, silver: 25 },
      { wood: 300, stone: 100, silver: 75 },
      { wood: 1000, stone: 500, silver: 150 },
    ],
  },
  // About what the woodcutter's levels 2 to 5 cost, split between wood and stone.
  trainingHouse: {
    name: "Training house",
    earns: "xp",
    slots: (level) => level,
    trainerSlot: true,
    buildCost: { wood: 15, stone: 15, silver: 0 },
    upgradeCosts: [
      { wood: 70, stone: 70, silver: 25 },
      { wood: 200, stone: 200, silver: 75 },
      { wood: 750, stone: 750, silver: 150 },
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

/**
 * How long a job lasts. Balance numbers: 1 hour per level of the character
 * in the woodcutter and the quarry, and for the training house's trainer;
 * always 24 hours for a trainee.
 */
export function jobLengthMs(building: BuildingId, characterLevel: number, asTrainer = false): number {
  return BUILDINGS[building].earns === "xp" && !asTrainer ? TRAINING_JOB_MS : characterLevel * HOUR_MS;
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

// ---- The training house (design.md, The training house; issue #297) ----

/** How long a trainee's job lasts. The trainer's lasts 1 hour per level (see `jobLengthMs`). */
export const TRAINING_JOB_MS = 24 * HOUR_MS;

/** The XP a trainee gains per hour without a trainer. A balance number. */
export const TRAINING_XP_PER_HOUR = 10;

/** How many ranks higher an advanced class counts in the training house. */
export const ADVANCED_CLASS_TRAINING_RANKS = 5;

/** What a character is, as far as training goes. */
export interface Trainable {
  class: ClassId;
  rank: number;
}

/** The rank a character counts as in the training house: an advanced class counts 5 ranks higher. */
export function trainingRank(character: Trainable): number {
  return character.class === "adventurer" ? character.rank : character.rank + ADVANCED_CLASS_TRAINING_RANKS;
}

/**
 * How much faster a trainer makes a trainee train: +100% per rank of
 * difference, so ×1 without a trainer or when the trainer isn't higher. An
 * advanced class trainee is only sped up by its own class; an adventurer by
 * any class.
 */
export function trainingSpeed(trainer: Trainable | null, trainee: Trainable): number {
  if (!trainer) return 1;
  if (trainee.class !== "adventurer" && trainer.class !== trainee.class) return 1;
  return 1 + Math.max(0, trainingRank(trainer) - trainingRank(trainee));
}

/** The XP a trainee gains per hour with this trainer, or none. */
export function trainingXpPerHour(trainer: Trainable | null, trainee: Trainable): number {
  return TRAINING_XP_PER_HOUR * trainingSpeed(trainer, trainee);
}

/**
 * The bonus XP a trainer gave in a stretch of time from `from` until
 * `until`, at `perHour` on top of the normal speed (design.md, The training
 * house). A stretch that ended by time, because a job ran out, counts as
 * exactly as possible, rounded up. One that ended because the player took
 * the trainer or the trainee out counts only its full hours.
 */
export function bonusXp(perHour: number, from: number, until: number, fullHoursOnly: boolean): number {
  const ms = Math.max(0, until - from);
  return fullHoursOnly ? Math.floor(ms / HOUR_MS) * perHour : Math.ceil((ms * perHour) / HOUR_MS);
}
