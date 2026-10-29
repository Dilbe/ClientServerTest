// The village (design.md, The village; issue #295): each account's
// buildings, its wood and stone, and the characters working in a building.
//
// Nothing here runs on a timer. A job is stored with when it started and
// when it ends, and everything else is worked out from those whenever it is
// needed: like storing a DateTime in a table and comparing it with "now" in
// a query, instead of a timer per job in a Windows service. Finished jobs
// pay out the next time the account's village or resources are read
// (`settleJobs`), which can be long after they ended: what they earned
// doesn't depend on when that happens.
//
// The client never says that a job is done or what it earned: anyone can
// send any request to the server, so a client that could would get free
// wood.

import { levelFromXp } from "../shared/rules/advancement.ts";
import { restAfterDungeon, restAfterWork, restState } from "../shared/rules/rest.ts";
import {
  BUILDING_IDS,
  BUILDINGS,
  earned,
  earnedPerHour,
  jobLengthMs,
  STARTING_BUILDINGS,
  type BuildingId,
  type ResourceId,
} from "../shared/rules/village.ts";
import { characterOfAccount } from "./characters.ts";
import type { Db } from "./database.ts";

/**
 * Adding to a resource, one fixed statement per resource. A column name
 * can't be a `?` parameter, and building the SQL from a string is how SQL
 * injection starts, even when the string looks safe today.
 */
const ADD_RESOURCE: Record<ResourceId, string> = {
  wood: "UPDATE accounts SET wood = wood + ? WHERE id = ?",
  stone: "UPDATE accounts SET stone = stone + ? WHERE id = ?",
};

export interface Resources {
  wood: number;
  stone: number;
}

/** Whether the account has the village: it has buildings. */
export function hasVillage(db: Db, accountId: number): boolean {
  return db.prepare("SELECT 1 FROM buildings WHERE account_id = ? LIMIT 1").get(accountId) !== undefined;
}

/**
 * Gives the account the village with its starting buildings at level 1
 * (design.md, Getting the village). Giving it again changes nothing: a
 * building the account has already keeps its level. An account deleted
 * meanwhile gets nothing, as for the other rewards.
 */
export function unlockVillage(db: Db, accountId: number): void {
  const insert = db.prepare(
    `INSERT INTO buildings (account_id, building_id, level)
     SELECT id, ?, 1 FROM accounts WHERE id = ?
     ON CONFLICT DO NOTHING`,
  );
  for (const building of STARTING_BUILDINGS) insert.run(building, accountId);
}

/** The account's wood and stone, or none when the account doesn't exist. */
export function resourcesOf(db: Db, accountId: number): Resources {
  const row = db.prepare("SELECT wood, stone FROM accounts WHERE id = ?").get(accountId) as Resources | undefined;
  return row ?? { wood: 0, stone: 0 };
}

/** The account's buildings with their level, in the order of BUILDING_IDS. Unknown ids are left out. */
export function buildingsOf(db: Db, accountId: number): { id: BuildingId; level: number }[] {
  const rows = db.prepare("SELECT building_id, level FROM buildings WHERE account_id = ?").all(accountId) as {
    building_id: string;
    level: number;
  }[];
  return BUILDING_IDS.flatMap((id) => {
    const row = rows.find((r) => r.building_id === id);
    return row ? [{ id, level: row.level }] : [];
  });
}

export interface Job {
  /** The character record's id. */
  characterId: number;
  building: BuildingId;
  perHour: number;
  startedAt: number;
  endsAt: number;
}

/** The account's jobs that haven't paid out yet, finished or not. */
export function jobsOf(db: Db, accountId: number): Job[] {
  const rows = db
    .prepare(
      `SELECT character_id AS characterId, building_id AS building, per_hour AS perHour,
              started_at AS startedAt, ends_at AS endsAt
       FROM village_jobs WHERE account_id = ? ORDER BY started_at, character_id`,
    )
    .all(accountId) as Job[];
  // A building id that is no longer a building can't reach a client.
  return rows.filter((job) => (BUILDING_IDS as readonly string[]).includes(job.building));
}

/**
 * Pays out every job of the account that has ended: what it earned is added
 * to the account and the job is removed. The character's rest after the job
 * was already set when it started. One transaction, so a crash can't pay a
 * job without removing it, which would pay it twice.
 *
 * Called before the account's village or resources are read or changed,
 * and before a character is used up for a rank-up: removing the character
 * also removes its job (ON DELETE CASCADE), with its earnings.
 */
