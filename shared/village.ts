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
});
export type StartJobRequest = z.infer<typeof startJobRequest>;

/** Takes one of the player's characters out of its building before its job is done. */
export const takeOutRequest = z.object({
  number: z.number().int().positive(),
});
export type TakeOutRequest = z.infer<typeof takeOutRequest>;

/** A character at work, as the village page shows it. */
export interface VillageJob {
  /** The character's number within the account. */
  number: number;
  /** What it earns per full hour, as stored when the job started. */
  perHour: number;
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
  /** The player's buildings, in the order of BUILDING_IDS. Empty without a village. */
  buildings: VillageBuilding[];
  /** All the player's characters, as on the character page, to choose who goes to work. */
  characters: CharacterSummary[];
}
