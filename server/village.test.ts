// The village (design.md, The village; issue #295): the rules in village.ts
// with a database of their own, and the HTTP API with a real server.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { maxXp, xpForLevel } from "../shared/rules/advancement.ts";
import type { ClassId } from "../shared/rules/classes.ts";
import { DUNGEONS } from "../shared/rules/dungeon-map.ts";
import { REST_MINUTES, restAfterDungeon } from "../shared/rules/rest.ts";
import { HOUR_MS } from "../shared/rules/village.ts";
import { addDungeonResult, charactersOfAccount, insertCharacter, newCharacterData } from "./characters.ts";
import { migrate, openDatabase, type Db } from "./database.ts";
import { recordFirstWin } from "./dungeons-won.ts";
import { startTestServer } from "./test-helpers.ts";
import {
  buildBuilding,
  buildingsOf,
  hasVillage,
  jobsOf,
  resourcesOf,
  settleJobs,
  startJob,
  takeOut,
  unlockVillage,
  upgradeBuilding,
} from "./village.ts";

const MINUTE = 60_000;

function addAccount(db: Db, name: string): number {
  return Number(
    db
      .prepare(
        `INSERT INTO accounts (account_name, account_name_key, display_name, password_hash, created_at)
         VALUES (?, ?, ?, 'not a real hash', 0)`,
      )
      .run(name, name, name).lastInsertRowid,
  );
}

/** An account with the village and one character of this rank and level, number 1. */
function villageWith(rank: number, level: number): { db: Db; accountId: number } {
  const db = openDatabase(":memory:");
  const accountId = addAccount(db, "ann");
  insertCharacter(db, accountId, 0, { ...newCharacterData(), rank, xp: xpForLevel(level) });
  unlockVillage(db, accountId);
  return { db, accountId };
}

const character = (db: Db, accountId: number, number = 1) =>
  charactersOfAccount(db, accountId).find((c) => c.number === number)!;

test("the first win of Tessa's Lair on Normal gives the village, with a woodcutter and a quarry at level 1", () => {
  const db = openDatabase(":memory:");
  const ann = addAccount(db, "ann");
  assert.equal(hasVillage(db, ann), false);
  assert.deepEqual(buildingsOf(db, ann), []);
  recordFirstWin(db, ann, "tessasLair", "normal", DUNGEONS.tessasLair.oneTimeRewards.normal, 0);
  assert.equal(hasVillage(db, ann), true);
  assert.deepEqual(buildingsOf(db, ann), [
    { id: "woodcutter", level: 1 },
    { id: "quarry", level: 1 },
  ]);
  // Giving it again keeps the buildings as they are.
  db.prepare("UPDATE buildings SET level = 3 WHERE account_id = ? AND building_id = 'quarry'").run(ann);
  unlockVillage(db, ann);
  assert.deepEqual(buildingsOf(db, ann), [
    { id: "woodcutter", level: 1 },
    { id: "quarry", level: 3 },
  ]);
});

test("players who won Tessa's Lair before the village existed get it with the migration", () => {
  const db = new Database(":memory:");
  migrate(db, 13);
  const ann = addAccount(db, "ann");
  const ben = addAccount(db, "ben");
  const insert = db.prepare("INSERT INTO dungeons_won (account_id, dungeon_id, difficulty) VALUES (?, ?, ?)");
  insert.run(ann, "tessasLair", "normal");
  insert.run(ann, "tessasLair", "hard");
  insert.run(ben, "archersGallery", "normal");

  migrate(db);

  assert.deepEqual(buildingsOf(db, ann), [
    { id: "woodcutter", level: 1 },
    { id: "quarry", level: 1 },
  ]);
  assert.equal(hasVillage(db, ben), false);
});

test("a job lasts 1 hour per level, then the character rests; it pays rank × hours when it has ended", () => {
  const { db, accountId } = villageWith(2, 10);
  assert.deepEqual(startJob(db, accountId, 1, "woodcutter", 1000), { ok: true });
  const end = 1000 + 10 * HOUR_MS;
  assert.deepEqual(character(db, accountId).rest, {
    workingUntil: end,
    healingUntil: 0,
    restingUntil: end + REST_MINUTES[2]! * MINUTE,
  });
  assert.equal(character(db, accountId).workplace, "woodcutter");

  // Not done yet: nothing paid.
  settleJobs(db, accountId, end - 1);
  assert.deepEqual(resourcesOf(db, accountId), { wood: 0, stone: 0 });
  // Done: 2 wood for each of the 10 hours, whenever it is settled.
  settleJobs(db, accountId, end + 5 * HOUR_MS);
  assert.deepEqual(resourcesOf(db, accountId), { wood: 20, stone: 0 });
  assert.deepEqual(jobsOf(db, accountId), []);
  // Settling again pays nothing more.
  settleJobs(db, accountId, end + 6 * HOUR_MS);
  assert.deepEqual(resourcesOf(db, accountId), { wood: 20, stone: 0 });
  // Its rest still started at the end of the job.
  assert.deepEqual(character(db, accountId).rest, { healingUntil: 0, restingUntil: end + 30 * MINUTE });
});

test("the quarry pays stone", () => {
  const { db, accountId } = villageWith(3, 1);
  assert.deepEqual(startJob(db, accountId, 1, "quarry", 0), { ok: true });
  settleJobs(db, accountId, HOUR_MS);
  assert.deepEqual(resourcesOf(db, accountId), { wood: 0, stone: 3 });
});

