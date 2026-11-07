// The short texts of the village page (design.md, The village page;
// issue #360): the overview's tiles and the rows of a building screen. Kept
// apart from village.ts, which draws the page, so they can be tested without
// a browser: they only turn data into text.

import { nameOfCharacter, type CharacterSummary } from "../shared/characters.ts";
import { levelFromXp } from "../shared/rules/advancement.ts";
import { CLASSES } from "../shared/rules/classes.ts";
import {
  BUILDING_IDS,
  BUILDINGS,
  classBonusPercent,
  HOUR_MS,
  maxBuildingLevel,
  TRADING_POST_FLOOR_TENTHS_PER_RANK,
  TRADING_POST_TENTHS_PER_LEVEL,
  trainingRank,
  TRAINING_XP_PER_HOUR,
  type BuildingId,
} from "../shared/rules/village.ts";
import type { VillageBuilding, VillageJob } from "../shared/village.ts";

/**
 * Whether a text from the address (`#/village/<id>`) names a building.
 * Anyone can type any address, so it is checked against the list of ids.
 * Not with `id in BUILDINGS`: every JavaScript object also "has" keys like
 * "constructor" and "__proto__" from its prototype (its base class, roughly).
 */
export function isBuildingId(text: string): text is BuildingId {
  return (BUILDING_IDS as readonly string[]).includes(text);
}

/** "Lv 3/5", or "" for a building that can't be upgraded (the medical bay and the tavern). */
export function levelText(id: BuildingId, level: number): string {
  const max = maxBuildingLevel(id);
  return max === 1 ? "" : `Lv ${level}/${max}`;
}

/** All of a building's slots, the training house's trainer slot included. */
export function slotCount(building: VillageBuilding): number {
  return building.slots + (BUILDINGS[building.id].trainerSlot ? 1 : 0);
}

/** The slots as dots: ● for each one in use, ○ for each free one. "●●○". */
export function slotDots(used: number, slots: number): string {
  const inUse = Math.min(used, slots);
  return "●".repeat(inUse) + "○".repeat(slots - inUse);
}

/** "1 slot free", "2 slots free", or "" when every slot is in use. */
export function freeSlotsText(building: VillageBuilding): string {
  const free = slotCount(building) - building.jobs.length;
  if (free <= 0) return "";
  return `${free} ${free === 1 ? "slot" : "slots"} free`;
}

/** A duration, short: "45 min", "12 h", "2 h 30 min". */
export function shortDuration(ms: number): string {
  const hours = Math.floor(ms / HOUR_MS);
  const minutes = Math.round((ms % HOUR_MS) / 60_000);
  if (hours === 0) return `${minutes} min`;
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
}

/** How much a hero of this level takes off the adventurer prices: "1.5%". */
export function discountText(heroLevel: number): string {
  return `${(heroLevel * TRADING_POST_TENTHS_PER_LEVEL) / 10}%`;
}

/** How far below the base price this hero can take a price: "10%". */
export function floorText(hero: CharacterSummary): string {
  return `${(trainingRank(hero) * TRADING_POST_FLOOR_TENTHS_PER_RANK) / 10}%`;
}

function level(character: CharacterSummary): number {
  return levelFromXp(character.xp, character.class, character.rank);
}

/** A character as the dropdowns name it: "Bram - tank R2 · Lv 12". */
export function characterLabel(character: CharacterSummary): string {
  return (
    `${nameOfCharacter(character)} - ${CLASSES[character.class].name.toLowerCase()} ` +
    `R${character.rank} · Lv ${level(character)}`
  );
}

/**
 * " (+50% tank)" when the character's class gets a bonus in this building
 * (issue #300), or "". A trainee never gets one: only the trainer does.
 */
export function classBonusText(character: CharacterSummary, building: BuildingId, trainee: boolean): string {
  const percent = trainee ? 0 : classBonusPercent(character, building);
  return percent > 0 ? ` (+${percent}% ${CLASSES[character.class].name.toLowerCase()})` : "";
}

/** The training speed-up of a trainee's XP an hour: " (×3)", or "" at the normal speed. */
function trainingSpeedText(perHour: number): string {
  return perHour > TRAINING_XP_PER_HOUR ? ` (×${perHour / TRAINING_XP_PER_HOUR})` : "";
}

/**
 * One character at work, as a compact row of a building screen:
 * "Bram · 6 wood/h · 12 so far · done 21:40". `doneAt` is the local time
 * the job is done ("21:40"), worked out by the caller from the clock.
 */
export function jobText(
  job: VillageJob,
  building: BuildingId,
  character: CharacterSummary | undefined,
  doneAt: string,
): string {
  const { earns, speedsUp, cutsRest, lowersHeroPrices, recruits } = BUILDINGS[building];
  const name = character ? nameOfCharacter(character) : `Character ${job.number}`;
  const bonus = character ? classBonusText(character, building, earns === "xp" && !job.trainer) : "";
  const what = job.sale
    ? `sells ${job.sale.amount} ${job.sale.resource} for ${job.sale.silver} silver`
    : lowersHeroPrices
      ? `prices −${discountText(job.perHour)}`
      : recruits
        ? `recruits ${job.perHour}`
        : job.trainer
          ? `trainer${bonus}`
          : speedsUp
            ? `${capitalize(speedsUp)} ×${job.perHour}${bonus}`
            : cutsRest
              ? null
              : earns === "xp"
                ? `${job.perHour} XP/h${trainingSpeedText(job.perHour)} · ${job.earnedSoFar} so far`
                : `${job.perHour} ${earns}/h${bonus} · ${job.earnedSoFar} so far`;
  return [name, what, `done ${doneAt}`].filter((part) => part !== null).join(" · ");
}

/**
 * The one status line of a building's tile on the overview: what it gives
 * now ("+18 wood/h", "Healing ×4"), what the next job to finish gives and
 * when ("prices −4% at 21:40"), or "idle". `doneAt` turns a job's
 * `doneInMs` into the local time ("21:40").
 */
export function statusText(building: VillageBuilding, doneAt: (doneInMs: number) => string): string {
  const { earns, speedsUp, lowersHeroPrices, recruits, sellsResources } = BUILDINGS[building.id];
  const workers = building.jobs.filter((job) => !job.trainer);
  if (earns !== null) {
    if (workers.length === 0) return building.jobs.length > 0 ? "trainer, no trainees" : "idle";
    const total = workers.reduce((sum, job) => sum + job.perHour, 0);
    return `+${total} ${earns === "xp" ? "XP" : earns}/h`;
  }
  const next = [...building.jobs].sort((a, b) => a.doneInMs - b.doneInMs)[0];
  if (!next) return "idle";
  if (speedsUp) return `${capitalize(speedsUp)} ×${next.perHour}`;
  const at = doneAt(next.doneInMs);
  if (sellsResources && next.sale) return `+${next.sale.silver} silver at ${at}`;
  if (lowersHeroPrices) return `prices −${discountText(next.perHour)} at ${at}`;
  if (recruits) return `+${next.perHour} ${next.perHour === 1 ? "recruit" : "recruits"} at ${at}`;
  return `done ${at}`;
}

export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
