// The village (design.md, The village; issue #295). Shared so the server and
// the client agree on what a job takes and gives.

import {
  ADVENTURER_BASE_PRICES,
  adventurerPrice,
  DAY_MS,
  type LastPurchase,
} from "./advancement.ts";
import type { ClassId } from "./classes.ts";
//
// Times here are wall-clock times, like the rests in rest.ts: a job goes on
// while the server is down, like real time does.

/**
 * The fixed id of every building. The database stores each account's
 * buildings and jobs by these ids, so **an id must never change or be reused
 * once it is in use**; rename the building's `name` instead.
 */
export const BUILDING_IDS = ["woodcutter", "quarry", "trainingHouse", "medicalBay", "tavern", "pub", "market", "tradingPost", "recruitingOffice"] as const;
export type BuildingId = (typeof BUILDING_IDS)[number];

/** The resources the village brings. Stored on the account, like silver. */
export const RESOURCE_IDS = ["wood", "stone"] as const;
export type ResourceId = (typeof RESOURCE_IDS)[number];

/** An amount of each resource, like the wood and stone a dungeon win gives (issue #323). */
export type Resources = Record<ResourceId, number>;

/** What something in the village costs: the account's wood, stone and silver. */
export interface Cost {
  wood: number;
  stone: number;
  silver: number;
}

export interface Building {
  name: string;
  /**
   * What a job in it earns: a resource for the account, XP for the
   * character (the training house), or nothing (the medical bay and the
   * tavern, which speed up `speedsUp` instead).
   */
  earns: ResourceId | "xp" | null;
  /** What the hero in it speeds up for all the account's characters (issue #298), or null. */
  speedsUp: "healing" | "resting" | null;
  /**
   * How many characters can work in it at the same time, at a building level.
   * The training house's trainer slot comes on top of these.
   */
  slots: (level: number) => number;
  /** Whether it has a trainer slot (design.md, The training house). */
  trainerSlot: boolean;
  /**
   * Whether a character in it cuts another character's rest, the pub's job
   * (design.md, The pub; issue #299). Its characters can't be taken out early.
   */
  cutsRest: boolean;
  /**
   * Whether a character in it sells wood or stone for silver, the market's
   * job (design.md, The market; issue #324). Its `earns` is null: the silver
   * is only paid when the job runs its full length.
   */
  sellsResources: boolean;
  /**
   * Whether the hero in it lowers the price of buying an adventurer, the
   * trading post's job (design.md, The trading post; issue #325). Like the
   * medical bay, it earns nothing.
   */
  lowersHeroPrices: boolean;
  /**
   * Whether a hero in it recruits new rank 1 adventurers when its job is
   * done, the recruiting office's job (design.md, The recruiting office;
   * issue #358). Like the trading post, it earns nothing itself, and only a
   * full job counts.
   */
  recruits: boolean;
  /**
   * What building it costs (issue #297), or null for a building the village
   * starts with. Building it gives level 1.
   */
  buildCost: Cost | null;
  /**
   * What each upgrade costs (issue #296): the first entry takes it from
   * level 1 to 2, the next from 2 to 3, and so on. The last entry gives its
   * max level, so a longer list is a higher max level.
   */
  upgradeCosts: readonly Cost[];
}

/**
 * Every building, in the order the village page shows them. Balance numbers:
 * change them freely. The woodcutter and the quarry are upgraded mostly
 * with the other one's resource, so neither can be built up alone.
 */
