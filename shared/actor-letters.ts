// The letters that tell characters and monsters apart in a game (design.md,
// Telling tokens apart; issue #374). Only for showing: the rules, the
// protocol and the server keep their numeric ids.
//
// All actors of a game share one sequence: the characters first, then the
// monsters. A–Z, then a–z, then numbers from 1.

import type { CharacterId, MonsterId } from "./rules/game-state.ts";

const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LOWER = UPPER.toLowerCase();

/** The letter at a place in the sequence, counted from 0: 0 is "A", 26 is "a", 52 is "1". */
export function letterAt(place: number): string {
  if (place < UPPER.length) return UPPER[place]!;
  if (place < UPPER.length + LOWER.length) return LOWER[place - UPPER.length]!;
  return String(place - UPPER.length - LOWER.length + 1);
}

/** Character ids are 1, 2, 3, ..., so character 1 is "A". */
export function characterLetter(id: CharacterId): string {
  return letterAt(id - 1);
}

/**
 * Monster ids are 0, 1, 2, ...; the first monster gets the letter after
 * the last character: with 3 characters, monster 0 is "D".
 */
export function monsterLetter(id: MonsterId, characterCount: number): string {
  return letterAt(characterCount + id);
}