export function settleJobs(db: Db, accountId: number, now: number): void {
  db.transaction(() => {
    const ended = db
      .prepare(
        `SELECT character_id AS characterId, building_id AS building, per_hour AS perHour,
                started_at AS startedAt, ends_at AS endsAt
         FROM village_jobs WHERE account_id = ? AND ends_at <= ?`,
      )
      .all(accountId, now) as Job[];
    for (const job of ended) payOut(db, accountId, job, job.endsAt);
  })();
}

export type StartJobResult =
  | { ok: true }
  | { ok: false; reason: "no-village" | "no-such-character" | "not-ready" | "building-full" };

/**
 * Puts one of the account's characters to work in one of its buildings
 * (design.md, Working in a building). The job lasts 1 hour per level of the
 * character and earns 1 per rank per full hour; both are worked out here.
 * Only a character that isn't working, healing or resting can start, and
 * only while the building has a free slot. Whether it is in a party or a
 * game is checked by the caller, which knows the games.
 *
 * Its rest after the job is set now, from the end of the job, so the lobby
 * and the character page know when it is ready without asking the village.
 */
export function startJob(
  db: Db,
  accountId: number,
  number: number,
  building: BuildingId,
  now: number,
): StartJobResult {
  return db.transaction((): StartJobResult => {
    settleJobs(db, accountId, now);
    const level = buildingsOf(db, accountId).find((b) => b.id === building)?.level;
    if (level === undefined) return { ok: false, reason: "no-village" };
    // Looked up by this account and its number: someone else's character
    // simply isn't found.
    const character = characterOfAccount(db, accountId, number);
    if (!character) return { ok: false, reason: "no-such-character" };
    if (restState(character.rest, now) !== "ready") return { ok: false, reason: "not-ready" };
    // After settling, every job left is still running.
    const working = jobsOf(db, accountId).filter((job) => job.building === building).length;
    if (working >= BUILDINGS[building].slots(level)) return { ok: false, reason: "building-full" };

    const { xp, class: classId, rank } = character.data;
    const endsAt = now + jobLengthMs(levelFromXp(xp, classId, rank));
    db.prepare(
      `INSERT INTO village_jobs (character_id, account_id, building_id, per_hour, started_at, ends_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(character.id, accountId, building, earnedPerHour(rank), now, endsAt);
    setRest(db, character.id, restAfterWork(rank, endsAt));
    return { ok: true };
  })();
}

export type TakeOutResult = { ok: true; earned: number } | { ok: false; reason: "no-such-character" | "not-working" };

/**
 * Takes one of the account's characters out of its building before its job
 * is done (design.md, Working in a building). It keeps what it earned in
 * the full hours it worked, and starts its normal rest now.
 */
export function takeOut(db: Db, accountId: number, number: number, now: number): TakeOutResult {
  return db.transaction((): TakeOutResult => {
    settleJobs(db, accountId, now);
    const character = characterOfAccount(db, accountId, number);
    if (!character) return { ok: false, reason: "no-such-character" };
    const job = jobsOf(db, accountId).find((j) => j.characterId === character.id);
    if (!job) return { ok: false, reason: "not-working" };
    const paid = payOut(db, accountId, job, now);
    setRest(db, character.id, restAfterDungeon(character.data.rank, false, now));
    return { ok: true, earned: paid };
  })();
}

/** Adds what a job earned until `until` to the account and removes the job. Returns what it paid. */
function payOut(db: Db, accountId: number, job: Job, until: number): number {
  const amount = earned(job.perHour, job.startedAt, Math.min(until, job.endsAt));
  // A job in a building that no longer exists pays nothing, but is removed.
  const building = BUILDINGS[job.building as BuildingId] as (typeof BUILDINGS)[BuildingId] | undefined;
  if (building && amount > 0) db.prepare(ADD_RESOURCE[building.resource]).run(amount, accountId);
  db.prepare("DELETE FROM village_jobs WHERE character_id = ?").run(job.characterId);
  return building ? amount : 0;
}

function setRest(db: Db, characterId: number, rest: { healingUntil: number; restingUntil: number }): void {
  db.prepare("UPDATE characters SET healing_until = ?, resting_until = ? WHERE id = ?").run(
    rest.healingUntil,
    rest.restingUntil,
    characterId,
  );
}
