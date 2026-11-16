// Classes, ranks and levels (design.md, Advancement). Shared so the server
// and the client work them out the same way.
//
// A character record stores only facts: its class, rank and total XP. The
// level and the max level follow from those (architecture.md, Characters).

import { CLASSES, type ClassId } from "./classes.ts";

/** The lowest and the highest rank of any class: adventurers have 1 to 5, advanced classes 6 to 10. */
export const MIN_RANK = 1;
export const MAX_RANK = 10;

/** The lowest rank of a class: 1 for an adventurer, 6 for an advanced class. */
export function minRank(classId: ClassId): number {
  return CLASSES[classId].minRank;
}

/** The highest rank of a class: 5 for an adventurer, 10 for an advanced class. */
export function maxRank(classId: ClassId): number {
  return CLASSES[classId].maxRank;
}

/** The highest rank an adventurer can have, and be bought at: 5. */
export const MAX_ADVENTURER_RANK = CLASSES.adventurer.maxRank;

/** Whether a character of this class can have this rank. */
export function isRankOf(classId: ClassId, rank: number): boolean {
  return Number.isInteger(rank) && rank >= minRank(classId) && rank <= maxRank(classId);
}

/**
 * Which step a rank is within its class: 1 for the lowest rank of the class
 * (rank 1 for an adventurer, rank 6 for an advanced class), 5 for the
 * highest. The max level and the token art go by it.
 */
export function rankStep(classId: ClassId, rank: number): number {
  return rank - minRank(classId) + 1;
}

/**
 * Max level = rank × 10 for an adventurer (design.md, Levels), 10 per rank
 * step + 10 for an advanced class (design.md, Advanced classes): 20 at rank
 * 6, up to 60 at rank 10.
 */
