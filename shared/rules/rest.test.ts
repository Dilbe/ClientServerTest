import { test } from "node:test";
import assert from "node:assert/strict";
import { NO_REST, REST_MINUTES, restAfterDungeon, restAfterWork, restFromNow, restState } from "./rest.ts";

const MINUTE = 60_000;

test("the rest per rank follows design.md, Resting", () => {
  assert.deepEqual(REST_MINUTES, { 1: 5, 2: 30, 3: 60, 4: 90, 5: 120 });
});

test("a character that survived rests for its rank's time", () => {
  const rest = restAfterDungeon(2, false, 1000);
  assert.deepEqual(rest, { healingUntil: 0, restingUntil: 1000 + 30 * MINUTE });
  assert.equal(restState(rest, 1000), "resting");
  assert.equal(restState(rest, 1000 + 30 * MINUTE - 1), "resting");
  assert.equal(restState(rest, 1000 + 30 * MINUTE), "ready");
});

test("a character that died heals first, then rests: twice as long", () => {
  const rest = restAfterDungeon(1, true, 0);
  assert.deepEqual(rest, { healingUntil: 5 * MINUTE, restingUntil: 10 * MINUTE });
  assert.equal(restState(rest, 0), "healing");
  assert.equal(restState(rest, 5 * MINUTE), "resting");
  assert.equal(restState(rest, 10 * MINUTE), "ready");
});

test("a character that never played is ready", () => {
  assert.equal(restState(NO_REST, Date.now()), "ready");
});

test("the client gets the time left, never below 0", () => {
  const rest = restAfterDungeon(1, true, 0);
  assert.deepEqual(restFromNow(rest, MINUTE), { workDoneInMs: 0, healedInMs: 4 * MINUTE, readyInMs: 9 * MINUTE });
  assert.deepEqual(restFromNow(rest, 7 * MINUTE), { workDoneInMs: 0, healedInMs: 0, readyInMs: 3 * MINUTE });
  assert.deepEqual(restFromNow(rest, 20 * MINUTE), { workDoneInMs: 0, healedInMs: 0, readyInMs: 0 });
});

test("a character working in the village works, then rests for its rank's time", () => {
  const rest = restAfterWork(2, 60 * MINUTE);
  assert.deepEqual(rest, { workingUntil: 60 * MINUTE, healingUntil: 0, restingUntil: 90 * MINUTE });
  assert.equal(restState(rest, 0), "working");
  assert.equal(restState(rest, 60 * MINUTE - 1), "working");
  assert.equal(restState(rest, 60 * MINUTE), "resting");
  assert.equal(restState(rest, 90 * MINUTE), "ready");
  assert.deepEqual(restFromNow(rest, 0), { workDoneInMs: 60 * MINUTE, healedInMs: 0, readyInMs: 90 * MINUTE });
});
