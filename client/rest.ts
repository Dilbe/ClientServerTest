// A character's rest after a dungeon, as the client shows it (design.md,
// Resting): "Healing" with when the healing ends, or "Resting", and when it
// is ready again, in the player's local time. A character working in the village shows where it
// works and when it is done (design.md, The village).
//
// The server sends how long is left (`healedInMs`, `readyInMs`), not the
// times themselves: the clock of the player's device may be off by minutes,
// and a duration doesn't depend on it. The client adds the durations to its
// own clock when the message arrives, so the times shown are right on that
// clock, whatever it says. (architecture.md, Resting.)

import { restState, type Rest } from "../shared/rules/rest.ts";

export { localTime, restText } from "./rest-text.ts";

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
