// The village (design.md, The village; issue #295): the rules in village.ts
// with a database of their own, and the HTTP API with a real server.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { xpForLevel } from "../shared/rules/advancement.ts";
import { DUNGEONS } from "../shared/rules/dungeon-map.ts";
import { REST_MINUTES } from "../shared/rules/rest.ts";
import { HOUR_MS } from "../shared/rules/village.ts";
import { charactersOfAccount, insertCharacter, newCharacterData } from "./characters.ts";
import { migrate, openDatabase, type Db } from "./database.ts";
import { recordFirstWin } from "./dungeons-won.ts";
import { startTestServer } from "./test-helpers.ts";
import {
  buildingsOf,
  hasVillage,
  jobsOf,
  resourcesOf,
  settleJobs,
  startJob,
  takeOut,
  unlockVillage,
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
