// The shapes of the character page's requests and answers. Shared so client
// and server agree on them.
//
// A character is sent as the facts the server stores (class, rank, XP and
// upgrades). The client works out the level, stats and upgrade points with
// the same shared rules the server uses (shared/rules).

import { z } from "zod";
import { ABILITY_IDS, ABILITY_UPGRADE_IDS } from "./rules/abilities.ts";
import { MAX_RANK, MIN_RANK } from "./rules/advancement.ts";
import { ADVANCED_CLASS_IDS, CLASS_NAMES, type ClassId } from "./rules/classes.ts";
import { UPGRADABLE_STAT_IDS } from "./rules/stats.ts";
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

/**
 * Buys an adventurer of a rank. It names only the rank, never the price: the
 * server works that out itself. Only whole numbers from 1 to 5 pass.
 */
export const buyAdventurerRequest = z.object({
  rank: z.number().int().min(MIN_RANK).max(MAX_RANK),
});
export type BuyAdventurerRequest = z.infer<typeof buyAdventurerRequest>;

/** Renames one of the player's characters; `null` goes back to the default name. */
export const renameCharacterRequest = z.object({
  number: z.number().int().positive(),
  name: characterName.nullable(),
});
export type RenameCharacterRequest = z.infer<typeof renameCharacterRequest>;

/**
 * Upgrades one stat of one of the player's characters by 1. It names only
 * what to upgrade, never the cost: the server works that out itself. Only
 * upgradable stats pass: the client doesn't offer the others, but anyone can
 * send any request, so the server refuses them here.
 */
export const upgradeStatRequest = z.object({
  number: z.number().int().positive(),
  stat: z.enum(UPGRADABLE_STAT_IDS),
});
export type UpgradeStatRequest = z.infer<typeof upgradeStatRequest>;

/**
 * Upgrades one ability of one of the player's characters once (design.md,
 * Ability upgrades). Like upgrading a stat, it names only what to upgrade:
 * the server works out the cost and checks that the character has the
 * ability and can still upgrade it that way.
 */
export const upgradeAbilityRequest = z.object({
  number: z.number().int().positive(),
  ability: z.enum(ABILITY_IDS),
  upgrade: z.enum(ABILITY_UPGRADE_IDS),
});
export type UpgradeAbilityRequest = z.infer<typeof upgradeAbilityRequest>;

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

/**
 * Uses up two of the player's rank 5 adventurers to make one rank 1
 * character of an advanced class (design.md, Advanced classes). It names
 * the two and the class the player picked; only the four advanced classes
 * pass. The server checks that the two may be combined.
 */
export const advancedClassRequest = z
  .object({
    first: z.number().int().positive(),
    second: z.number().int().positive(),
    class: z.enum(ADVANCED_CLASS_IDS),
  })
  .refine((request) => request.first !== request.second, "Choose two different characters.");
export type AdvancedClassRequest = z.infer<typeof advancedClassRequest>;

export interface CharacterSummary {
  /** The number within the account: 1, 2, 3, ... */
  number: number;
  /** The name the player chose, or `null` for the default (see `nameOfCharacter`). */
  name: string | null;
  class: ClassId;
  rank: number;
  /** The total XP. In a running game, with the XP gained there so far (issue #153). */
  xp: number;
  /**
   * Every stat and ability upgrade bought, with what was paid for it. In a
   * running game, with the upgrades bought there so far (issue #153).
   */
  upgrades: Upgrade[];
  /** Its rest, as in the lobby (`yourCharacters` in protocol.ts): milliseconds from when the server answered. */
  healedInMs: number;
  readyInMs: number;
  /** Whether it is in a game, as in the lobby (`yourCharacters` in protocol.ts). */
  inGame: boolean;
  /**
   * Whether it is in a game that has started and not ended yet, also one
   * its player left. It can then only be upgraded: not renamed, reset or
   * ranked up (issue #153).
   */
  inRunningGame: boolean;
}

/** The character page: the player's characters and what buying one of each rank costs. */
export interface CharactersPage {
  characters: CharacterSummary[];
  silver: number;
  /** What the next adventurer of each rank costs, rank 1 first. The server works it out again when buying. */
  adventurerPrices: { rank: number; price: number }[];
}
