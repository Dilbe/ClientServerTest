import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bonusXp,
  BUILDING_IDS,
  BUILDINGS,
  canPay,
  costText,
  earned,
  earnedPerHour,
  HOUR_MS,
  jobLengthMs,
  maxBuildingLevel,
  restSpeed,
  STARTING_BUILDINGS,
  trainingSpeed,
  trainingXpPerHour,
  upgradeCost,
} from "./village.ts";

test("a job lasts 1 hour per level of the character and earns 1 per rank per hour (design.md, The buildings)", () => {
  assert.equal(jobLengthMs("woodcutter", 10), 10 * HOUR_MS);
  assert.equal(earnedPerHour(2), 2);
  // A rank 2, level 10 character: 10 hours for 20 wood.
  assert.equal(earned(earnedPerHour(2), 0, jobLengthMs("woodcutter", 10)), 20);
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
  assert.equal(BUILDINGS.woodcutter.earns, "wood");
  assert.equal(BUILDINGS.quarry.earns, "stone");
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

// ---- The training house (design.md, The training house; issue #297) ----

test("only the buildings the village doesn't start with have a build cost", () => {
  for (const id of BUILDING_IDS) {
    assert.equal(BUILDINGS[id].buildCost === null, STARTING_BUILDINGS.includes(id), id);
  }
  assert.deepEqual(BUILDINGS.trainingHouse.buildCost, { wood: 15, stone: 15, silver: 0 });
});

test("the training house goes up to level 4, with one more training slot per level and one trainer slot", () => {
  assert.equal(maxBuildingLevel("trainingHouse"), 4);
  assert.deepEqual([1, 2, 3, 4].map(BUILDINGS.trainingHouse.slots), [1, 2, 3, 4]);
  assert.equal(BUILDINGS.trainingHouse.trainerSlot, true);
  assert.equal(BUILDINGS.woodcutter.trainerSlot, false);
  assert.deepEqual(upgradeCost("trainingHouse", 3), { wood: 750, stone: 750, silver: 150 });
});

test("a trainee trains 24 hours whatever its level; the trainer stays 1 hour per level", () => {
  assert.equal(jobLengthMs("trainingHouse", 1), 24 * HOUR_MS);
  assert.equal(jobLengthMs("trainingHouse", 40), 24 * HOUR_MS);
  assert.equal(jobLengthMs("trainingHouse", 1, true), HOUR_MS);
  assert.equal(jobLengthMs("trainingHouse", 30, true), 30 * HOUR_MS);
});

test("a trainer gives +100% per rank of difference; an advanced class counts 5 ranks higher", () => {
  const adventurer = (rank: number) => ({ class: "adventurer" as const, rank });
  const tank = (rank: number) => ({ class: "tank" as const, rank });
  // The examples of design.md.
  assert.equal(trainingSpeed(adventurer(2), adventurer(1)), 2);
  assert.equal(trainingSpeed(adventurer(4), adventurer(2)), 3);
  assert.equal(trainingSpeed(tank(1), adventurer(5)), 2);
  assert.equal(trainingSpeed(tank(5), adventurer(1)), 10);
  assert.equal(trainingSpeed(tank(5), tank(1)), 5);
  assert.equal(trainingSpeed({ class: "caster", rank: 5 }, tank(1)), 1);
  // No trainer, the same rank, or a lower one: the normal speed.
  assert.equal(trainingSpeed(null, adventurer(1)), 1);
  assert.equal(trainingSpeed(adventurer(3), adventurer(3)), 1);
  assert.equal(trainingSpeed(adventurer(2), adventurer(3)), 1);
  // An adventurer never trains an advanced class.
  assert.equal(trainingSpeed(adventurer(5), tank(1)), 1);
  assert.equal(trainingXpPerHour(adventurer(4), adventurer(2)), 30);
});

test("the trainer bonus counts exactly, rounded up, when time runs out, and full hours when taken out", () => {
  // 1.5 hours at a bonus of 20 XP an hour.
  assert.equal(bonusXp(20, 0, 1.5 * HOUR_MS, false), 30);
  assert.equal(bonusXp(20, 0, 1.5 * HOUR_MS, true), 20);
  // A minute at 20 an hour is a third of an XP: rounded up to 1.
  assert.equal(bonusXp(20, 0, 60_000, false), 1);
  assert.equal(bonusXp(20, 0, 60_000, true), 0);
  assert.equal(bonusXp(20, 1000, 0, false), 0);
});

// ---- The medical bay and the tavern (issue #298) ----

test("the medical bay and the tavern have one slot, can't be upgraded, and cost what issue #298 says", () => {
  assert.deepEqual(BUILDINGS.medicalBay.buildCost, { wood: 500, stone: 1000, silver: 250 });
  assert.deepEqual(BUILDINGS.tavern.buildCost, { wood: 1000, stone: 500, silver: 250 });
  for (const id of ["medicalBay", "tavern"] as const) {
    assert.equal(maxBuildingLevel(id), 1);
    assert.equal(BUILDINGS[id].slots(1), 1);
    assert.equal(BUILDINGS[id].earns, null);
    assert.equal(jobLengthMs(id, 12), 12 * HOUR_MS);
  }
  assert.equal(BUILDINGS.medicalBay.speedsUp, "healing");
  assert.equal(BUILDINGS.tavern.speedsUp, "resting");
});

test("the hero speeds up by +100% per rank; an advanced class counts 5 ranks higher", () => {
  assert.equal(restSpeed({ class: "adventurer", rank: 1 }), 2);
  assert.equal(restSpeed({ class: "adventurer", rank: 3 }), 4);
  assert.equal(restSpeed({ class: "tank", rank: 1 }), 7);
  assert.equal(restSpeed({ class: "healer", rank: 5 }), 11);
});