export const BUILDINGS: Record<BuildingId, Building> = {
  woodcutter: {
    name: "Woodcutter",
    earns: "wood",
    slots: (level) => level,
    speedsUp: null,
    trainerSlot: false,
    cutsRest: false,
    sellsResources: false,
    lowersHeroPrices: false,
    recruits: false,
    buildCost: null,
    upgradeCosts: [
      { wood: 0, stone: 25, silver: 0 },
      { wood: 40, stone: 100, silver: 25 },
      { wood: 100, stone: 300, silver: 75 },
      { wood: 500, stone: 1000, silver: 150 },
    ],
  },
  quarry: {
    name: "Quarry",
    earns: "stone",
    slots: (level) => level,
    speedsUp: null,
    trainerSlot: false,
    cutsRest: false,
    sellsResources: false,
    lowersHeroPrices: false,
    recruits: false,
    buildCost: null,
    upgradeCosts: [
      { wood: 25, stone: 0, silver: 0 },
      { wood: 100, stone: 40, silver: 25 },
      { wood: 300, stone: 100, silver: 75 },
      { wood: 1000, stone: 500, silver: 150 },
    ],
  },
  // About what the woodcutter's levels 2 to 5 cost, split between wood and stone.
  trainingHouse: {
    name: "Training house",
    earns: "xp",
    slots: (level) => level,
    speedsUp: null,
    trainerSlot: true,
    cutsRest: false,
    sellsResources: false,
    lowersHeroPrices: false,
    recruits: false,
    buildCost: { wood: 15, stone: 15, silver: 0 },
    upgradeCosts: [
      { wood: 70, stone: 70, silver: 25 },
      { wood: 200, stone: 200, silver: 75 },
      { wood: 750, stone: 750, silver: 150 },
    ],
  },
  // One slot each, and no upgrades (issue #298). The medical bay costs
  // mostly stone, the tavern mostly wood.
  medicalBay: {
    name: "Medical bay",
    earns: null,
    speedsUp: "healing",
    slots: () => 1,
    trainerSlot: false,
    cutsRest: false,
    sellsResources: false,
    lowersHeroPrices: false,
    recruits: false,
    buildCost: { wood: 500, stone: 1000, silver: 250 },
    upgradeCosts: [],
  },
  tavern: {
    name: "Tavern",
    earns: null,
    speedsUp: "resting",
    slots: () => 1,
    trainerSlot: false,
    cutsRest: false,
    sellsResources: false,
    lowersHeroPrices: false,
    recruits: false,
    buildCost: { wood: 1000, stone: 500, silver: 250 },
    upgradeCosts: [],
  },
  // Each level one more slot (issue #299).
  pub: {
    name: "Pub",
    earns: null,
    speedsUp: null,
    slots: (level) => level,
    trainerSlot: false,
    cutsRest: true,
    sellsResources: false,
    lowersHeroPrices: false,
    recruits: false,
    buildCost: { wood: 100, stone: 100, silver: 50 },
    upgradeCosts: [
      { wood: 300, stone: 300, silver: 100 },
      { wood: 750, stone: 750, silver: 150 },
      { wood: 1500, stone: 1500, silver: 250 },
    ],
  },
  // Each level one more slot, and the same costs as the pub (issue #324).
  market: {
    name: "Market",
    earns: null,
    speedsUp: null,
    slots: (level) => level,
    trainerSlot: false,
    cutsRest: false,
    sellsResources: true,
    lowersHeroPrices: false,
    recruits: false,
    buildCost: { wood: 100, stone: 100, silver: 50 },
    upgradeCosts: [
      { wood: 300, stone: 300, silver: 100 },
      { wood: 750, stone: 750, silver: 150 },
      { wood: 1500, stone: 1500, silver: 250 },
    ],
  },
  // Each level one more slot, and the pub's upgrade costs (issue #339).
  tradingPost: {
    name: "Trading post",
    earns: null,
    speedsUp: null,
    slots: (level) => level,
    trainerSlot: false,
    cutsRest: false,
    sellsResources: false,
    lowersHeroPrices: true,
    recruits: false,
    buildCost: { wood: 150, stone: 150, silver: 50 },
    upgradeCosts: [
      { wood: 300, stone: 300, silver: 100 },
      { wood: 750, stone: 750, silver: 150 },
      { wood: 1500, stone: 1500, silver: 250 },
    ],
  },
  // Each level one more slot (issue #358).
  recruitingOffice: {
    name: "Recruiting office",
    earns: null,
    speedsUp: null,
    slots: (level) => level,
    trainerSlot: false,
    cutsRest: false,
    sellsResources: false,
    lowersHeroPrices: false,
    recruits: true,
    buildCost: { wood: 125, stone: 75, silver: 50 },
    upgradeCosts: [
      { wood: 400, stone: 200, silver: 100 },
      { wood: 1000, stone: 500, silver: 150 },
      { wood: 2000, stone: 1000, silver: 250 },
    ],
  },
};

/** The highest level a building can reach. */
export function maxBuildingLevel(building: BuildingId): number {
  return BUILDINGS[building].upgradeCosts.length + 1;
}

/** What upgrading a building from `level` to the next level costs, or null at its max level. */
export function upgradeCost(building: BuildingId, level: number): Cost | null {
  return BUILDINGS[building].upgradeCosts[level - 1] ?? null;
}

/** Whether these resources pay for this cost. */
export function canPay(have: Cost, cost: Cost): boolean {
  return have.wood >= cost.wood && have.stone >= cost.stone && have.silver >= cost.silver;
}

/** A cost as the village page writes it, for example "40 wood, 100 stone, 25 silver". */
export function costText(cost: Cost): string {
  const parts = (["wood", "stone", "silver"] as const).filter((key) => cost[key] > 0).map((key) => `${cost[key]} ${key}`);
  return parts.length > 0 ? parts.join(", ") : "nothing";
}

