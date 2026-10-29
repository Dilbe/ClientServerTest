// A character's rest after a dungeon, as the client shows it (design.md,
// Resting): "Healing" or "Resting", and when it is ready again, in the
// player's local time. A character working in the village shows where it
// works and when it is done (design.md, The village).
//
// The server sends how long is left (`healedInMs`, `readyInMs`), not the
// times themselves: the clock of the player's device may be off by minutes,
// and a duration doesn't depend on it. The client adds the durations to its
// own clock when the message arrives, so the times shown are right on that
// clock, whatever it says. (architecture.md, Resting.)

import { restState, type Rest, type RestState } from "../shared/rules/rest.ts";
import { BUILDINGS, type BuildingId } from "../shared/rules/village.ts";

/** The rest in the client's own clock (`Date.now()`), from a message that arrived at `receivedAt`. */
export function localRest(
  fromServer: { workDoneInMs: number; healedInMs: number; readyInMs: number },
  receivedAt: number,
): Rest {
  return {
    workingUntil: receivedAt + fromServer.workDoneInMs,
    healingUntil: receivedAt + fromServer.healedInMs,
    restingUntil: receivedAt + fromServer.readyInMs,
  };
}

export function isWorking(rest: Rest): boolean {
  return restState(rest, Date.now()) === "working";
}

export function isReady(rest: Rest): boolean {
  return restState(rest, Date.now()) === "ready";
}

const STATE_NAMES: Record<RestState, string> = {
  working: "Working",
  healing: "Healing",
  resting: "Resting",
  ready: "Ready",
};

/**
 * "Healing · ready at 14:35", "Woodcutter · done at 14:35" while it works in
 * the village, or `undefined` when it is ready.
 */
export function restText(rest: Rest, workplace: BuildingId | null = null): string | undefined {
  const state = restState(rest, Date.now());
  if (state === "ready") return undefined;
  if (state === "working") {
    const where = workplace ? BUILDINGS[workplace].name : STATE_NAMES.working;
    return `${where} · done at ${localTime(rest.workingUntil ?? 0)}`;
  }
  return `${STATE_NAMES[state]} · ready at ${localTime(rest.restingUntil)}`;
}

/**
 * The time in the player's own time zone and format: the browser knows both
 * (like CultureInfo.CurrentCulture in .NET). Rounded up to the minute, so the
 * character is never shown as ready before it is. With the day when it isn't
 * today: a rest can go past midnight.
 */
export function localTime(ms: number): string {
  const time = new Date(Math.ceil(ms / 60_000) * 60_000);
  const today = new Date().toDateString() === time.toDateString();
  return time.toLocaleString([], { weekday: today ? undefined : "short", hour: "numeric", minute: "2-digit" });
}

/**
 * Calls `redraw` once when the first of these rests changes state (working
 * to resting, healing to resting, or resting to ready), so the screen follows without a new
 * message from the server. Each call replaces the timer of the one before.
 */
export class RestTimer {
  private timer: number | undefined;

  set(rests: readonly Rest[], redraw: () => void): void {
    this.clear();
    const now = Date.now();
    const changes = rests.flatMap((r) => [r.workingUntil ?? 0, r.healingUntil, r.restingUntil]).filter((t) => t > now);
    if (changes.length === 0) return;
    // A few milliseconds late, so the state has really changed by then.
    this.timer = window.setTimeout(redraw, Math.min(...changes) - now + 50);
  }

  /** Stops the timer: nothing on screen shows a rest any more. */
  clear(): void {
    window.clearTimeout(this.timer);
    this.timer = undefined;
  }
}
