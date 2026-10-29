import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NO_REST,
  NO_SPEED_UPS,
  REST_MINUTES,
  respeed,
  restAfterDungeon,
  restAfterWork,
  restFromNow,
  restState,
  stretchEnd,
  stretchLeftMs,
} from "./rest.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

test("the rest per rank follows design.md, Resting", () => {
  assert.deepEqual(REST_MINUTES, { 1: 10, 2: 60, 3: 120, 4: 180, 5: 240 });
});

test("a character that survived rests for its rank's time", () => {
  const rest = restAfterDungeon(2, false, 1000);
  assert.deepEqual(rest, { healingUntil: 0, restingUntil: 1000 + 60 * MINUTE });
  assert.equal(restState(rest, 1000), "resting");
  assert.equal(restState(rest, 1000 + 60 * MINUTE - 1), "resting");
  assert.equal(restState(rest, 1000 + 60 * MINUTE), "ready");
});

test("a character that died heals first, then rests: twice as long", () => {
  const rest = restAfterDungeon(1, true, 0);
  assert.deepEqual(rest, { healingUntil: 10 * MINUTE, restingUntil: 20 * MINUTE });
  assert.equal(restState(rest, 0), "healing");
  assert.equal(restState(rest, 10 * MINUTE), "resting");
  assert.equal(restState(rest, 20 * MINUTE), "ready");
});

test("a character that never played is ready", () => {
  assert.equal(restState(NO_REST, Date.now()), "ready");
});

test("the client gets the time left, never below 0", () => {
  const rest = restAfterDungeon(1, true, 0);
  assert.deepEqual(restFromNow(rest, MINUTE), { workDoneInMs: 0, healedInMs: 9 * MINUTE, readyInMs: 19 * MINUTE });
  assert.deepEqual(restFromNow(rest, 17 * MINUTE), { workDoneInMs: 0, healedInMs: 0, readyInMs: 3 * MINUTE });
  assert.deepEqual(restFromNow(rest, 30 * MINUTE), { workDoneInMs: 0, healedInMs: 0, readyInMs: 0 });
});

test("a character working in the village works, then rests for its rank's time", () => {
  const rest = restAfterWork(2, 60 * MINUTE);
  assert.deepEqual(rest, { workingUntil: 60 * MINUTE, healingUntil: 0, restingUntil: 120 * MINUTE });
  assert.equal(restState(rest, 0), "working");
  assert.equal(restState(rest, 60 * MINUTE - 1), "working");
  assert.equal(restState(rest, 60 * MINUTE), "resting");
  assert.equal(restState(rest, 120 * MINUTE), "ready");
  assert.deepEqual(restFromNow(rest, 0), { workDoneInMs: 60 * MINUTE, healedInMs: 0, readyInMs: 120 * MINUTE });
});

// ---- The medical bay and the tavern (issue #298) ----

test("a stretch goes faster while a speed-up lasts, and at the normal speed after it", () => {
  const speedUp = { speed: 4, until: 60 * MINUTE };
  assert.equal(stretchEnd(0, 40 * MINUTE, null), 40 * MINUTE);
  assert.equal(stretchEnd(0, 40 * MINUTE, speedUp), 10 * MINUTE);
  // 50 minutes ×4 do 200; the 40 minutes left go at the normal speed.
  assert.equal(stretchEnd(10 * MINUTE, 240 * MINUTE, speedUp), 100 * MINUTE);
  // Starting after the speed-up ended: normal.
  assert.equal(stretchEnd(70 * MINUTE, 5 * MINUTE, speedUp), 75 * MINUTE);
  // Never early: rounded up to the next millisecond.
  assert.equal(stretchEnd(0, 10, { speed: 3, until: 1000 }), 4);
  // What is left is the inverse.
  assert.equal(stretchLeftMs(10 * MINUTE, 100 * MINUTE, speedUp), 240 * MINUTE);
  assert.equal(stretchLeftMs(20 * MINUTE, 10 * MINUTE, speedUp), 0);
});

test("the rest after a dungeon uses the medical bay for the healing and the tavern for the resting", () => {
  const speedUps = { healing: { speed: 2, until: HOUR }, resting: { speed: 3, until: HOUR } };
  // Rank 2: 60 minutes healing at ×2, then 60 minutes resting at ×3.
  assert.deepEqual(restAfterDungeon(2, true, 0, speedUps), { healingUntil: 30 * MINUTE, restingUntil: 50 * MINUTE });
  assert.deepEqual(restAfterDungeon(2, false, 0, speedUps), { healingUntil: 0, restingUntil: 20 * MINUTE });
});

test("respeeding keeps the time that has passed and changes only what is left", () => {
  const rest = restAfterDungeon(2, true, 0);
  const tavern = { ...NO_SPEED_UPS, resting: { speed: 2, until: 10 * HOUR } };
  // After 30 minutes of healing, a tavern hero: the healing stays, the 60 minutes of resting take 30.
  assert.deepEqual(respeed(rest, 30 * MINUTE, NO_SPEED_UPS, tavern), { healingUntil: HOUR, restingUntil: 90 * MINUTE });
  // Taken out again at 70 minutes: 10 minutes at ×2 did 20, so 40 are left.
  assert.deepEqual(respeed({ healingUntil: HOUR, restingUntil: 90 * MINUTE }, 70 * MINUTE, tavern, NO_SPEED_UPS), {
    healingUntil: HOUR,
    restingUntil: 110 * MINUTE,
  });
  // A finished rest doesn't change.
  assert.deepEqual(respeed(rest, 3 * HOUR, NO_SPEED_UPS, tavern), rest);
});
