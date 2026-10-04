// The one central timer for all games (architecture.md, Turn timing).
//
// Every second it measures how much real time has passed since the last tick
// and moves every game's clock forward by that much (`GameManager.advance`),
// which fires the turns that have become due.
//
// Why measure instead of simply adding 1000 each tick? `setInterval` is a
// request, not a promise: a callback can only run when the thread is free, so
// a busy moment makes a tick late, and those small delays would add up.
// Measuring keeps game time in step with real time however late a tick is.
//
// The clock is `performance.now()`, not `Date.now()`: it only ever moves
// forward at a steady rate (like .NET's Stopwatch), while the wall clock can
// jump when the server's time is corrected. Tests pass a fake clock.

import type { GameManager } from "./game-manager.ts";

export const TICK_MS = 1000;

/** Starts the timer; returns a function that stops it. */
export function startTurnTimer(games: Pick<GameManager, "advance">, now: () => number = () => performance.now()): () => void {
  let last = now();
  const timer = setInterval(() => {
    const current = now();
    games.advance(current - last);
    last = current;
  }, TICK_MS);
  // unref: this timer alone doesn't keep the Node process running, so tests
  // and a normal shutdown can end without stopping it first.
  timer.unref();
  return () => clearInterval(timer);
}
