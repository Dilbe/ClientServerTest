import { test } from "node:test";
import assert from "node:assert/strict";
import { adventurerPrice, DAY_MS } from "./advancement.ts";
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
  marketAmount,
  marketJobMs,
  marketSilver,
  maxBuildingLevel,
  restSpeed,
  STARTING_BUILDINGS,
  tradingPostLowered,
  tradingPostPrice,
  trainingEnd,
  trainingSpeed,
  trainingXpPerHour,
  upgradeCost,
} from "./village.ts";

test("a job lasts 1 hour per level of the character and earns 1 per rank per hour (design.md, The buildings)", () => {
  assert.equal(jobLengthMs("woodcutter", 10), 10 * HOUR_MS);
  assert.equal(earnedPerHour({ class: "adventurer", rank: 2 }), 2);
  // A rank 2, level 10 character: 10 hours for 20 wood.
  assert.equal(earned(earnedPerHour({ class: "adventurer", rank: 2 }), 0, jobLengthMs("woodcutter", 10)), 20);
  // An advanced class counts 5 ranks higher (issue #328): a rank 1, level 10 tank earns 60.
  assert.equal(earned(earnedPerHour({ class: "tank", rank: 1 }), 0, jobLengthMs("woodcutter", 10)), 60);
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

test("a trainee's job ends when it has earned what it needs, or after its 24 hours (issue #321)", () => {
  const alone = { startedAt: 0, countedFrom: 0, credited: 0, perHour: 10 };
  const latest = 24 * HOUR_MS;
  // 10 XP for each full hour: 25 XP takes 3 hours.
  assert.equal(trainingEnd(alone, 25, latest), 3 * HOUR_MS);
  assert.equal(trainingEnd(alone, 30, latest), 3 * HOUR_MS);
  assert.equal(trainingEnd(alone, 1000, latest), latest);
  // ×2: a bonus of 10 an hour, counted exactly, rounded up, so 1 bonus XP
  // after the first millisecond.
  const doubled = { ...alone, perHour: 20 };
  assert.equal(trainingEnd(doubled, 1, latest), 1);
  // 15 XP: at 1 hour, 10 normal and 10 bonus. Just before, only 0 and 10.
  assert.equal(trainingEnd(doubled, 15, latest), HOUR_MS);
  // 25 XP: after 1 hour, 10 normal, so the bonus must give 15: it gives 15
  // one millisecond after 1 h 24 min.
  assert.equal(trainingEnd(doubled, 25, latest), 84 * 60_000 + 1);
  // What a trainer credited before counts too, and the bonus counts from `countedFrom`.
  const credited = { startedAt: 0, countedFrom: 2 * HOUR_MS, credited: 5, perHour: 10 };
  assert.equal(trainingEnd(credited, 25, latest), 2 * HOUR_MS);
});

// ---- The market (issue #324) ----

test("the market sells 1 resource per level for 1 silver per rank each, and takes 15 minutes × rank × level", () => {
  assert.equal(marketAmount(10), 10);
  assert.equal(marketSilver({ class: "adventurer", rank: 3 }, marketAmount(10)), 30);
  assert.equal(marketJobMs({ class: "adventurer", rank: 3 }, 10), 7.5 * HOUR_MS);
  // An advanced class counts 5 ranks higher: a rank 1 tank as rank 6.
  assert.equal(marketSilver({ class: "tank", rank: 1 }, marketAmount(10)), 60);
  assert.equal(marketJobMs({ class: "tank", rank: 1 }, 10), 15 * HOUR_MS);
  assert.equal(maxBuildingLevel("market"), 4);
  assert.deepEqual([1, 2, 3, 4].map(BUILDINGS.market.slots), [1, 2, 3, 4]);
  assert.deepEqual(BUILDINGS.market.buildCost, BUILDINGS.pub.buildCost);
  assert.deepEqual(BUILDINGS.market.upgradeCosts, BUILDINGS.pub.upgradeCosts);
  assert.equal(BUILDINGS.market.sellsResources, true);
  assert.equal(BUILDINGS.market.earns, null);
});

// ---- The trading post (issue #325) ----

test("the trading post costs 150 wood, 150 stone, 50 silver, and gets one more slot per level, like the pub", () => {
  assert.deepEqual(BUILDINGS.tradingPost.buildCost, { wood: 150, stone: 150, silver: 50 });
  assert.equal(maxBuildingLevel("tradingPost"), 4);
  assert.deepEqual([1, 2, 3, 4].map(BUILDINGS.tradingPost.slots), [1, 2, 3, 4]);
  assert.deepEqual(BUILDINGS.tradingPost.upgradeCosts, BUILDINGS.pub.upgradeCosts);
  assert.equal(BUILDINGS.tradingPost.earns, null);
  assert.equal(BUILDINGS.tradingPost.lowersHeroPrices, true);
  // Its hero stays 1 hour per level, like the medical bay's.
  assert.equal(jobLengthMs("tradingPost", 12), 12 * HOUR_MS);
});

test("the trading post lowers a price by 0.1% per level of its hero, rounded up", () => {
  const adventurer = { class: "adventurer" as const, rank: 1 };
  assert.equal(tradingPostPrice(100, 100, adventurer, 10), 99);
  // 9.9 and 88.2 round up.
  assert.equal(tradingPostPrice(10, 10, adventurer, 10), 10);
  assert.equal(tradingPostPrice(90, 90, adventurer, 20), 89);
  // From the price now, not the base price: 162 × 0.97 = 157.14.
  assert.equal(tradingPostPrice(162, 90, adventurer, 30), 158);
  // 125 × (1 − 0.176) is 103.00000000000001 in floating point, which would
  // round up to 104. Worked out in whole numbers it stays 103. (No hero has
  // level 176; the rule doesn't care.)
  assert.equal(tradingPostPrice(125, 100, { class: "tank", rank: 5 }, 176), 103);
});

test("the trading post never takes a price more than 5% per rank of its hero below the base price", () => {
  // Levels this high don't exist; they show the floor. A rank 1 adventurer: 95% of the base.
  assert.equal(tradingPostPrice(100, 100, { class: "adventurer", rank: 1 }, 80), 95);
  assert.equal(tradingPostPrice(100, 100, { class: "adventurer", rank: 2 }, 80), 92);
  // An advanced class counts 5 ranks higher: a rank 1 tank as rank 6, so at most 30% off.
  assert.equal(tradingPostPrice(100, 100, { class: "tank", rank: 1 }, 400), 70);
  // Above the base price the floor doesn't matter: 200 × 0.92 = 184.
  assert.equal(tradingPostPrice(200, 100, { class: "adventurer", rank: 1 }, 80), 184);
});

// ---- A lasting discount when the job is done (issue #339) ----

test("a finished trading post job stores the lowered price, keeping the moment of the daily drop", () => {
  const hero = { class: "adventurer" as const, rank: 2 };
  // Bought at 0, so the next costs 180; 1.5 days later that is 162. Lowered by 2%: 158.76, so 159.
  const lowered = tradingPostLowered(2, { nextPrice: 180, boughtAt: 0 }, hero, 20, 1.5 * DAY_MS);
  assert.deepEqual(lowered, { nextPrice: 159, boughtAt: DAY_MS, lowered: true });
  // The next 10% comes 2 days after the purchase, as without the trading post: 159 × 0.9 = 143.1.
  assert.equal(adventurerPrice(2, lowered!, 2 * DAY_MS - 1), 159);
  assert.equal(adventurerPrice(2, lowered!, 2 * DAY_MS), 143);
  // A rank never bought starts from its base price.
  assert.deepEqual(tradingPostLowered(5, undefined, hero, 20, 7), { nextPrice: 2450, boughtAt: 7, lowered: true });
  // Nothing to store when the price doesn't change: 10 × 0.98 rounds back up to 10.
  assert.equal(tradingPostLowered(1, undefined, hero, 20, 0), null);
});

test("only a price the trading post lowered stays below the base price", () => {
  assert.equal(adventurerPrice(2, { nextPrice: 85, boughtAt: 0, lowered: true }, 100 * DAY_MS), 85);
  // Not lowered by the trading post, as when a base price went up: the base price.
  assert.equal(adventurerPrice(2, { nextPrice: 85, boughtAt: 0 }, 0), 90);
});
