import { test } from "node:test";
import assert from "node:assert/strict";
import { turnCycleMs } from "./config.ts";

test("the turn cycle is 60 seconds, 10 in development, or what TURN_CYCLE_SECONDS says", () => {
  assert.equal(turnCycleMs(true, undefined), 60_000);
  assert.equal(turnCycleMs(false, undefined), 10_000);
  assert.equal(turnCycleMs(true, "30"), 30_000);
  assert.equal(turnCycleMs(false, "2.5"), 2_500);
  for (const bad of ["0", "-5", "soon", "Infinity"]) assert.throws(() => turnCycleMs(true, bad), /TURN_CYCLE_SECONDS/);
});