test("taken out early, a character keeps what it earned in its full hours and starts its rest at once", () => {
  const { db, accountId } = villageWith(2, 10);
  startJob(db, accountId, 1, "woodcutter", 0);
  const now = 3.5 * HOUR_MS;
  assert.deepEqual(takeOut(db, accountId, 1, now), { ok: true, earned: 6 });
  assert.deepEqual(resourcesOf(db, accountId), { wood: 6, stone: 0 });
  assert.deepEqual(character(db, accountId).rest, { healingUntil: 0, restingUntil: now + 30 * MINUTE });
  assert.equal(character(db, accountId).workplace, null);
  // It isn't working any more.
  assert.deepEqual(takeOut(db, accountId, 1, now), { ok: false, reason: "not-working" });
});

test("only a ready character can start, only in a building of the village, and only in a free slot", () => {
  const { db, accountId } = villageWith(1, 5);
  insertCharacter(db, accountId, 0);
  insertCharacter(db, accountId, 0);
  const ben = addAccount(db, "ben");

  // Without the village: no buildings.
  assert.deepEqual(startJob(db, ben, 1, "woodcutter", 0), { ok: false, reason: "no-village" });
  // Someone else's number isn't found: Ben has no characters.
  unlockVillage(db, ben);
  assert.deepEqual(startJob(db, ben, 1, "woodcutter", 0), { ok: false, reason: "no-such-character" });

  assert.deepEqual(startJob(db, accountId, 1, "woodcutter", 0), { ok: true });
  // Already working.
  assert.deepEqual(startJob(db, accountId, 1, "quarry", 0), { ok: false, reason: "not-ready" });
  // The woodcutter has 1 slot at level 1.
  assert.deepEqual(startJob(db, accountId, 2, "woodcutter", 0), { ok: false, reason: "building-full" });
  // Resting after a dungeon.
  db.prepare("UPDATE characters SET resting_until = ? WHERE account_id = ? AND number = 3").run(MINUTE, accountId);
  assert.deepEqual(startJob(db, accountId, 3, "quarry", 0), { ok: false, reason: "not-ready" });
  assert.deepEqual(startJob(db, accountId, 3, "quarry", MINUTE), { ok: true });

  // Once the first job has ended (level 5: 5 hours), its slot is free again.
  assert.deepEqual(startJob(db, accountId, 2, "woodcutter", 5 * HOUR_MS), { ok: true });
  // Both ended jobs have paid out: 5 hours of rank 1 wood, 1 hour of rank 1 stone.
  assert.deepEqual(resourcesOf(db, accountId), { wood: 5, stone: 1 });
});

function setResources(db: Db, accountId: number, wood: number, stone: number, silver: number): void {
  db.prepare("UPDATE accounts SET wood = ?, stone = ?, silver = ? WHERE id = ?").run(wood, stone, silver, accountId);
}

const silverOf = (db: Db, accountId: number) =>
  db.prepare("SELECT silver FROM accounts WHERE id = ?").pluck().get(accountId) as number;

test("an upgrade takes its cost and raises the level by one, which opens one more slot (issue #296)", () => {
  const { db, accountId } = villageWith(1, 5);
  insertCharacter(db, accountId, 0);
  setResources(db, accountId, 30, 25, 10);
  assert.deepEqual(upgradeBuilding(db, accountId, "woodcutter", 1, 0), { ok: true });
  assert.deepEqual(buildingsOf(db, accountId)[0], { id: "woodcutter", level: 2 });
  // Level 2 cost 25 stone.
  assert.deepEqual(resourcesOf(db, accountId), { wood: 30, stone: 0 });
  assert.equal(silverOf(db, accountId), 10);
  // Two characters fit now.
  assert.deepEqual(startJob(db, accountId, 1, "woodcutter", 0), { ok: true });
  assert.deepEqual(startJob(db, accountId, 2, "woodcutter", 0), { ok: true });
});

test("without enough of every part of the cost nothing is taken and the level stays", () => {
  const { db, accountId } = villageWith(1, 1);
  db.prepare("UPDATE buildings SET level = 2 WHERE account_id = ?").run(accountId);
  // Level 3 of the quarry costs 100 wood, 40 stone and 25 silver: 1 silver short.
  setResources(db, accountId, 500, 500, 24);
  assert.deepEqual(upgradeBuilding(db, accountId, "quarry", 2, 0), { ok: false, reason: "not-enough" });
  assert.deepEqual(resourcesOf(db, accountId), { wood: 500, stone: 500 });
  assert.equal(silverOf(db, accountId), 24);
  assert.equal(buildingsOf(db, accountId)[1]!.level, 2);
});

test("a second request for the same level buys nothing, and a building stops at its max level", () => {
  const { db, accountId } = villageWith(1, 1);
  setResources(db, accountId, 10_000, 10_000, 10_000);
  assert.deepEqual(upgradeBuilding(db, accountId, "quarry", 1, 0), { ok: true });
  // A double click: the second request still says level 1.
  assert.deepEqual(upgradeBuilding(db, accountId, "quarry", 1, 0), { ok: false, reason: "not-at-level" });
  assert.deepEqual(resourcesOf(db, accountId), { wood: 10_000 - 25, stone: 10_000 });

  for (const level of [2, 3, 4]) assert.deepEqual(upgradeBuilding(db, accountId, "quarry", level, 0), { ok: true });
  assert.deepEqual(upgradeBuilding(db, accountId, "quarry", 5, 0), { ok: false, reason: "max-level" });
  assert.equal(buildingsOf(db, accountId)[1]!.level, 5);
  // 25 + 100 + 300 + 1000 wood, 40 + 100 + 500 stone, 25 + 75 + 150 silver.
  assert.deepEqual(resourcesOf(db, accountId), { wood: 10_000 - 1425, stone: 10_000 - 640 });
  assert.equal(silverOf(db, accountId), 10_000 - 250);
});