export function maxLevel(classId: ClassId, rank: number): number {
  return rankStep(classId, rank) * 10 + CLASSES[classId].extraMaxLevels;
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
export function maxXp(classId: ClassId, rank: number): number {
  return xpForLevel(maxLevel(classId, rank));
}

/**
 * The level that a total XP gives, up to the max level of the rank. A
 * balance change to the XP curve can leave a character with more XP than its
 * max level needs (issue #93 did); the level still stops there.
 */
export function levelFromXp(xp: number, classId: ClassId, rank: number): number {
  let level = 1;
  while (level < maxLevel(classId, rank) && xp >= xpForLevel(level + 1)) level++;
  return level;
}

/**
 * A character's level during a game (design.md, The details card). The game
 * state doesn't hold its XP, but it does hold how much it can still gain
 * (`maxXpGain`: what the max level needs, minus the XP it started with) and
 * how much it has gained. A character that started at or over its max level
 * has a `maxXpGain` of 0, and this gives its max level, as it should.
 */
export function levelInGame(classId: ClassId, rank: number, maxXpGain: number, xpGained: number): number {
  return levelFromXp(maxXp(classId, rank) - maxXpGain + xpGained, classId, rank);
}

/**
 * How many levels a character gained in a game while its XP gained went from
 * `xpGainedBefore` to `xpGainedAfter` (issue #154). From 0 to all it gained:
 * the levels of the whole game, for the result screen. Over one XP gain: the
 * levels of that kill, for the level-up arrow on the map.
 */
export function levelsGained(
  classId: ClassId,
  rank: number,
  maxXpGain: number,
  xpGainedBefore: number,
  xpGainedAfter: number,
): number {
  return levelInGame(classId, rank, maxXpGain, xpGainedAfter) - levelInGame(classId, rank, maxXpGain, xpGainedBefore);
}

/**
 * What a game did for a character's level, for the one-time hints on the
 * result screen (design.md, Rewards): whether it gained a level, and whether
 * it reached a max level from which it can rank up. The highest rank of a
 * class (5 or 10) can't rank up, so reaching its max level doesn't count:
 * the hint would tell the player to do something they can't.
 */
export function progressInGame(
  classId: ClassId,
  rank: number,
  maxXpGain: number,
  xpGained: number,
): { levelledUp: boolean; reachedMaxLevel: boolean } {
  const before = levelInGame(classId, rank, maxXpGain, 0);
  const after = levelInGame(classId, rank, maxXpGain, xpGained);
  return {
    levelledUp: after > before,
    reachedMaxLevel: rank < maxRank(classId) && after === maxLevel(classId, rank) && before < after,
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
 * The stored price of a rank: what the next one cost right after the last
 * purchase (`nextPrice`), and when it was (`boughtAt`, milliseconds since
 * 1970). A hero finishing its job in the trading post sets both too (see
 * `tradingPostLowered` in village.ts).
 */
export interface LastPurchase {
  nextPrice: number;
  boughtAt: number;
  /**
   * Whether the trading post set `nextPrice` last, after the last purchase.
   * Only then may the price stay below the base price (design.md, The
   * trading post). Left out: no.
   */
  lowered?: boolean;
}

/**
 * What the next adventurer of a rank costs now (design.md, Getting more
 * characters). Never bought: its base price. Otherwise the price set by the
 * last purchase, 10% less for each full day since, but never below the base
 * price. Only purchases of that rank count, so rewards, rank-ups and buying
 * other ranks never change it; the trading post does (issue #339).
 *
 * A price the trading post took below the base price stays there: the drop
 * stops at the base price or at that price, whichever is lower. Only when
 * `lowered` is set, so a stored price below a base price that went up later
 * (a balance change) doesn't become a discount.
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
  const lowest = last.lowered ? Math.min(base, last.nextPrice) : base;
  return Math.max(lowest, dropped);
}

/**
 * What the next adventurer of a rank costs right after buying one for
 * `paid`: one base price more. Waiting before buying lowers it, so waiting
 * pays off for the purchases after it too.
 */
export function nextAdventurerPrice(rank: number, paid: number): number {
  return paid + ADVENTURER_BASE_PRICES[rank]!;
}

/** What the rank-up rules need to know of a character: its class, rank and total XP. */
export interface Hero {
  class: ClassId;
  rank: number;
  xp: number;
}

/** Whether a character is at the max level of its rank, and so gains no more XP. */
export function isAtMaxLevel(hero: Hero): boolean {
  return levelFromXp(hero.xp, hero.class, hero.rank) === maxLevel(hero.class, hero.rank);
}

/**
 * The class and rank of the extra character that a character of this class
 * and rank uses up to rank up (design.md, Class and rank; issue #406), or
 * undefined at the highest rank of its class (5 or 10), which can't rank up.
 *
 * - Normally one of the same class and one rank lower: a rank 3 adventurer
 *   ranks up with a rank 2 adventurer, a rank 8 tank with a rank 7 tank.
 * - Rank 1 has no rank below it: a rank 1 adventurer ranks up with another
 *   rank 1 adventurer.
 * - The lowest rank of an advanced class (6) has no rank of its own class
 *   below it: it ranks up with a rank 5 adventurer, the rank it was made from.
 */
export function rankUpExtra(classId: ClassId, rank: number): { class: ClassId; rank: number } | undefined {
  if (rank >= maxRank(classId)) return undefined;
  if (rank > minRank(classId)) return { class: classId, rank: rank - 1 };
  if (classId === "adventurer") return { class: "adventurer", rank };
  return { class: "adventurer", rank: MAX_ADVENTURER_RANK };
}

/**
 * Whether `hero` has the class and rank to rank up by using up `extra`
 * (see `rankUpExtra`). It doesn't look at their levels: see `canRankUpWith`.
 */
export function fitsRankUp(hero: Omit<Hero, "xp">, extra: Omit<Hero, "xp">): boolean {
  const needed = rankUpExtra(hero.class, hero.rank);
  return needed !== undefined && needed.class === extra.class && needed.rank === extra.rank;
}

/**
 * Whether `hero` can rank up by using up `extra` (design.md, Class and
 * rank): the class and rank fit (see `rankUpExtra`), and both are at their
 * max level. The two make one character of the class of `hero` and one rank
 * higher.
 */
export function canRankUpWith(hero: Hero, extra: Hero): boolean {
  return fitsRankUp(hero, extra) && isAtMaxLevel(hero) && isAtMaxLevel(extra);
}

/**
 * The extra adventurer that making an advanced class uses up, besides the
 * rank 5 adventurer it is made from (design.md, Advanced classes; issue
 * #406): a rank 4 adventurer, one rank lower, the same as for a rank-up.
 */
export const ADVANCED_CLASS_EXTRA_RANK = MAX_ADVENTURER_RANK - 1;

/**
 * Whether `hero` and `extra` have the class and rank to make an advanced
 * class: a rank 5 adventurer and a rank 4 adventurer. It doesn't look at
 * their levels: see `canMakeAdvancedClassWith`.
 */
export function fitsAdvancedClass(hero: Omit<Hero, "xp">, extra: Omit<Hero, "xp">): boolean {
  return (
    hero.class === "adventurer" &&
    hero.rank === MAX_ADVENTURER_RANK &&
    extra.class === "adventurer" &&
    extra.rank === ADVANCED_CLASS_EXTRA_RANK
  );
}

/**
 * Whether `hero` can make an advanced class by using up `extra` (design.md,
 * Advanced classes): a rank 5 and a rank 4 adventurer, both at their max
 * level. The two make one rank 6 character of the class the player picks.
 */
export function canMakeAdvancedClassWith(hero: Hero, extra: Hero): boolean {
  return fitsAdvancedClass(hero, extra) && isAtMaxLevel(hero) && isAtMaxLevel(extra);
}
