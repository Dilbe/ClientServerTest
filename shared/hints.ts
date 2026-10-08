// One-time hints that explain the game to new players (design.md, Rewards).
// Which ones a player has seen is stored on their account, so each shows only
// once per player, on every device (architecture.md, What is stored where).

import { z } from "zod";

/**
 * The hints there are. These ids are stored in the database, so they may
 * never change once in use; a new hint gets a new id.
 */
export const HINT_IDS = ["levelUp", "maxLevel"] as const;
export type HintId = (typeof HINT_IDS)[number];

/** What each hint says. */
export const HINT_TEXTS: Record<HintId, string> = {
  levelUp:
    "Your character levelled up! Each level gives upgrade points, which you can spend on stats on the character page.",
  maxLevel:
    "Your character reached its max level and can't gain more XP. To keep progressing, rank it up on the character " +
    "page by combining it with another adventurer of the same rank that is also at max level.",
};

/**
 * Marking a hint as seen. Only known ids pass, so a client can't store
 * anything else on the account through this request.
 */
export const hintSeenRequest = z.object({ hint: z.enum(HINT_IDS) });
export type HintSeenRequest = z.infer<typeof hintSeenRequest>;
