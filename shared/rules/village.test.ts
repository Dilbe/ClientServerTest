import { test } from "node:test";
import assert from "node:assert/strict";
import { BUILDINGS, earned, earnedPerHour, HOUR_MS, jobLengthMs, STARTING_BUILDINGS } from "./village.ts";

test("a job lasts 1 hour per level of the character and earns 1 per rank per hour (design.md, The buildings)", () => {
  assert.equal(jobLengthMs(10), 10 * HOUR_MS);
  assert.equal(earnedPerHour(2), 2);
  // A rank 2, level 10 character: 10 hours for 20 wood.
  assert.equal(earned(earnedPerHour(2), 0, jobLengthMs(10)), 20);
});

test("only full hours count", () => {
  assert.equal(earned(3, 0, HOUR_MS - 1), 0);
  assert.equal(earned(3, 0, HOUR_MS), 3);
  assert.equal(earned(3, 1000, 1000 + 2.5 * HOUR_MS), 6);
  // A clock that went back never gives less than nothing.
  assert.equal(earned(3, 1000, 0), 0);
});

test("the village starts with a woodcutter and a quarry, with one slot each at level 1", () => {
  assert.deepEqual(STARTING_BUILDINGS, ["woodcutter", "quarry"]);
  for (const id of STARTING_BUILDINGS) assert.equal(BUILDINGS[id].slots(1), 1);
  assert.equal(BUILDINGS.woodcutter.resource, "wood");
  assert.equal(BUILDINGS.quarry.resource, "stone");
});
