// The timer with a fake clock. Node's test runner can replace setInterval
// and Date with fakes (`mock.timers`), so a test can skip minutes of game
// time in milliseconds: `mock.timers.tick(1000)` moves the fake clock forward
// one second and runs whatever timers became due on the way.

import { test, mock, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { TurnMessage } from "../shared/protocol.ts";
import { baseStats } from "../shared/rules/stats.ts";
import { GameManager } from "./game-manager.ts";
import { startTurnTimer, TICK_MS } from "./turn-timer.ts";

afterEach(() => mock.timers.reset());

test("turns fire on time", () => {
  mock.timers.enable({ apis: ["setInterval", "Date"] });
  const turns: { second: number; characterId: number }[] = [];
  const games = new GameManager({
    cycleMs: 10_000,
    onTurn: (t: TurnMessage) => turns.push({ second: Date.now() / 1000, characterId: t.characterId }),
    random: () => 0.999, // no shuffling: the track is in the given order
  });
  const stop = startTurnTimer(games, () => Date.now());
  games.start("g", [
    { recordId: 701, accountId: 501, stats: baseStats(), displayName: "Ann", characterName: "Adventurer 1", maxXpGain: 450, wonDungeonBefore: false },
    { recordId: 702, accountId: 502, stats: baseStats(), displayName: "Ben", characterName: "Adventurer 1", maxXpGain: 450, wonDungeonBefore: false },
  ]);

  for (let i = 0; i < 30; i++) mock.timers.tick(1000);
  assert.deepEqual(turns, [
    { second: 10, characterId: 1 },
    { second: 15, characterId: 2 },
    { second: 20, characterId: 1 },
    { second: 25, characterId: 2 },
    { second: 30, characterId: 1 },
  ]);

  stop();
  mock.timers.tick(60_000);
  assert.equal(turns.length, 5);
});

test("a late tick advances the games by the time that really passed", () => {
  mock.timers.enable({ apis: ["setInterval"] });
  let clock = 0;
  const advanced: number[] = [];
  startTurnTimer({ advance: (ms) => advanced.push(ms) }, () => clock);

  clock = 1000;
  mock.timers.tick(TICK_MS);
  // The thread was busy, so the next tick only ran 1.5 seconds later.
  clock = 2500;
  mock.timers.tick(TICK_MS);
  assert.deepEqual(advanced, [1000, 1500]);
});