/** The buildings a player has as soon as they get the village, at level 1. */
export const STARTING_BUILDINGS: readonly BuildingId[] = ["woodcutter", "quarry"];

export const HOUR_MS = 60 * 60_000;

/**
 * How long a job lasts. Balance numbers: 1 hour per level of the character
 * in the woodcutter, the quarry, the medical bay and the tavern, and for the
 * training house's trainer; 30 minutes per level in the trading post
 * (`TRADING_POST_JOB_MS_PER_LEVEL`, issue #353); 7 days ÷ the level in the
 * recruiting office (`RECRUITING_JOB_MS`, issue #358); 24 hours for a trainee, or
 * less when it reaches its max level first (see `trainingEnd`). Not for the
 * pub, where it is the rest it cut (see `restCutMs`), nor for the market
 * (see `marketJobMs`).
 */
export function jobLengthMs(building: BuildingId, characterLevel: number, asTrainer = false): number {
  if (BUILDINGS[building].earns === "xp" && !asTrainer) return TRAINING_JOB_MS;
  if (BUILDINGS[building].lowersHeroPrices) return characterLevel * TRADING_POST_JOB_MS_PER_LEVEL;
  // Rounded to whole milliseconds: 7 days ÷ 11 isn't a whole number of them.
  if (BUILDINGS[building].recruits) return Math.round(RECRUITING_JOB_MS / Math.max(1, characterLevel));
  return characterLevel * HOUR_MS;
}

/**
 * What a job in the woodcutter or the quarry earns per full hour: 1 per
 * rank of the character (issue #328; an advanced class has rank 6 to 10),
 * plus its class bonus in this building (issue #300). A balance number.
 */
export function earnedPerHour(worker: Trainable, building: BuildingId): number {
  return withClassBonus(worker.rank, worker, building);
}

/**
 * What a job earned from `startedAt` until `until`: only full hours count,
 * so a character taken out early keeps what it earned in the hours it
 * finished (design.md, The buildings).
 */
export function earned(perHour: number, startedAt: number, until: number): number {
  return Math.floor(Math.max(0, until - startedAt) / HOUR_MS) * perHour;
}

// ---- Class bonuses (design.md, Class bonuses; issue #300) ----

/**
 * The bonus some classes get in one building, in percent of what a hero
 * gives there: the wood or stone an hour, or the speed-up of the medical bay
 * or the trainer. Only the trainer in the training house gets it, not a
 * trainee. Balance numbers: a class or building that isn't here gets no
 * bonus.
 */
export const CLASS_BONUSES: Partial<Record<ClassId, Partial<Record<BuildingId, number>>>> = {
  tank: { quarry: 50 },
  ranger: { woodcutter: 50 },
  healer: { medicalBay: 50 },
  caster: { trainingHouse: 50 },
};

/** The bonus in percent a character's class gets in a building, or 0. */
export function classBonusPercent(character: Trainable, building: BuildingId): number {
  return CLASS_BONUSES[character.class]?.[building] ?? 0;
}

/**
 * `amount` with the character's class bonus in this building, rounded up in
 * the player's favour so the numbers stay whole: a rank 7 tank in
 * the quarry earns 7 + 50% = 10.5, so 11 stone an hour.
 */
export function withClassBonus(amount: number, character: Trainable, building: BuildingId): number {
  return Math.ceil((amount * (100 + classBonusPercent(character, building))) / 100);
}

// ---- The training house (design.md, The training house; issue #297) ----

/** How long a trainee's job lasts. The trainer's lasts 1 hour per level (see `jobLengthMs`). */
export const TRAINING_JOB_MS = 24 * HOUR_MS;

/** The XP a trainee gains per hour without a trainer. A balance number. */
export const TRAINING_XP_PER_HOUR = 10;

/** What a character is, as far as training goes. */
export interface Trainable {
  class: ClassId;
  rank: number;
}

/**
 * How much faster a trainer makes a trainee train: +100% per rank of
 * difference, so ×1 without a trainer or when the trainer isn't higher. An
 * advanced class trainee is only sped up by its own class; an adventurer by
 * any class.
 */
export function trainingSpeed(trainer: Trainable | null, trainee: Trainable): number {
  if (!trainer) return 1;
  if (trainee.class !== "adventurer" && trainer.class !== trainee.class) return 1;
  // The class bonus (issue #300) makes only the speed-up bigger, not the ×1.
  return 1 + withClassBonus(Math.max(0, trainer.rank - trainee.rank), trainer, "trainingHouse");
}

