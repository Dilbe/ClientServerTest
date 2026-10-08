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
 * 5 × L XP, so reaching level L takes 5 × (1 + 2 + ... + (L − 1)) =
 * 2.5 × L × (L − 1) in total: 5 for level 2, 15 for level 3, 225 for level 10.
 * L × (L − 1) is always even, so this is always a whole number.
 */
export function xpForLevel(level: number): number {
  return (5 * level * (level - 1)) / 2;
}

/**
 * What the max level of this rank needs: a character gains no more XP from
 * there. A stored character can have more, from before the XP curve was
 * changed (issue #93); it keeps that XP, but its level stops at the max.
 */
export function maxXp(rank: number): number {
  return xpForLevel(maxLevel(rank));
}

/**
 * The level that a total XP gives, up to the max level of the rank. A
 * balance change to the XP curve can leave a character with more XP than its
 * max level needs (issue #93 did); the level still stops there.
 */
export function levelFromXp(xp: number, rank: number): number {
  let level = 1;
  while (level < maxLevel(rank) && xp >= xpForLevel(level + 1)) level++;
  return level;
}

/**
 * A character's level during a game (design.md, The details card). The game
 * state doesn't hold its XP, but it does hold how much it can still gain
 * (`maxXpGain`: what the max level needs, minus the XP it started with) and
 * how much it has gained. A character that started at or over its max level
 * has a `maxXpGain` of 0, and this gives its max level, as it should.
 */
export function levelInGame(rank: number, maxXpGain: number, xpGained: number): number {
  return levelFromXp(maxXp(rank) - maxXpGain + xpGained, rank);
}

/**
 * What a game did for a character's level, for the one-time hints on the
 * result screen (design.md, Rewards): whether it gained a level, and whether
 * it reached a max level from which it can rank up. Rank 5 can't rank up, so
 * reaching its max level doesn't count: the hint would tell the player to do
 * something they can't.
 */
export function progressInGame(
  rank: number,
  maxXpGain: number,
  xpGained: number,
): { levelledUp: boolean; reachedMaxLevel: boolean } {
  const before = levelInGame(rank, maxXpGain, 0);
  const after = levelInGame(rank, maxXpGain, xpGained);
  return {
    levelledUp: after > before,
    reachedMaxLevel: rank < MAX_RANK && after === maxLevel(rank) && before < after,
  };
}

/**
 * The upgrade points earned up to a level (design.md, Upgrade points):
 * reaching level L gives L points, so 2 + 3 + ... + L in total. Level 1
 * has earned none, level 10 has earned 54.
 */
export function upgradePointsEarned(level: number): number {
  return (level * (level + 1)) / 2 - 1;
}

/**
 * What the first adventurer of each rank costs, in silver (design.md,
 * Getting more characters). Balance numbers: change them freely.
 */
export const ADVENTURER_BASE_PRICES: Record<number, number> = { 1: 10, 2: 90, 3: 450, 4: 1000, 5: 2500 };

/**
 * What the next adventurer of a rank costs: its base price × (the number of
 * that rank the player has bought + 1). Only purchases of that rank count,
 * so rewards, rank-ups and buying other ranks never change it.
 */
export function adventurerPrice(rank: number, bought: number): number {
  return ADVENTURER_BASE_PRICES[rank]! * (bought + 1);
}

/**
 * Whether a character can be used up for a rank-up (design.md, Class and
 * rank): it is at the max level of its rank, and there is a next rank. Two
 * of them with the same class and rank make one of the next rank.
 */
export function canRankUp(xp: number, rank: number): boolean {
  return rank < MAX_RANK && levelFromXp(xp, rank) === maxLevel(rank);
}
