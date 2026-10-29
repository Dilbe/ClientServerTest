// The shapes of the village page's requests and answers (design.md, The
// village; issue #295). Shared so client and server agree on them.

import { z } from "zod";
import type { CharacterSummary } from "./characters.ts";
import { BUILDING_IDS, type BuildingId } from "./rules/village.ts";

/**
 * Puts one of the player's characters to work in a building. It names only
 * the character and the building: how long the job lasts and what it earns
 * the server works out itself, from the character it has stored.
 */
export const startJobRequest = z.object({
  building: z.enum(BUILDING_IDS),
  number: z.number().int().positive(),
  /** Into the training house's trainer slot instead of a normal slot (issue #297). */
  trainer: z.boolean().optional(),
});
export type StartJobRequest = z.infer<typeof startJobRequest>;

/** Takes one of the player's characters out of its building before its job is done. */
export const takeOutRequest = z.object({
  number: z.number().int().positive(),
});
export type TakeOutRequest = z.infer<typeof takeOutRequest>;

/**
 * Upgrades one of the player's buildings by one level. It names the level
 * the player saw, not the price: the server works out the price itself, and
 * refuses when the building is no longer at that level. So a double click,
 * or a request sent again by a flaky network, can't buy two levels where
 * the player meant one.
 */
export const upgradeBuildingRequest = z.object({
  building: z.enum(BUILDING_IDS),
  level: z.number().int().positive(),
});
export type UpgradeBuildingRequest = z.infer<typeof upgradeBuildingRequest>;

/**
 * Builds one of the buildings the village doesn't start with (issue #297).
 * It names only the building: the server works out the price, and refuses
 * a building the player has already, so a double click pays once.
 */
export const buildRequest = z.object({
  building: z.enum(BUILDING_IDS),
});
export type BuildRequest = z.infer<typeof buildRequest>;

/** A character at work, as the village page shows it. */
export interface VillageJob {
  /** The character's number within the account. */
  number: number;
  /** Whether it is the training house's trainer, which earns nothing itself. */
  trainer: boolean;
  /**
   * What it earns per full hour, as stored when the job started. In the
   * training house it is XP, and changes when a trainer comes or goes.
   */
  perHour: number;
  /**
   * What it keeps if it is taken out now, worked out by the server. For XP,
   * no more than the character can still gain before its max level.
   */
  earnedSoFar: number;
  /**
   * How long ago the job started and how long until it is done, in
   * milliseconds from when the server answered: durations, not times, as
   * for the rests (see `restFromNow` in shared/rules/rest.ts).
   */
  startedMsAgo: number;
  doneInMs: number;
}

export interface VillageBuilding {
  id: BuildingId;
  level: number;
  /** How many characters can work in it at the same time. */
  slots: number;
  /** The characters working in it now. */
  jobs: VillageJob[];
}

/** The village page. */
export interface VillagePage {
  /** Whether the player has the village yet: they get it by winning Tessa's Lair. */
  unlocked: boolean;
  wood: number;
  stone: number;
  /** Upgrades can cost silver too. */
  silver: number;
  /** The player's buildings, in the order of BUILDING_IDS. Empty without a village. */
  buildings: VillageBuilding[];
  /** The buildings the player can still build, in the order of BUILDING_IDS. Empty without a village. */
  unbuilt: BuildingId[];
  /** All the player's characters, as on the character page, to choose who goes to work. */
  characters: CharacterSummary[];
}