/** The XP a trainee gains per hour with this trainer, or none. */
export function trainingXpPerHour(trainer: Trainable | null, trainee: Trainable): number {
  return TRAINING_XP_PER_HOUR * trainingSpeed(trainer, trainee);
}

/**
 * The bonus XP a trainer gave in a stretch of time from `from` until
 * `until`, at `perHour` on top of the normal speed (design.md, The training
 * house). A stretch that ended by time, because a job ran out, counts as
 * exactly as possible, rounded up. One that ended because the player took
 * the trainer or the trainee out counts only its full hours.
 */
export function bonusXp(perHour: number, from: number, until: number, fullHoursOnly: boolean): number {
  const ms = Math.max(0, until - from);
  return fullHoursOnly ? Math.floor(ms / HOUR_MS) * perHour : Math.ceil((ms * perHour) / HOUR_MS);
}

/** Where a trainee's job stands: what `trainingEnd` needs to know about it. */
export interface TrainingProgress {
  /** When the job started: the normal 10 XP an hour count full hours from here. */
  startedAt: number;
  /** Since when the trainer bonus in `perHour` counts. */
  countedFrom: number;
  /** The trainer bonus XP of the time before `countedFrom`. */
  credited: number;
  /** The XP per hour now, the normal 10 plus the trainer's bonus. */
  perHour: number;
}

/**
 * When a trainee's job ends (design.md, The training house; issue #321): at
 * the first moment it has earned `xpNeeded`, the XP its max level still
 * needs, but never after `latest`, the end of its 24 hours. Earned as at
 * the end of a job: 10 XP for each full hour, plus the trainer bonus
 * counted exactly, rounded up (see `bonusXp`). It assumes the speed stays
 * as it is, so it is worked out again whenever a trainer comes or goes.
 *
 * The normal XP only goes up on the hour, so it looks hour by hour: within
 * one hour the normal XP is fixed, and only the bonus grows.
 */
export function trainingEnd(job: TrainingProgress, xpNeeded: number, latest: number): number {
  const bonusPerHour = job.perHour - TRAINING_XP_PER_HOUR;
  let hour = Math.floor((job.countedFrom - job.startedAt) / HOUR_MS);
  for (;;) {
    const hourStart = Math.max(job.countedFrom, job.startedAt + hour * HOUR_MS);
    const hourEnd = job.startedAt + (hour + 1) * HOUR_MS;
    if (hourStart >= latest) return latest;
    // What the bonus must still give in this hour.
    const fromBonus = xpNeeded - job.credited - hour * TRAINING_XP_PER_HOUR;
    if (fromBonus <= 0) return Math.min(hourStart, latest);
    if (bonusPerHour > 0) {
      // The bonus after `ms` is ceil(ms × bonusPerHour / HOUR_MS). It
      // reaches `fromBonus` at the first whole ms where
      // ms × bonusPerHour > (fromBonus − 1) × HOUR_MS.
      const ms = Math.floor(((fromBonus - 1) * HOUR_MS) / bonusPerHour) + 1;
      if (job.countedFrom + ms < hourEnd) return Math.min(Math.max(hourStart, job.countedFrom + ms), latest);
    }
    hour++;
  }
}

// ---- The medical bay and the tavern (design.md, The medical bay and the tavern; issue #298) ----

/**
 * How much faster the hero in the medical bay or the tavern makes healing or
 * resting: +100% per rank, so a rank 1 adventurer gives ×2 and a rank 6
 * tank ×7. Its class bonus in this building (issue #300)
 * makes the speed-up bigger: a rank 6 healer in the medical bay gives ×10.
 * A balance number.
 */
export function restSpeed(hero: Trainable, building: BuildingId): number {
  return 1 + withClassBonus(hero.rank, hero, building);
}

// ---- The pub (design.md, The pub; issue #299) ----

/**
 * How much of a rest a character in the pub cuts, in milliseconds: its
 * level × its rank, in minutes, but never more than the rest
 * has left (`restLeftMs`). It stays in the pub just as long. A balance
 * number.
 */
export function restCutMs(drinker: Trainable, drinkerLevel: number, restLeftMs: number): number {
  return Math.max(0, Math.min(drinkerLevel * drinker.rank * 60_000, restLeftMs));
}

// ---- The market (design.md, The market; issue #324) ----

/** How much wood or stone a character sells in the market: 1 per level. A balance number. */
export function marketAmount(level: number): number {
  return level;
}

/**
 * The silver a sale gives once the job has run its full length: 1 per
 * resource per rank of the seller.
 * A balance number.
 */
export function marketSilver(seller: Trainable, amount: number): number {
  return seller.rank * amount;
}

