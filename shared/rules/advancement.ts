// Classes, ranks and levels (design.md, Advancement). Shared so the server
// and the client work them out the same way.
//
// A character record stores only facts: its class, rank and total XP. The
// level and the max level follow from those (architecture.md, Characters).

export const CLASS_IDS = ["adventurer"] as const;
export type ClassId = (typeof CLASS_IDS)[number];

/** What the game shows for each class. */
export const CLASS_NAMES: Record<ClassId, string> = { adventurer: "Adventurer" };

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

/**
 * The level that a total XP gives, up to the max level of the rank. A
 * character never has more XP than its max level needs, but a balance change
 * to the XP curve could leave it with more; the level still stops there.
 */
export function levelFromXp(xp: number, rank: number): number {
  let level = 1;
  while (level < maxLevel(rank) && xp >= xpForLevel(level + 1)) level++;
  return level;
}

/**
 * The upgrade points earned up to a level (design.md, Upgrade points):
 * reaching level L gives L points, so 2 + 3 + ... + L in total. Level 1
 * has earned none, level 10 has earned 54.
 */
export function upgradePointsEarned(level: number): number {
  return (level * (level + 1)) / 2 - 1;
}

/** Silver per character the player already has (design.md, Getting more characters). */
export const ADVENTURER_PRICE_PER_CHARACTER = 10;

/** What a new level 1, rank 1 adventurer costs: 10 silver for every character the player has. */
export function adventurerPrice(characterCount: number): number {
  return ADVENTURER_PRICE_PER_CHARACTER * characterCount;
}
