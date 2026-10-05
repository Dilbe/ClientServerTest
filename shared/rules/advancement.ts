// Classes, ranks and levels (design.md, Advancement). Shared so the server
// and the client work them out the same way.
//
// A character record stores only facts: its class, rank and total XP. The
// level and the max level follow from those (architecture.md, Characters).

export const CLASS_IDS = ["adventurer"] as const;
export type ClassId = (typeof CLASS_IDS)[number];

export const MIN_RANK = 1;
export const MAX_RANK = 5;

/** Max level = rank × 10 (design.md, Levels). */
export function maxLevel(rank: number): number {
  return rank * 10;
}

/**
 * The total XP needed to reach a level. Going from level L to L + 1 takes
 * 10 × L XP, so reaching level L takes 10 × (1 + 2 + ... + (L − 1)) =
 * 5 × L × (L − 1) in total: 10 for level 2, 30 for level 3, 450 for level 10.
 */
export function xpForLevel(level: number): number {
  return 5 * level * (level - 1);
}

/** The most XP a character of this rank can have: what its max level needs. */
export function maxXp(rank: number): number {
  return xpForLevel(maxLevel(rank));
}