/**
 * How long a character stays in the market: 15 minutes × its rank × its
 * level. A balance number.
 */
export function marketJobMs(seller: Trainable, level: number): number {
  return 15 * 60_000 * seller.rank * level;
}

// ---- The trading post (design.md, The trading post; issue #325) ----

/**
 * How much the hero in the trading post lowers the price of an adventurer,
 * in tenths of a percent per level of the hero: 0.2% per level (issue #353;
 * it was 0.1%). Kept in tenths so the sums stay whole numbers (see
 * `tradingPostPrice`). A balance number.
 */
export const TRADING_POST_TENTHS_PER_LEVEL = 2;

/**
 * How long a hero stays in the trading post, per level of the hero: 30
 * minutes (issue #353; it was 1 hour). See `jobLengthMs`. A balance number.
 */
export const TRADING_POST_JOB_MS_PER_LEVEL = 30 * 60_000;

/**
 * How far below the base price the trading post can take a price, in tenths
 * of a percent per rank of the hero: 5% per rank. A balance number.
 */
export const TRADING_POST_FLOOR_TENTHS_PER_RANK = 50;

/**
 * What a price becomes when a hero of `heroLevel` finishes its job in the
 * trading post (design.md, The trading post): `price`, the price at that
 * moment, lowered by 0.2% per level of the hero, but never below
 * `basePrice` lowered by 5% per rank of the hero. Rounded up to
 * whole silver. A price already at or below the hero's floor stays as it is.
 *
 * Worked out in whole numbers, thousandths of the price, and divided only at
 * the end: a JavaScript number is a `double`, and with fractions it can be
 * a hair off (125 × (1 − 0.176) is 103.00000000000001), which rounding up
 * would turn into a whole silver too much. A whole number divided by 1000 that comes
 * out whole is always exact. In .NET money would be a `decimal`; JavaScript
 * has no decimal type.
 */
export function tradingPostPrice(price: number, basePrice: number, hero: Trainable, heroLevel: number): number {
  const lowered = price * Math.max(0, 1000 - TRADING_POST_TENTHS_PER_LEVEL * heroLevel);
  const floor = basePrice * Math.max(0, 1000 - TRADING_POST_FLOOR_TENTHS_PER_RANK * hero.rank);
  // Never above the price it had: the floor can be above it.
  return Math.min(price, Math.ceil(Math.max(lowered, floor) / 1000));
}

/**
 * What to store for a rank when a hero of `heroLevel` finishes its job in
 * the trading post at `at` (issue #339), or null when its price doesn't
 * change. `last` is what is stored now, undefined for a rank never bought
 * nor lowered.
 *
 * The price at `at`, after the daily drop, is lowered (`tradingPostPrice`)
 * and stored as the new `nextPrice`. So that the daily drop goes on as it
 * would have, `boughtAt` moves on by the full days that have passed, not to
 * `at`: the next 10% still comes at the same moment.
 */
export function tradingPostLowered(
  rank: number,
  last: LastPurchase | undefined,
  hero: Trainable,
  heroLevel: number,
  at: number,
): LastPurchase | null {
  const price = adventurerPrice(rank, last, at);
  const nextPrice = tradingPostPrice(price, ADVENTURER_BASE_PRICES[rank]!, hero, heroLevel);
  if (nextPrice === price) return null;
  const days = last ? Math.max(0, Math.floor((at - last.boughtAt) / DAY_MS)) : 0;
  return { nextPrice, boughtAt: last ? last.boughtAt + days * DAY_MS : at, lowered: true };
}

// ---- The recruiting office (design.md, The recruiting office; issue #358) ----

/**
 * How long a hero stays in the recruiting office at level 1: 7 days. A
 * higher level is quicker: the job lasts this ÷ the hero's level (see
 * `jobLengthMs`). A balance number.
 */
export const RECRUITING_JOB_MS = 7 * 24 * HOUR_MS;

/**
 * The lowest rank a hero must have to work in the recruiting office, so
 * every advanced class (rank 6 to 10) can. A balance number.
 */
export const RECRUITING_MIN_RANK = 3;

/**
 * How many new level 1, rank 1 adventurers a hero recruits when it finishes
 * its job in the recruiting office: one for each rank above rank 2. A rank 3
 * adventurer recruits 1, a rank 7 tank 5. 0 for a hero below `RECRUITING_MIN_RANK`, which
 * can't work there. A balance number.
 */
export function recruitCount(hero: Trainable): number {
  return hero.rank >= RECRUITING_MIN_RANK ? hero.rank - (RECRUITING_MIN_RANK - 1) : 0;
}
