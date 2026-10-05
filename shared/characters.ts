// The shapes of the character page's requests and answers. Shared so client
// and server agree on them.
//
// A character is sent as the facts the server stores (class, rank, XP). The
// client works out the level, stats and upgrade points with the same shared
// rules the server uses (shared/rules/advancement.ts).

import type { ClassId } from "./rules/advancement.ts";

export interface CharacterSummary {
  /** The number within the account: 1, 2, 3, ... */
  number: number;
  class: ClassId;
  rank: number;
  /** The total XP. */
  xp: number;
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