test("a finished job pays out before an upgrade, so its earnings count towards the cost", () => {
  const { db, accountId } = villageWith(5, 5);
  setResources(db, accountId, 0, 0, 0);
  startJob(db, accountId, 1, "quarry", 0);
  assert.deepEqual(upgradeBuilding(db, accountId, "woodcutter", 1, HOUR_MS), { ok: false, reason: "not-enough" });
  // 5 hours of rank 5 stone: 25, just enough.
  assert.deepEqual(upgradeBuilding(db, accountId, "woodcutter", 1, 5 * HOUR_MS), { ok: true });
  assert.deepEqual(resourcesOf(db, accountId), { wood: 0, stone: 0 });
});

test("without the village there is nothing to upgrade", () => {
  const db = openDatabase(":memory:");
  const ann = addAccount(db, "ann");
  assert.deepEqual(upgradeBuilding(db, ann, "woodcutter", 1, 0), { ok: false, reason: "no-building" });
});

// ---- Building, and the training house (issue #297) ----

test("the training house has to be built: it costs 15 wood and 15 stone, once", () => {
  const db = openDatabase(":memory:");
  const ann = addAccount(db, "ann");
  assert.deepEqual(buildBuilding(db, ann, "trainingHouse", 0), { ok: false, reason: "no-village" });
  unlockVillage(db, ann);
  setResources(db, ann, 15, 14, 0);
  assert.deepEqual(buildBuilding(db, ann, "trainingHouse", 0), { ok: false, reason: "not-enough" });
  assert.deepEqual(startJob(db, ann, 1, "trainingHouse", 0), { ok: false, reason: "no-village" });
  setResources(db, ann, 20, 20, 0);
  assert.deepEqual(buildBuilding(db, ann, "trainingHouse", 0), { ok: true });
  assert.deepEqual(buildingsOf(db, ann)[2], { id: "trainingHouse", level: 1 });
  assert.deepEqual(resourcesOf(db, ann), { wood: 5, stone: 5 });
  // A double click: the second one finds it built and pays nothing.
  assert.deepEqual(buildBuilding(db, ann, "trainingHouse", 0), { ok: false, reason: "already-built" });
  assert.deepEqual(resourcesOf(db, ann), { wood: 5, stone: 5 });
  // The village starts with the others: they can't be built.
  assert.deepEqual(buildBuilding(db, ann, "woodcutter", 0), { ok: false, reason: "already-built" });
});

/** An account with the village and a level 1 training house, without characters. */
function trainingHouse(): { db: Db; accountId: number } {
  const db = openDatabase(":memory:");
  const accountId = addAccount(db, "ann");
  unlockVillage(db, accountId);
  db.prepare("INSERT INTO buildings (account_id, building_id, level) VALUES (?, 'trainingHouse', 1)").run(accountId);
  return { db, accountId };
}

/** Adds a character and returns its number. */
function addCharacter(db: Db, accountId: number, classId: ClassId, rank: number, xp = 0): number {
  insertCharacter(db, accountId, 0, { ...newCharacterData(), class: classId, rank, xp });
  return charactersOfAccount(db, accountId).length;
}

const xpOf = (db: Db, accountId: number, number: number) => character(db, accountId, number).data.xp;

test("a trainee gains 10 XP for every full hour of a 24-hour job, and rests after it", () => {
  const { db, accountId } = trainingHouse();
  const ann = addCharacter(db, accountId, "adventurer", 3);
  assert.deepEqual(startJob(db, accountId, ann, "trainingHouse", 0), { ok: true });
  assert.deepEqual(character(db, accountId, ann).rest, {
    workingUntil: 24 * HOUR_MS,
    healingUntil: 0,
    restingUntil: 24 * HOUR_MS + REST_MINUTES[3]! * MINUTE,
  });
  settleJobs(db, accountId, 24 * HOUR_MS - 1);
  assert.equal(xpOf(db, accountId, ann), 0);
  settleJobs(db, accountId, 30 * HOUR_MS);
  assert.equal(xpOf(db, accountId, ann), 240);
  assert.deepEqual(jobsOf(db, accountId), []);
  // The wood and stone don't change.
  assert.deepEqual(resourcesOf(db, accountId), { wood: 0, stone: 0 });
});

test("taken out early, a trainee keeps the XP of its full hours", () => {
  const { db, accountId } = trainingHouse();
  const ann = addCharacter(db, accountId, "adventurer", 2);
  startJob(db, accountId, ann, "trainingHouse", 0);
  assert.deepEqual(takeOut(db, accountId, ann, 2.5 * HOUR_MS), { ok: true, earned: 20 });
  assert.equal(xpOf(db, accountId, ann), 20);
  assert.deepEqual(character(db, accountId, ann).rest, { healingUntil: 0, restingUntil: 2.5 * HOUR_MS + 30 * MINUTE });
});

