import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BUILDING_IDS,
  BUILDINGS,
  canPay,
  costText,
  earned,
  earnedPerHour,
  HOUR_MS,
  jobLengthMs,
  maxBuildingLevel,
  STARTING_BUILDINGS,
  upgradeCost,
} from "./village.ts";

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

test("the woodcutter and the quarry go up to level 5, with one more slot per level (issue #296)", () => {
  for (const id of ["woodcutter", "quarry"] as const) {
    assert.equal(maxBuildingLevel(id), 5);
    assert.equal(BUILDINGS[id].slots(5), 5);
    assert.equal(upgradeCost(id, 5), null);
  }
  assert.deepEqual(upgradeCost("woodcutter", 1), { wood: 0, stone: 25, silver: 0 });
  assert.deepEqual(upgradeCost("quarry", 4), { wood: 1000, stone: 500, silver: 150 });
});

test("every upgrade costs something, and costs more than the one before", () => {
  for (const id of BUILDING_IDS) {
    const costs = BUILDINGS[id].upgradeCosts;
    for (const [index, cost] of costs.entries()) {
      for (const amount of [cost.wood, cost.stone, cost.silver]) assert.ok(Number.isInteger(amount) && amount >= 0);
      assert.notEqual(costText(cost), "nothing", `${id} level ${index + 2} is free`);
      const before = costs[index - 1];
      if (before) assert.ok(cost.wood + cost.stone + cost.silver > before.wood + before.stone + before.silver);
    }
  }
});

test("a cost is paid only when there is enough of every part", () => {
  const cost = { wood: 40, stone: 100, silver: 25 };
  assert.equal(canPay({ wood: 40, stone: 100, silver: 25 }, cost), true);
  assert.equal(canPay({ wood: 1000, stone: 1000, silver: 24 }, cost), false);
  assert.equal(costText(cost), "40 wood, 100 stone, 25 silver");
  assert.equal(costText({ wood: 0, stone: 25, silver: 0 }), "25 stone");
});
