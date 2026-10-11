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
 * How many levels a character gained in a game while its XP gained went from
 * `xpGainedBefore` to `xpGainedAfter` (issue #154). From 0 to all it gained:
 * the levels of the whole game, for the result screen. Over one XP gain: the
 * levels of that kill, for the level-up arrow on the map.
 */
export function levelsGained(rank: number, maxXpGain: number, xpGainedBefore: number, xpGainedAfter: number): number {
  return levelInGame(rank, maxXpGain, xpGainedAfter) - levelInGame(rank, maxXpGain, xpGainedBefore);
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
 * How much the price of an adventurer drops each full day after buying one of
 * that rank: 10% of the price, so it is multiplied by 0.9 each day (issue
 * #202). Balance number: change it freely.
 */
export const ADVENTURER_PRICE_DROP_PER_DAY = 0.1;

export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The last purchase of a rank, as stored: what the next one cost right after
 * it (`nextPrice`), and when it was (`boughtAt`, milliseconds since 1970).
 */
export interface LastPurchase {
  nextPrice: number;
  boughtAt: number;
}

/**
 * What the next adventurer of a rank costs now (design.md, Getting more
 * characters). Never bought: its base price. Otherwise the price set by the
 * last purchase, 10% less for each full day since, but never below the base
 * price. Only purchases of that rank count, so rewards, rank-ups and buying
 * other ranks never change it.
 *
 * The drop is worked out from the stored price each time, not stored day by
 * day, so rounding never adds up. A server clock that went back in time
 * counts as 0 days: a price never goes up by waiting.
 */
export function adventurerPrice(rank: number, last: LastPurchase | undefined, now: number): number {
  const base = ADVENTURER_BASE_PRICES[rank]!;
  if (!last) return base;
  const days = Math.max(0, Math.floor((now - last.boughtAt) / DAY_MS));
  const dropped = Math.round(last.nextPrice * (1 - ADVENTURER_PRICE_DROP_PER_DAY) ** days);
  return Math.max(base, dropped);
}

/**
 * What the next adventurer of a rank costs right after buying one for
 * `paid`: one base price more. Waiting before buying lowers it, so waiting
 * pays off for the purchases after it too.
 */
export function nextAdventurerPrice(rank: number, paid: number): number {
  return paid + ADVENTURER_BASE_PRICES[rank]!;
}

/**
 * Whether a character can be used up for a rank-up (design.md, Class and
 * rank): it is at the max level of its rank, and there is a next rank. Two
 * of them with the same class and rank make one of the next rank.
 */
export function canRankUp(xp: number, rank: number): boolean {
  return rank < MAX_RANK && levelFromXp(xp, rank) === maxLevel(rank);
}
