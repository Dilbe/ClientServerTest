// The shapes of the character page's requests and answers. Shared so client
// and server agree on them.
//
// A character is sent as the facts the server stores (class, rank, XP and
// upgrades). The client works out the level, stats and upgrade points with
// the same shared rules the server uses (shared/rules).

import { z } from "zod";
import { CLASS_NAMES, type ClassId } from "./rules/advancement.ts";
import { STAT_IDS } from "./rules/stats.ts";
import type { Upgrade } from "./rules/upgrades.ts";

export const CHARACTER_NAME_RULES = "1 to 20 characters: letters a-z, digits, spaces, '_' or '-'.";

/**
 * A name the player gives a character (design.md, Characters). Other players
 * in a game see it, so it follows the same rules as display names: plain
 * ASCII only, no spaces at the start or end, no double spaces. Unlike display
 * names, it doesn't have to be unique.
 */
export const characterName = z
  .string()
  .regex(/^[A-Za-z0-9_-]+( [A-Za-z0-9_-]+)*$/, CHARACTER_NAME_RULES)
  .max(20, CHARACTER_NAME_RULES);

/**
 * The name a character goes by: the one the player chose, or else
 * "<class> <number>", like "Adventurer 1". The default isn't stored, so it
 * follows the class if that ever changes.
 */
export function nameOfCharacter(character: { name?: string | null; class: ClassId; number: number }): string {
  return character.name ?? `${CLASS_NAMES[character.class]} ${character.number}`;
}

/** Renames one of the player's characters; `null` goes back to the default name. */
export const renameCharacterRequest = z.object({
  number: z.number().int().positive(),
  name: characterName.nullable(),
});
export type RenameCharacterRequest = z.infer<typeof renameCharacterRequest>;

/**
 * Upgrades one stat of one of the player's characters by 1. It names only
 * what to upgrade, never the cost: the server works that out itself.
 */
export const upgradeStatRequest = z.object({
  number: z.number().int().positive(),
  stat: z.enum(STAT_IDS),
});
export type UpgradeStatRequest = z.infer<typeof upgradeStatRequest>;

/** Resets all upgrades of one of the player's characters, at the cost of a level. */
export const resetUpgradesRequest = z.object({
  number: z.number().int().positive(),
});
export type ResetUpgradesRequest = z.infer<typeof resetUpgradesRequest>;

/**
 * Uses up two of the player's characters to make one of the next rank. It
 * names only which two: the server checks they can rank up together.
 */
export const rankUpRequest = z
  .object({
    first: z.number().int().positive(),
    second: z.number().int().positive(),
  })
  .refine((request) => request.first !== request.second, "Choose two different characters.");
export type RankUpRequest = z.infer<typeof rankUpRequest>;

export interface CharacterSummary {
  /** The number within the account: 1, 2, 3, ... */
  number: number;
  /** The name the player chose, or `null` for the default (see `nameOfCharacter`). */
  name: string | null;
  class: ClassId;
  rank: number;
  /** The total XP. */
  xp: number;
  /** Every stat upgrade bought, with what was paid for it. */
  upgrades: Upgrade[];
}

/** The character page: the player's characters and what buying one costs. */
export interface CharactersPage {
  characters: CharacterSummary[];
  silver: number;
  /** What the next adventurer costs. The server works it out again when buying. */
  adventurerPrice: number;
  /** Characters can't be bought or changed while the account is in a game, open or running. */
  inGame: boolean;
}
