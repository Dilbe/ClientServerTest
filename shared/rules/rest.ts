// Resting after a dungeon (design.md, Resting). Shared so the server and the
// client agree on how long a rest takes.
//
// Times here are wall-clock times: milliseconds since 1970 (UTC), like
// Date.now(). Not the server's game clock, which stops while the server is
// down: a rest goes on while the server is down, like real time does.

/** How long a character rests after a dungeon, in minutes, by rank. Balance numbers: change them freely. */
export const REST_MINUTES: Record<number, number> = { 1: 5, 2: 30, 3: 60, 4: 90, 5: 120 };

/**
 * When a character's rest ends. A character that died first heals for as long
 * as a rest takes, then rests: the time is doubled. 0 means "not resting" (or
 * "not healing"), so a character that never played is ready.
 */
export interface Rest {
  /** Until when it heals; 0 when it didn't die. Always before or at `restingUntil`. */
  healingUntil: number;
  /** Until when it can't be chosen for a dungeon. */
  restingUntil: number;
}

export const NO_REST: Rest = { healingUntil: 0, restingUntil: 0 };

/** The rest a character gets from a dungeon that ended at `endedAt`. */
export function restAfterDungeon(rank: number, died: boolean, endedAt: number): Rest {
  const restMs = REST_MINUTES[rank]! * 60_000;
  return died
    ? { healingUntil: endedAt + restMs, restingUntil: endedAt + 2 * restMs }
    : { healingUntil: 0, restingUntil: endedAt + restMs };
}

export type RestState = "healing" | "resting" | "ready";

export function restState(rest: Rest, now: number): RestState {
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
export function restFromNow(rest: Rest, now: number): { healedInMs: number; readyInMs: number } {
  return { healedInMs: Math.max(0, rest.healingUntil - now), readyInMs: Math.max(0, rest.restingUntil - now) };
}
