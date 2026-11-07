import { test } from "node:test";
import assert from "node:assert/strict";
import type { CharacterSummary } from "../shared/characters.ts";
import type { VillageBuilding, VillageJob } from "../shared/village.ts";
import {
  characterLabel,
  classBonusText,
  freeSlotsText,
  isBuildingId,
  jobText,
  levelText,
  shortDuration,
  slotDots,
  statusText,
} from "./village-text.ts";

function character(overrides: Partial<CharacterSummary> = {}): CharacterSummary {
  return {
    number: 1,
    name: "Bram",
    class: "adventurer",
    rank: 1,
    xp: 0,
    upgrades: [],
    workDoneInMs: 0,
    healedInMs: 0,
    readyInMs: 0,
    workplace: null,
    inGame: false,
    inRunningGame: false,
    ...overrides,
  } as CharacterSummary;
}

function job(overrides: Partial<VillageJob> = {}): VillageJob {
  return {
    number: 1,
    trainer: false,
    perHour: 6,
    earnedSoFar: 12,
    startedMsAgo: 0,
    doneInMs: 60_000,
    sale: null,
    ...overrides,
  };
}

function building(overrides: Partial<VillageBuilding> = {}): VillageBuilding {
  return { id: "woodcutter", level: 3, slots: 3, jobs: [], ...overrides };
}

const at = (ms: number) => `t+${ms}`;

test("only the ids of real buildings are buildings, not keys every object has", () => {
  assert.equal(isBuildingId("woodcutter"), true);
  assert.equal(isBuildingId("recruitingOffice"), true);
  for (const text of ["", "castle", "constructor", "__proto__", "toString", "Woodcutter"]) {
    assert.equal(isBuildingId(text), false, text);
  }
});

test("the level is out of the max level, and left out where there are no upgrades", () => {
  assert.equal(levelText("woodcutter", 3), "Lv 3/5");
  assert.equal(levelText("pub", 1), "Lv 1/4");
  assert.equal(levelText("medicalBay", 1), "");
});

test("slots are dots: filled ones in use, then open ones", () => {
  assert.equal(slotDots(2, 3), "●●○");
  assert.equal(slotDots(0, 1), "○");
  assert.equal(slotDots(4, 4), "●●●●");
  assert.equal(slotDots(5, 2), "●●");
});

test("the free slots count the training house's trainer slot too", () => {
  assert.equal(freeSlotsText(building({ jobs: [job(), job()] })), "1 slot free");
  assert.equal(freeSlotsText(building({ jobs: [] })), "3 slots free");
  assert.equal(freeSlotsText(building({ jobs: [job(), job(), job()] })), "");
  assert.equal(freeSlotsText(building({ id: "trainingHouse", slots: 1, jobs: [job()] })), "1 slot free");
});

test("short durations", () => {
  assert.equal(shortDuration(45 * 60_000), "45 min");
  assert.equal(shortDuration(12 * 3_600_000), "12 h");
  assert.equal(shortDuration(2.5 * 3_600_000), "2 h 30 min");
});

test("a character is named short in the dropdowns, with a class bonus where it has one", () => {
  assert.equal(characterLabel(character({ class: "tank", rank: 2 })), "Bram - tank R2 · Lv 1");
  assert.equal(classBonusText(character({ class: "tank" }), "quarry", false), " (+50% tank)");
  assert.equal(classBonusText(character({ class: "tank" }), "woodcutter", false), "");
  assert.equal(classBonusText(character({ class: "caster" }), "trainingHouse", true), "");
});

test("a job is one compact row per building", () => {
  const bram = character();
  assert.equal(jobText(job(), "woodcutter", bram, "21:40"), "Bram · 6 wood/h · 12 so far · done 21:40");
  assert.equal(
    jobText(job({ perHour: 30, earnedSoFar: 60 }), "trainingHouse", bram, "21:40"),
    "Bram · 30 XP/h (×3) · 60 so far · done 21:40",
  );
  assert.equal(jobText(job({ trainer: true }), "trainingHouse", bram, "21:40"), "Bram · trainer · done 21:40");
  assert.equal(jobText(job({ perHour: 4 }), "medicalBay", bram, "21:40"), "Bram · Healing ×4 · done 21:40");
  assert.equal(jobText(job(), "pub", bram, "21:40"), "Bram · done 21:40");
  assert.equal(
    jobText(job({ sale: { resource: "wood", amount: 10, silver: 30 } }), "market", bram, "21:40"),
    "Bram · sells 10 wood for 30 silver · done 21:40",
  );
  assert.equal(jobText(job({ perHour: 20 }), "tradingPost", bram, "21:40"), "Bram · prices −4% · done 21:40");
  assert.equal(jobText(job({ perHour: 3 }), "recruitingOffice", bram, "21:40"), "Bram · recruits 3 · done 21:40");
  assert.equal(
    jobText(job({ perHour: 9 }), "quarry", character({ class: "tank" }), "21:40"),
    "Bram · 9 stone/h (+50% tank) · 12 so far · done 21:40",
  );
  assert.equal(jobText(job({ number: 7 }), "woodcutter", undefined, "21:40"), "Character 7 · 6 wood/h · 12 so far · done 21:40");
});

test("the tile's status: what it gives now, the next job to finish, or idle", () => {
  assert.equal(statusText(building(), at), "idle");
  assert.equal(statusText(building({ jobs: [job({ perHour: 6 }), job({ perHour: 12 })] }), at), "+18 wood/h");
  assert.equal(
    statusText(building({ id: "trainingHouse", jobs: [job({ trainer: true, perHour: 0 }), job({ perHour: 30 })] }), at),
    "+30 XP/h",
  );
  assert.equal(statusText(building({ id: "trainingHouse", jobs: [job({ trainer: true })] }), at), "trainer, no trainees");
  assert.equal(statusText(building({ id: "medicalBay", slots: 1, jobs: [job({ perHour: 4 })] }), at), "Healing ×4");
  assert.equal(statusText(building({ id: "tavern", slots: 1 }), at), "idle");
  assert.equal(
    statusText(building({ id: "tradingPost", jobs: [job({ perHour: 10, doneInMs: 900 }), job({ perHour: 20, doneInMs: 500 })] }), at),
    "prices −4% at t+500",
  );
  assert.equal(
    statusText(building({ id: "market", jobs: [job({ sale: { resource: "stone", amount: 10, silver: 30 }, doneInMs: 5 })] }), at),
    "+30 silver at t+5",
  );
  assert.equal(statusText(building({ id: "recruitingOffice", jobs: [job({ perHour: 1, doneInMs: 5 })] }), at), "+1 recruit at t+5");
  assert.equal(statusText(building({ id: "pub", jobs: [job({ doneInMs: 5 })] }), at), "done t+5");
});