test("training stops at the max level, and a character already there can't train", () => {
  const { db, accountId } = trainingHouse();
  // Rank 1, 10 XP short of level 10.
  const ann = addCharacter(db, accountId, "adventurer", 1, maxXp("adventurer", 1) - 10);
  const ben = addCharacter(db, accountId, "adventurer", 1, maxXp("adventurer", 1));
  assert.deepEqual(startJob(db, accountId, ben, "trainingHouse", 0), { ok: false, reason: "max-level" });
  startJob(db, accountId, ann, "trainingHouse", 0);
  settleJobs(db, accountId, 24 * HOUR_MS);
  assert.equal(xpOf(db, accountId, ann), maxXp("adventurer", 1));
});

test("the trainer gains no XP and speeds up lower ranks by +100% per rank of difference", () => {
  const { db, accountId } = trainingHouse();
  db.prepare("UPDATE buildings SET level = 3 WHERE account_id = ? AND building_id = 'trainingHouse'").run(accountId);
  // Level 24: it stays as long as the trainees.
  const trainer = addCharacter(db, accountId, "adventurer", 4, xpForLevel(24));
  const rank2 = addCharacter(db, accountId, "adventurer", 2);
  const rank3 = addCharacter(db, accountId, "adventurer", 3);
  const rank4 = addCharacter(db, accountId, "adventurer", 4);
  assert.deepEqual(startJob(db, accountId, trainer, "trainingHouse", 0, true), { ok: true });
  for (const number of [rank2, rank3, rank4]) {
    assert.deepEqual(startJob(db, accountId, number, "trainingHouse", 0), { ok: true });
  }
  settleJobs(db, accountId, 24 * HOUR_MS);
  assert.equal(xpOf(db, accountId, trainer), xpForLevel(24));
  assert.equal(xpOf(db, accountId, rank2), 3 * 240);
  assert.equal(xpOf(db, accountId, rank3), 2 * 240);
  assert.equal(xpOf(db, accountId, rank4), 240);
  // The trainer stayed 24 hours too, and rests after it.
  assert.equal(character(db, accountId, trainer).rest.restingUntil, 24 * HOUR_MS + REST_MINUTES[4]! * MINUTE);
});

test("an advanced class counts 5 ranks higher, and only trains adventurers and its own class", () => {
  const { db, accountId } = trainingHouse();
  db.prepare("UPDATE buildings SET level = 4 WHERE account_id = ? AND building_id = 'trainingHouse'").run(accountId);
  const trainer = addCharacter(db, accountId, "tank", 3);
  const adventurer = addCharacter(db, accountId, "adventurer", 5);
  const tank = addCharacter(db, accountId, "tank", 1);
  const higherTank = addCharacter(db, accountId, "tank", 4);
  const caster = addCharacter(db, accountId, "caster", 1);
  startJob(db, accountId, trainer, "trainingHouse", 0, true);
  for (const number of [adventurer, tank, higherTank, caster]) startJob(db, accountId, number, "trainingHouse", 0);
  const perHour = (number: number) =>
    jobsOf(db, accountId).find((job) => job.characterId === character(db, accountId, number).id)!.perHour;
  // Rank 3 tank: counts as 8.
  assert.equal(perHour(adventurer), 40);
  assert.equal(perHour(tank), 30);
  assert.equal(perHour(higherTank), 10);
  assert.equal(perHour(caster), 10);
});

test("an adventurer never speeds up an advanced class", () => {
  const { db, accountId } = trainingHouse();
  const trainer = addCharacter(db, accountId, "adventurer", 5);
  const tank = addCharacter(db, accountId, "tank", 1);
  startJob(db, accountId, trainer, "trainingHouse", 0, true);
  startJob(db, accountId, tank, "trainingHouse", 0);
  settleJobs(db, accountId, 24 * HOUR_MS);
  assert.equal(xpOf(db, accountId, tank), 240);
});

test("the trainer stays 1 hour per level of its own", () => {
  const { db, accountId } = trainingHouse();
  const trainer = addCharacter(db, accountId, "adventurer", 2, xpForLevel(7));
  startJob(db, accountId, trainer, "trainingHouse", 0, true);
  assert.equal(character(db, accountId, trainer).rest.workingUntil, 7 * HOUR_MS);
});

test("a trainer that comes later only speeds up the time after it came", () => {
  const { db, accountId } = trainingHouse();
  const trainee = addCharacter(db, accountId, "adventurer", 2);
  const trainer = addCharacter(db, accountId, "adventurer", 4, xpForLevel(22));
  startJob(db, accountId, trainee, "trainingHouse", 0);
  // From 2.5 hours on, 20 XP an hour on top of the normal 10.
  startJob(db, accountId, trainer, "trainingHouse", 2.5 * HOUR_MS, true);
  settleJobs(db, accountId, 30 * HOUR_MS);
  assert.equal(xpOf(db, accountId, trainee), 240 + 21.5 * 20);
});

test("when time runs out, the trainer bonus counts exactly, rounded up", () => {
  const { db, accountId } = trainingHouse();
  db.prepare("UPDATE buildings SET level = 2 WHERE account_id = ? AND building_id = 'trainingHouse'").run(accountId);
  const first = addCharacter(db, accountId, "adventurer", 2);
  const second = addCharacter(db, accountId, "adventurer", 2);
  const trainer = addCharacter(db, accountId, "adventurer", 4, xpForLevel(1));
  startJob(db, accountId, first, "trainingHouse", 0);
  startJob(db, accountId, second, "trainingHouse", 23 * HOUR_MS);
  // A level 1 trainer, from 23:40 to 24:40.
  const comes = 23 * HOUR_MS + 40 * MINUTE;
  startJob(db, accountId, trainer, "trainingHouse", comes, true);
  settleJobs(db, accountId, 50 * HOUR_MS);
  // The first one's job ends after 20 minutes of it: 20 × 20 / 60 = 6.67, rounded up.
  assert.equal(xpOf(db, accountId, first), 240 + 7);
  // The trainer's job ends after an hour: exactly 20.
  assert.equal(xpOf(db, accountId, second), 240 + 20);
});

