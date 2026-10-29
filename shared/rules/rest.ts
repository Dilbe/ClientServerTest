// Resting after a dungeon (design.md, Resting). Shared so the server and the
// client agree on how long a rest takes.
//
// Times here are wall-clock times: milliseconds since 1970 (UTC), like
// Date.now(). Not the server's game clock, which stops while the server is
// down: a rest goes on while the server is down, like real time does.

/** How long a character rests after a dungeon, in minutes, by rank. Balance numbers: change them freely. */
export const REST_MINUTES: Record<number, number> = { 1: 10, 2: 60, 3: 120, 4: 180, 5: 240 };

/**
 * When a character's rest ends. A character that died first heals for as long
 * as a rest takes, then rests: the time is doubled. 0 means "not resting" (or
 * "not healing"), so a character that never played is ready.
 *
 * A character working in the village (design.md, The village) first works,
 * then rests: its rest is set when it starts working, from the end of the job.
 */
export interface Rest {
  /** Until when it works in the village; left out or 0 when it doesn't. Always before or at `restingUntil`. */
  workingUntil?: number;
  /** Until when it heals; 0 when it didn't die. Always before or at `restingUntil`. */
  healingUntil: number;
  /** Until when it can't be chosen for a dungeon. */
  restingUntil: number;
}

export const NO_REST: Rest = { healingUntil: 0, restingUntil: 0 };

/**
 * The medical bay's or the tavern's speed-up (design.md, The medical bay and
 * the tavern; issue #298): healing or resting goes `speed` times as fast
 * until `until`, when the hero in the building leaves, and at the normal
 * speed after that. It counts from now: a speed-up is only ever used for
 * the time from its hero's slotting on.
 */
export interface SpeedUp {
  speed: number;
  until: number;
}

/** The speed-ups an account has now: the medical bay's for healing, the tavern's for resting. */
export interface RestSpeedUps {
  healing: SpeedUp | null;
  resting: SpeedUp | null;
}

export const NO_SPEED_UPS: RestSpeedUps = { healing: null, resting: null };

/**
 * When a stretch of healing or resting that starts at `start` and takes
 * `ms` at the normal speed ends with this speed-up. Rounded up to the next
 * millisecond, so it is never early.
 */
export function stretchEnd(start: number, ms: number, speedUp: SpeedUp | null): number {
  if (!speedUp || start >= speedUp.until) return start + ms;
  const coveredMs = (speedUp.until - start) * speedUp.speed;
  return ms <= coveredMs ? start + Math.ceil(ms / speedUp.speed) : speedUp.until + (ms - coveredMs);
}

/**
 * How much of a stretch from `from` until `end` (worked out with
 * `stretchEnd` and this speed-up) is left, in milliseconds at the normal
 * speed: the inverse of `stretchEnd`.
 */
export function stretchLeftMs(from: number, end: number, speedUp: SpeedUp | null): number {
  if (end <= from) return 0;
  if (!speedUp) return end - from;
  const spedUpMs = Math.max(0, Math.min(end, speedUp.until) - from);
  return spedUpMs * speedUp.speed + Math.max(0, end - Math.max(from, speedUp.until));
}

/**
 * The rest a character gets from a dungeon that ended at `endedAt`, with
 * the account's speed-ups of that moment: the medical bay's for the
 * healing, the tavern's for the resting after it.
 */
export function restAfterDungeon(
  rank: number,
  died: boolean,
  endedAt: number,
  speedUps: RestSpeedUps = NO_SPEED_UPS,
): Rest {
  const restMs = REST_MINUTES[rank]! * 60_000;
  const healingUntil = died ? stretchEnd(endedAt, restMs, speedUps.healing) : 0;
  return { healingUntil, restingUntil: stretchEnd(died ? healingUntil : endedAt, restMs, speedUps.resting) };
}

/**
 * The rest a character gets after a job in the village that ends at `endsAt`,
 * at its end or when it is taken out early: its normal rest, as after a
 * dungeon it survived (design.md, Working in a building).
 */
export function restAfterWork(rank: number, endsAt: number, speedUps: RestSpeedUps = NO_SPEED_UPS): Rest {
  return { workingUntil: endsAt, ...restAfterDungeon(rank, false, endsAt, speedUps) };
}

/**
 * A rest worked out again at `now`, because a speed-up came or went
 * (design.md, The medical bay and the tavern): what is left of the healing
 * and of the resting is worked out with the speed-ups it had (`before`),
 * and goes on with the new ones (`after`). The part that has passed stays
 * as it was, so a hero slotted for the last minute only speeds up that
 * minute. A rest after a job that is still running starts when the job
 * ends, so only its resting can change.
 */
export function respeed(rest: Rest, now: number, before: RestSpeedUps, after: RestSpeedUps): Rest {
  const healingUntil =
    rest.healingUntil > now
      ? stretchEnd(now, stretchLeftMs(now, rest.healingUntil, before.healing), after.healing)
      : rest.healingUntil;
  const restingFrom = Math.max(now, rest.healingUntil, rest.workingUntil ?? 0);
  if (rest.restingUntil <= restingFrom) return { ...rest, healingUntil };
  const leftMs = stretchLeftMs(restingFrom, rest.restingUntil, before.resting);
  const newFrom = Math.max(now, healingUntil, rest.workingUntil ?? 0);
  return { ...rest, healingUntil, restingUntil: stretchEnd(newFrom, leftMs, after.resting) };
}

export type RestState = "working" | "healing" | "resting" | "ready";

export function restState(rest: Rest, now: number): RestState {
  if (now < (rest.workingUntil ?? 0)) return "working";
  if (now < rest.healingUntil) return "healing";
  if (now < rest.restingUntil) return "resting";
  return "ready";
}

/**
 * The rest as the client gets it: how long until it is healed and until it is
 * ready, from now, in milliseconds (0 when that has passed). Not the times
 * themselves: the player's clock may be off, and a duration doesn't depend on
 * it (architecture.md, Resting).
 */
export function restFromNow(
  rest: Rest,
  now: number,
): { workDoneInMs: number; healedInMs: number; readyInMs: number } {
  return {
    workDoneInMs: Math.max(0, (rest.workingUntil ?? 0) - now),
    healedInMs: Math.max(0, rest.healingUntil - now),
    readyInMs: Math.max(0, rest.restingUntil - now),
  };
}
