// How fast the playback runs (design.md, Showing what happens; issue #334).
//
// The server fires turns on its own clock and knows nothing about
// animations. When the playback can't show a turn at its normal pace before
// the next one arrives, it speeds up instead of falling behind: it has to
// finish within half the time until the next turn, so the other half is a
// quiet moment with the board up to date.
//
// This file only does the sums, without the DOM, so it can be unit tested
// (client/playback-pace.test.ts). game.ts asks it before every step.

/** Time between two events in the playback, at normal pace. Tune by trying it out (design.md). */
export const STEP_MS = 800;
/** How long a chip takes to slide to the end of the track, and the pause it gets in the playback, at normal pace. */
export const SLIDE_MS = 500;
/** The shortest a step may get: faster than this can't be followed. Tune by trying it out. */
export const MIN_STEP_MS = 150;

export interface PaceInput {
  /**
   * Milliseconds left until the playback should be done: half the time until
   * the next turn, counted from when that time arrived. `undefined`: no
   * deadline (no next turn, or the game is paused), so the normal pace.
   */
  budgetMs: number | undefined;
  /** Steps still to show that take `STEP_MS` at normal pace: moves, attacks and the like. */
  steps: number;
  /** Chip slides still to show, which take `SLIDE_MS` at normal pace. */
  slides: number;
}

export interface Pace {
  /**
   * What every duration of the playback is multiplied by: 1 at normal pace,
   * less when it has to hurry, but never so little that a step gets shorter
   * than `MIN_STEP_MS`.
   */
  scale: number;
  /**
   * Even the fastest pace isn't enough: the turns before the newest one
   * should be applied at once, without animation.
   */
  jump: boolean;
}

/** The smallest scale: a step of `MIN_STEP_MS`. */
export const MIN_SCALE = MIN_STEP_MS / STEP_MS;

/** How fast to play back what is still in the queue, so it is done within the budget. */
export function playbackPace({ budgetMs, steps, slides }: PaceInput): Pace {
  const needed = steps * STEP_MS + slides * SLIDE_MS;
  if (budgetMs === undefined || needed === 0) return { scale: 1, jump: false };
  const scale = Math.min(1, Math.max(0, budgetMs) / needed);
  if (scale >= MIN_SCALE) return { scale, jump: false };
  return { scale: MIN_SCALE, jump: true };
}