test("a trainer or trainee taken out early gets the trainer bonus of full hours only", () => {
  const { db, accountId } = trainingHouse();
  db.prepare("UPDATE buildings SET level = 2 WHERE account_id = ? AND building_id = 'trainingHouse'").run(accountId);
  const first = addCharacter(db, accountId, "adventurer", 2);
  const second = addCharacter(db, accountId, "adventurer", 2);
  const trainer = addCharacter(db, accountId, "adventurer", 3, xpForLevel(10));
  const nextTrainer = addCharacter(db, accountId, "adventurer", 4, xpForLevel(24));
  startJob(db, accountId, trainer, "trainingHouse", 0, true);
  startJob(db, accountId, first, "trainingHouse", 0);
  // Taken out after 3.5 hours: the trainer earns nothing, and its bonus of
  // 10 XP an hour counts 3 full hours.
  assert.deepEqual(takeOut(db, accountId, trainer, 3.5 * HOUR_MS), { ok: true, earned: 0 });
  // A rank 4, level 24 trainer comes after 4 hours, until 28 hours.
  startJob(db, accountId, nextTrainer, "trainingHouse", 4 * HOUR_MS, true);
  startJob(db, accountId, second, "trainingHouse", 12 * HOUR_MS);
  // The second one is taken out after 2.5 hours with the trainer: 2 full hours of bonus.
  assert.deepEqual(takeOut(db, accountId, second, 14.5 * HOUR_MS), { ok: true, earned: 20 + 40 });
  // Settled long after the rest, in one go, in the order the jobs ended.
  settleJobs(db, accountId, 100 * HOUR_MS);
  // First: 240 normal XP, 3 × 10 bonus from the first trainer, 20 hours × 20 from the second.
  assert.equal(xpOf(db, accountId, first), 240 + 30 + 400);
});

test("a trainer whose job ends first slows the trainees down from then on", () => {
  const { db, accountId } = trainingHouse();
  const trainee = addCharacter(db, accountId, "adventurer", 2);
  const trainer = addCharacter(db, accountId, "adventurer", 4, xpForLevel(5));
  startJob(db, accountId, trainer, "trainingHouse", 0, true);
  startJob(db, accountId, trainee, "trainingHouse", 2 * HOUR_MS);
  // Seen again only after both have ended: 3 hours with the trainer, 21 without.
  settleJobs(db, accountId, 100 * HOUR_MS);
  assert.equal(xpOf(db, accountId, trainee), 240 + 3 * 20);
});

test("the trainer slot is one, besides the training slots, and only in the training house", () => {
  const { db, accountId } = trainingHouse();
  const a = addCharacter(db, accountId, "adventurer", 3);
  const b = addCharacter(db, accountId, "adventurer", 3);
  const c = addCharacter(db, accountId, "adventurer", 1);
  const d = addCharacter(db, accountId, "adventurer", 1);
  assert.deepEqual(startJob(db, accountId, a, "woodcutter", 0, true), { ok: false, reason: "no-trainer-slot" });
  assert.deepEqual(startJob(db, accountId, a, "trainingHouse", 0, true), { ok: true });
  assert.deepEqual(startJob(db, accountId, b, "trainingHouse", 0, true), { ok: false, reason: "building-full" });
  assert.deepEqual(startJob(db, accountId, c, "trainingHouse", 0), { ok: true });
  // Level 1: one training slot.
  assert.deepEqual(startJob(db, accountId, d, "trainingHouse", 0), { ok: false, reason: "building-full" });
});

// ---- The medical bay and the tavern (issue #298) ----

/** An account with the village, a medical bay and a tavern, without characters. */
function restBuildings(): { db: Db; accountId: number } {
  const db = openDatabase(":memory:");
  const accountId = addAccount(db, "ann");
  unlockVillage(db, accountId);
  for (const id of ["medicalBay", "tavern"]) {
    db.prepare("INSERT INTO buildings (account_id, building_id, level) VALUES (?, ?, 1)").run(accountId, id);
  }
  return { db, accountId };
}

/** Gives a character the rest of a dungeon that ended at `endedAt`. */
function setDungeonRest(db: Db, accountId: number, number: number, died: boolean, endedAt: number): void {
  const { id, data } = character(db, accountId, number);
  const rest = restAfterDungeon(data.rank, died, endedAt);
  db.prepare("UPDATE characters SET healing_until = ?, resting_until = ? WHERE id = ?").run(
    rest.healingUntil,
    rest.restingUntil,
    id,
  );
}

test("the medical bay and the tavern cost what issue #298 says, and have one slot and no upgrades", () => {
  const { db, accountId } = (() => {
    const db = openDatabase(":memory:");
    const accountId = addAccount(db, "ann");
    unlockVillage(db, accountId);
    return { db, accountId };
  })();
  setResources(db, accountId, 1500, 1500, 500);
  assert.deepEqual(buildBuilding(db, accountId, "medicalBay", 0), { ok: true });
  assert.deepEqual(resourcesOf(db, accountId), { wood: 1000, stone: 500 });
  assert.deepEqual(buildBuilding(db, accountId, "tavern", 0), { ok: true });
  assert.deepEqual(resourcesOf(db, accountId), { wood: 0, stone: 0 });
  assert.deepEqual(upgradeBuilding(db, accountId, "tavern", 1, 0), { ok: false, reason: "max-level" });
  const a = addCharacter(db, accountId, "adventurer", 1);
  const b = addCharacter(db, accountId, "adventurer", 1);
  assert.deepEqual(startJob(db, accountId, a, "tavern", 0), { ok: true });
  assert.deepEqual(startJob(db, accountId, b, "tavern", 0), { ok: false, reason: "building-full" });
});

test("the hero stays 1 hour per level, earns nothing, and rests afterwards", () => {
  const { db, accountId } = restBuildings();
  const hero = addCharacter(db, accountId, "adventurer", 2, xpForLevel(4));
  assert.deepEqual(startJob(db, accountId, hero, "medicalBay", 0), { ok: true });
  assert.equal(jobsOf(db, accountId)[0]!.perHour, 3);
  assert.deepEqual(character(db, accountId, hero).rest, {
    workingUntil: 4 * HOUR_MS,
    healingUntil: 0,
    restingUntil: 4 * HOUR_MS + REST_MINUTES[2]! * MINUTE,
  });
  settleJobs(db, accountId, 10 * HOUR_MS);
  assert.deepEqual(jobsOf(db, accountId), []);
  assert.deepEqual(resourcesOf(db, accountId), { wood: 0, stone: 0 });
});

test("a tavern hero speeds up resting that is running already, +100% per rank", () => {
  const { db, accountId } = restBuildings();
  const resting = addCharacter(db, accountId, "adventurer", 4);
  const hero = addCharacter(db, accountId, "adventurer", 3, xpForLevel(10));
  // 90 minutes of rest from 0; the rank 3 hero comes after 10 minutes: ×4.
  setDungeonRest(db, accountId, resting, false, 0);
  startJob(db, accountId, hero, "tavern", 10 * MINUTE);
  // The 80 minutes left take 20.
  assert.equal(character(db, accountId, resting).rest.restingUntil, 30 * MINUTE);
});

test("a medical bay hero speeds up only the healing; an advanced class counts 5 ranks higher", () => {
  const { db, accountId } = restBuildings();
  const dead = addCharacter(db, accountId, "adventurer", 3);
  const hero = addCharacter(db, accountId, "tank", 1, xpForLevel(10));
  setDungeonRest(db, accountId, dead, true, 0);
  // A rank 1 tank counts as rank 6: ×7. 60 minutes of healing take about 8.6.
  startJob(db, accountId, hero, "medicalBay", 0);
  const healed = Math.ceil((60 * MINUTE) / 7);
  assert.deepEqual(character(db, accountId, dead).rest, {
    healingUntil: healed,
    restingUntil: healed + 60 * MINUTE,
  });
});

test("a speed-up ends when the hero's job ends: after that the rest goes at the normal speed", () => {
  const { db, accountId } = restBuildings();
  const resting = addCharacter(db, accountId, "adventurer", 5);
  // A rank 1, level 1 hero: ×2 for 1 hour.
  const hero = addCharacter(db, accountId, "adventurer", 1, xpForLevel(1));
  setDungeonRest(db, accountId, resting, false, 0);
  startJob(db, accountId, hero, "tavern", 0);
  // 2 hours of rest: the hour at ×2 does all of it.
  assert.equal(character(db, accountId, resting).rest.restingUntil, HOUR_MS);

  const later = addCharacter(db, accountId, "adventurer", 5);
  // A rest that starts at 30 minutes: 30 minutes ×2 does 1 hour, then 1 hour at the normal speed.
  addDungeonResult(db, character(db, accountId, later).id, { xp: 0, died: false }, 30 * MINUTE);
  assert.equal(character(db, accountId, later).rest.restingUntil, 2 * HOUR_MS);
  // The job ending by time changes nothing more.
  settleJobs(db, accountId, 3 * HOUR_MS);
  assert.equal(character(db, accountId, later).rest.restingUntil, 2 * HOUR_MS);
});

test("taking the hero out early ends the speed-up at once", () => {
  const { db, accountId } = restBuildings();
  const dead = addCharacter(db, accountId, "adventurer", 4);
  const hero = addCharacter(db, accountId, "adventurer", 2, xpForLevel(10));
  setDungeonRest(db, accountId, dead, true, 0);
  // ×3 from 0: 90 minutes of healing take 30.
  startJob(db, accountId, hero, "medicalBay", 0);
  assert.equal(character(db, accountId, dead).rest.healingUntil, 30 * MINUTE);
  // Out after 10 minutes, which did 30 minutes' worth: 60 minutes of healing left.
  assert.deepEqual(takeOut(db, accountId, hero, 10 * MINUTE), { ok: true, earned: 0 });
  assert.deepEqual(character(db, accountId, dead).rest, {
    healingUntil: 70 * MINUTE,
    restingUntil: 160 * MINUTE,
  });
  // The hero rests as usual, from now.
  assert.equal(character(db, accountId, hero).rest.restingUntil, 10 * MINUTE + REST_MINUTES[2]! * MINUTE);
});

test("a worker's rest after its job is sped up when it falls in the tavern hero's time", () => {
  const { db, accountId } = restBuildings();
  const worker = addCharacter(db, accountId, "adventurer", 2, xpForLevel(1));
  const hero = addCharacter(db, accountId, "adventurer", 1, xpForLevel(10));
  // The worker works until 1 hour, then rests 30 minutes.
  startJob(db, accountId, worker, "woodcutter", 0);
  // The hero, ×2 until 10 hours, comes later: the rest after the job takes 15 minutes.
  startJob(db, accountId, hero, "tavern", 5 * MINUTE);
  assert.deepEqual(character(db, accountId, worker).rest, {
    workingUntil: HOUR_MS,
    healingUntil: 0,
    restingUntil: HOUR_MS + 15 * MINUTE,
  });
});

// ---- The HTTP API ----

const server = await startTestServer();
after(() => server.close());

const body = (response: Response): Promise<any> => response.json();

function accountIdOf(displayName: string): number {
  return server.db.prepare("SELECT id FROM accounts WHERE display_name = ?").pluck().get(displayName) as number;
}

test("without the village, the page says so and no job can start", async () => {
  const cookie = await server.signup("vic", "Vic");
  const page = await body(await server.get("/api/village", cookie));
  assert.equal(page.unlocked, false);
  assert.deepEqual(page.buildings, []);
  assert.equal(page.characters.length, 3);
  const response = await server.post("/api/village/start-job", { building: "woodcutter", number: 1 }, cookie);
  assert.equal(response.status, 409);
  assert.equal((await server.get("/api/village")).status, 401);
});

test("a job started through the API shows on the village page, the character page and in the lobby", async () => {
  const cookie = await server.signup("wes", "Wes");
  unlockVillage(server.db, accountIdOf("Wes"));

  const response = await server.post("/api/village/start-job", { building: "quarry", number: 2 }, cookie);
  assert.equal(response.status, 200);
  const page = await body(response);
  assert.equal(page.unlocked, true);
  const quarry = page.buildings.find((b: { id: string }) => b.id === "quarry");
  assert.equal(quarry.slots, 1);
  assert.equal(quarry.jobs.length, 1);
  assert.equal(quarry.jobs[0].number, 2);
  assert.equal(quarry.jobs[0].perHour, 1);
  // A level 1 character: 1 hour.
  assert.ok(quarry.jobs[0].doneInMs > HOUR_MS - MINUTE && quarry.jobs[0].doneInMs <= HOUR_MS);

  const characters = (await body(await server.get("/api/characters", cookie))).characters;
  assert.equal(characters[1].workplace, "quarry");
  assert.ok(characters[1].workDoneInMs > 0);
  // Its rest of 5 minutes comes after the job.
  assert.ok(characters[1].readyInMs > characters[1].workDoneInMs + 4 * MINUTE);

  // The lobby refuses to take it into a dungeon.
  const socket = await server.connect(cookie);
  const lobby = await socket.nextOf("lobby");
  assert.equal(lobby.yourCharacters[1].workplace, "quarry");
  socket.ws.send(JSON.stringify({ type: "create-game", characters: [2] }));
  assert.match((await socket.nextOf("refused")).reason, /still working/);

  // A character that isn't working can't be taken out.
  const notWorking = await server.post("/api/village/take-out", { number: 1 }, cookie);
  assert.equal(notWorking.status, 409);
  socket.ws.close();
});

test("taking a character out through the API frees its slot", async () => {
  const cookie = await server.signup("xia", "Xia");
  unlockVillage(server.db, accountIdOf("Xia"));
  await server.post("/api/village/start-job", { building: "woodcutter", number: 1 }, cookie);
  const full = await server.post("/api/village/start-job", { building: "woodcutter", number: 2 }, cookie);
  assert.equal(full.status, 409);
  assert.equal((await body(full)).error, "The woodcutter has no free slot.");

  const response = await server.post("/api/village/take-out", { number: 1 }, cookie);
  assert.equal(response.status, 200);
  const page = await body(response);
  assert.deepEqual(page.buildings[0].jobs, []);
  // Less than an hour: nothing earned.
  assert.equal(page.wood, 0);
  assert.equal((await server.post("/api/village/start-job", { building: "woodcutter", number: 2 }, cookie)).status, 200);
});

test("a finished job pays out when the player is next seen, and shows in the wood total", async () => {
  const cookie = await server.signup("yan", "Yan");
  const accountId = accountIdOf("Yan");
  unlockVillage(server.db, accountId);
  await server.post("/api/village/start-job", { building: "woodcutter", number: 3 }, cookie);
  // As if it started two hours ago: a level 1 job has ended.
  server.db
    .prepare("UPDATE village_jobs SET started_at = started_at - ?, ends_at = ends_at - ? WHERE account_id = ?")
    .run(2 * HOUR_MS, 2 * HOUR_MS, accountId);
  const me = await body(await server.get("/api/me", cookie));
  assert.deepEqual([me.village, me.wood, me.stone], [true, 1, 0]);
});

test("a character in a party can't go to work, and a working one can't be ranked up", async () => {
  const cookie = await server.signup("zed", "Zed");
  const accountId = accountIdOf("Zed");
  unlockVillage(server.db, accountId);
  const socket = await server.connect(cookie);
  socket.ws.send(JSON.stringify({ type: "create-game", characters: [1] }));
  while ((await socket.nextOf("lobby")).myGame === null);
  const inParty = await server.post("/api/village/start-job", { building: "woodcutter", number: 1 }, cookie);
  assert.equal(inParty.status, 409);
  socket.ws.close();

  // Two max-level characters, one of them working.
  server.db.prepare("UPDATE characters SET data = json_set(data, '$.xp', ?) WHERE account_id = ?").run(
    xpForLevel(10),
    accountId,
  );
  assert.equal((await server.post("/api/village/start-job", { building: "quarry", number: 2 }, cookie)).status, 200);
  const rankUp = await server.post("/api/characters/rank-up", { first: 2, second: 3 }, cookie);
  assert.equal(rankUp.status, 409);
  assert.match((await body(rankUp)).error, /works in the village/);
});

test("requests name only known buildings and whole character numbers", async () => {
  const cookie = await server.signup("amy", "Amy");
  for (const request of [{ building: "castle", number: 1 }, { building: "woodcutter", number: 1.5 }, { building: "woodcutter" }]) {
    assert.equal((await server.post("/api/village/start-job", request, cookie)).status, 400);
  }
  assert.equal((await server.post("/api/village/take-out", { number: -1 }, cookie)).status, 400);
});

test("upgrading through the API: the page shows the new level and slots, and the silver it cost", async () => {
  const cookie = await server.signup("bea", "Bea");
  const accountId = accountIdOf("Bea");
  unlockVillage(server.db, accountId);
  setResources(server.db, accountId, 100, 100, 30);
  const before = await body(await server.get("/api/village", cookie));
  assert.equal(before.silver, 30);

  const response = await server.post("/api/village/upgrade", { building: "woodcutter", level: 1 }, cookie);
  assert.equal(response.status, 200);
  const page = await body(response);
  assert.deepEqual([page.buildings[0].level, page.buildings[0].slots], [2, 2]);
  assert.deepEqual([page.wood, page.stone, page.silver], [100, 75, 30]);

  const again = await server.post("/api/village/upgrade", { building: "woodcutter", level: 1 }, cookie);
  assert.equal(again.status, 409);
  assert.equal((await body(again)).error, "The woodcutter isn't at level 1 any more.");
  // Level 3 needs 40 wood, 100 stone and 25 silver: only 75 stone left.
  const poor = await server.post("/api/village/upgrade", { building: "woodcutter", level: 2 }, cookie);
  assert.equal(poor.status, 409);
  assert.equal((await body(poor)).error, "You don't have enough to upgrade the woodcutter.");

  // The client never names a price: a request with one is still only the building and the level.
  const cheap = await server.post("/api/village/upgrade", { building: "quarry", level: 1, cost: { wood: 0 } }, cookie);
  assert.equal(cheap.status, 200);
  assert.equal((await body(cheap)).wood, 75);

  assert.equal((await server.post("/api/village/upgrade", { building: "woodcutter", level: 2 })).status, 401);
  for (const request of [{ building: "castle", level: 1 }, { building: "quarry", level: 0 }, { building: "quarry" }]) {
    assert.equal((await server.post("/api/village/upgrade", request, cookie)).status, 400);
  }
});

test("building the training house and training through the API (issue #297)", async () => {
  const cookie = await server.signup("cal", "Cal");
  const accountId = accountIdOf("Cal");
  unlockVillage(server.db, accountId);
  setResources(server.db, accountId, 20, 20, 0);
  const before = await body(await server.get("/api/village", cookie));
  assert.deepEqual(before.unbuilt, ["trainingHouse", "medicalBay", "tavern"]);

  const built = await body(await server.post("/api/village/build", { building: "trainingHouse" }, cookie));
  assert.deepEqual(built.unbuilt, ["medicalBay", "tavern"]);
  assert.deepEqual([built.wood, built.stone], [5, 5]);
  const again = await server.post("/api/village/build", { building: "trainingHouse" }, cookie);
  assert.equal(again.status, 409);
  assert.equal((await body(again)).error, "You have a training house already.");

  // The starting characters are rank 1: make the trainer rank 3.
  server.db
    .prepare("UPDATE characters SET data = json_set(data, '$.rank', 3, '$.xp', ?) WHERE account_id = ? AND number = 1")
    .run(xpForLevel(10), accountId);
  const asTrainer = { building: "trainingHouse", number: 1, trainer: true };
  assert.equal((await server.post("/api/village/start-job", asTrainer, cookie)).status, 200);
  const page = await body(await server.post("/api/village/start-job", { building: "trainingHouse", number: 2 }, cookie));
  const house = page.buildings.find((b: { id: string }) => b.id === "trainingHouse");
  assert.deepEqual(
    house.jobs.map((j: { number: number; trainer: boolean; perHour: number; earnedSoFar: number }) => [
      j.number,
      j.trainer,
      j.perHour,
      j.earnedSoFar,
    ]),
    [
      [1, true, 0, 0],
      [2, false, 30, 0],
    ],
  );
  assert.ok(house.jobs[1].doneInMs > 24 * HOUR_MS - MINUTE);

  // As if it started 5 hours ago: 150 XP so far.
  server.db
    .prepare(
      `UPDATE village_jobs SET started_at = started_at - ?, counted_from = counted_from - ?, ends_at = ends_at - ?
       WHERE account_id = ?`,
    )
    .run(5 * HOUR_MS, 5 * HOUR_MS, 5 * HOUR_MS, accountId);
  const later = await body(await server.get("/api/village", cookie));
  assert.equal(later.buildings[2].jobs[1].earnedSoFar, 150);

  assert.equal((await server.post("/api/village/build", { building: "castle" }, cookie)).status, 400);
  assert.equal((await server.post("/api/village/build", { building: "trainingHouse" })).status, 401);
});
