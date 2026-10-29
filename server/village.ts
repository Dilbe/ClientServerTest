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
// The training house (issue #297) adds a trainer, whose coming and going
// changes how fast the trainees train: see `retrain`.
//
// The client never says that a job is done or what it earned: anyone can
// send any request to the server, so a client that could would get free
// wood.

import { levelFromXp, maxXp } from "../shared/rules/advancement.ts";
import { restAfterDungeon, restAfterWork, restState } from "../shared/rules/rest.ts";
import {
  BUILDING_IDS,
  BUILDINGS,
  earned,
  earnedPerHour,
  fullHoursEnd,
  jobLengthMs,
  STARTING_BUILDINGS,
  trainedXp,
  trainingXpPerHour,
  upgradeCost,
  type BuildingId,
  type Cost,
  type ResourceId,
} from "../shared/rules/village.ts";
import { addXp, characterOfAccount, charactersOfAccount, type CharacterData } from "./characters.ts";
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
  /** Whether it is the training house's trainer, which earns nothing itself. */
  trainer: boolean;
  /** What it earns per (full) hour now. A trainee's changes with the trainer. */
  perHour: number;
  startedAt: number;
  endsAt: number;
  /** A trainee's: since when `perHour` counts. Before that, its XP is in `credited`. */
  countedFrom: number;
  /** A trainee's: the XP of the time before `countedFrom`, not yet given to the character. */
  credited: number;
}

const JOB_COLUMNS = `character_id AS characterId, building_id AS building, trainer, per_hour AS perHour,
  started_at AS startedAt, ends_at AS endsAt, counted_from AS countedFrom, credited`;

/** SQLite has no booleans: the trainer column is 0 or 1. */
function toJob(row: Omit<Job, "trainer"> & { trainer: number }): Job {
  return { ...row, trainer: row.trainer === 1 };
}

/** The account's jobs that haven't paid out yet, finished or not. */
export function jobsOf(db: Db, accountId: number): Job[] {
  const rows = db
    .prepare(`SELECT ${JOB_COLUMNS} FROM village_jobs WHERE account_id = ? ORDER BY started_at, character_id`)
    .all(accountId) as (Omit<Job, "trainer"> & { trainer: number })[];
  // A building id that is no longer a building can't reach a client.
  return rows.map(toJob).filter((job) => (BUILDING_IDS as readonly string[]).includes(job.building));
}

/**
 * What a job has earned until `until`, as it would pay out then: the full
 * hours so far, or all of it once it has ended. For a trainee the XP before
 * the full hours, which may count part of an hour (see `retrain`), and
 * before the character's max level is reached: `addXp` stops it there.
 */
export function jobEarned(job: Job, until: number): number {
  const building = BUILDINGS[job.building] as (typeof BUILDINGS)[BuildingId] | undefined;
  if (!building) return 0;
  if (building.earns !== "xp") return earned(job.perHour, job.startedAt, Math.min(until, job.endsAt));
  if (job.trainer) return 0;
  const end = until >= job.endsAt ? job.endsAt : Math.max(job.countedFrom, fullHoursEnd(job.startedAt, until));
  return job.credited + trainedXp(job.perHour, job.countedFrom, end);
}

/**
 * Pays out every job of the account that has ended: what it earned is added
 * to the account (or, in the training house, to the character) and the job
 * is removed. The character's rest after the job was already set when it
 * started. One transaction, so a crash can't pay a job without removing it,
 * which would pay it twice.
 *
 * The jobs pay out one at a time, in the order they ended: a trainer that
 * ended slows its trainees down from that moment, which changes what a
 * trainee that ended later earned. So each job is read again after the one
 * before it.
 *
 * Called before the account's village, characters or resources are read or
 * changed, and before a character is used up for a rank-up: removing the
 * character also removes its job (ON DELETE CASCADE), with its earnings.
 */
export function settleJobs(db: Db, accountId: number, now: number): void {
  db.transaction(() => {
    const next = db.prepare(
      `SELECT ${JOB_COLUMNS} FROM village_jobs WHERE account_id = ? AND ends_at <= ?
       ORDER BY ends_at, character_id LIMIT 1`,
    );
    for (;;) {
      const row = next.get(accountId, now) as (Omit<Job, "trainer"> & { trainer: number }) | undefined;
      if (!row) break;
      const job = toJob(row);
      payOut(db, accountId, job, job.endsAt, now);
      if (job.trainer) retrain(db, accountId, job.endsAt);
    }
  })();
}

export type StartJobResult =
  | { ok: true }
  | {
      ok: false;
      reason: "no-village" | "no-such-character" | "not-ready" | "building-full" | "no-trainer-slot" | "max-level";
    };

/**
 * Puts one of the account's characters to work in one of its buildings
 * (design.md, Working in a building), or in the training house's trainer
 * slot when `asTrainer`. How long the job lasts and what it earns are worked
 * out here. Only a character that isn't working, healing or resting can
 * start, and only while the building has a free slot. A character at its
 * max level can't train: it would gain nothing. Whether it is in a party
 * or a game is checked by the caller, which knows the games.
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
  asTrainer = false,
): StartJobResult {
  return db.transaction((): StartJobResult => {
    settleJobs(db, accountId, now);
    const level = buildingsOf(db, accountId).find((b) => b.id === building)?.level;
    if (level === undefined) return { ok: false, reason: "no-village" };
    const rules = BUILDINGS[building];
    if (asTrainer && !rules.trainerSlot) return { ok: false, reason: "no-trainer-slot" };
    // Looked up by this account and its number: someone else's character
    // simply isn't found.
    const character = characterOfAccount(db, accountId, number);
    if (!character) return { ok: false, reason: "no-such-character" };
    if (restState(character.rest, now) !== "ready") return { ok: false, reason: "not-ready" };
    // After settling, every job left is still running.
    const jobs = jobsOf(db, accountId).filter((job) => job.building === building);
    const taken = jobs.filter((job) => job.trainer === asTrainer).length;
    if (taken >= (asTrainer ? 1 : rules.slots(level))) return { ok: false, reason: "building-full" };

    const { xp, class: classId, rank } = character.data;
    const training = rules.earns === "xp" && !asTrainer;
    if (training && xp >= maxXp(classId, rank)) return { ok: false, reason: "max-level" };
    const perHour = asTrainer
      ? 0
      : training
        ? trainingXpPerHour(trainerOf(db, accountId, jobs), character.data)
        : earnedPerHour(rank);
    const endsAt = now + jobLengthMs(building, levelFromXp(xp, classId, rank));
    db.prepare(
      `INSERT INTO village_jobs (character_id, account_id, building_id, trainer, per_hour, started_at, ends_at, counted_from)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(character.id, accountId, building, asTrainer ? 1 : 0, perHour, now, endsAt, now);
    setRest(db, character.id, restAfterWork(rank, endsAt));
    if (asTrainer) retrain(db, accountId, now);
    return { ok: true };
  })();
}

export type TakeOutResult = { ok: true; earned: number } | { ok: false; reason: "no-such-character" | "not-working" };

/**
 * Takes one of the account's characters out of its building before its job
 * is done (design.md, Working in a building). It keeps what it earned in
 * the full hours it worked, and starts its normal rest now. A trainer
 * taken out slows its trainees down from now on.
 */
export function takeOut(db: Db, accountId: number, number: number, now: number): TakeOutResult {
  return db.transaction((): TakeOutResult => {
    settleJobs(db, accountId, now);
    const character = characterOfAccount(db, accountId, number);
    if (!character) return { ok: false, reason: "no-such-character" };
    const job = jobsOf(db, accountId).find((j) => j.characterId === character.id);
    if (!job) return { ok: false, reason: "not-working" };
    const paid = payOut(db, accountId, job, now, now);
    if (job.trainer) retrain(db, accountId, now);
    setRest(db, character.id, restAfterDungeon(character.data.rank, false, now));
    return { ok: true, earned: paid };
  })();
}

/**
 * Sets every trainee's speed to what the trainer gives it now, at `at`
 * (design.md, The training house): a trainer has just come or gone. The XP
 * of the time before is worked out at the old speed and kept in `credited`,
 * rounded down to whole XP, and the new speed counts from `at`. So a
 * trainer slotted for the last minute only speeds up that minute.
 */
function retrain(db: Db, accountId: number, at: number): void {
  const jobs = jobsOf(db, accountId).filter((job) => BUILDINGS[job.building].earns === "xp");
  const trainer = trainerOf(db, accountId, jobs);
  const characters = charactersOfAccount(db, accountId);
  const update = db.prepare(
    "UPDATE village_jobs SET credited = ?, counted_from = ?, per_hour = ? WHERE character_id = ?",
  );
  for (const job of jobs) {
    if (job.trainer) continue;
    const trainee = characters.find((c) => c.id === job.characterId);
    if (!trainee) continue;
    const until = Math.min(at, job.endsAt);
    update.run(
      job.credited + trainedXp(job.perHour, job.countedFrom, until),
      Math.max(job.countedFrom, until),
      trainingXpPerHour(trainer, trainee.data),
      job.characterId,
    );
  }
}

/** The character in the trainer slot among these jobs, or null. */
function trainerOf(db: Db, accountId: number, jobs: readonly Job[]): CharacterData | null {
  const job = jobs.find((j) => j.trainer);
  if (!job) return null;
  return charactersOfAccount(db, accountId).find((c) => c.id === job.characterId)?.data ?? null;
}

export type BuildResult = { ok: true } | { ok: false; reason: "no-village" | "already-built" | "not-enough" };

/**
 * Builds one of the buildings the village doesn't start with, at level 1
 * (design.md, Building and upgrading; issue #297). As for an upgrade, the
 * price comes from the shared rules and paying and building are one
 * transaction. A second click finds it built already and pays nothing.
 */
export function buildBuilding(db: Db, accountId: number, building: BuildingId, now: number): BuildResult {
  return db.transaction((): BuildResult => {
    settleJobs(db, accountId, now);
    if (!hasVillage(db, accountId)) return { ok: false, reason: "no-village" };
    const cost = BUILDINGS[building].buildCost;
    const built = buildingsOf(db, accountId).some((b) => b.id === building);
    if (!cost || built) return { ok: false, reason: "already-built" };
    if (!pay(db, accountId, cost)) return { ok: false, reason: "not-enough" };
    db.prepare("INSERT INTO buildings (account_id, building_id, level) VALUES (?, ?, 1)").run(accountId, building);
    return { ok: true };
  })();
}

export type UpgradeResult =
  | { ok: true }
  | { ok: false; reason: "no-building" | "not-at-level" | "max-level" | "not-enough" };

/**
 * Upgrades one of the account's buildings from `level` to the next level
 * (design.md, Building and upgrading; issue #296). `level` is the level the
 * player saw: a building that is no longer at it isn't upgraded, so the
 * second click of a double click buys nothing.
 *
 * The price comes from the shared rules, never from the request. Checking
 * the resources, taking them and raising the level are one transaction:
 * either all of it happens or none of it (see `pay`).
 */
export function upgradeBuilding(
  db: Db,
  accountId: number,
  building: BuildingId,
  level: number,
  now: number,
): UpgradeResult {
  return db.transaction((): UpgradeResult => {
    // Ended jobs pay out first: their wood and stone count towards the price.
    settleJobs(db, accountId, now);
    const current = buildingsOf(db, accountId).find((b) => b.id === building)?.level;
    if (current === undefined) return { ok: false, reason: "no-building" };
    if (current !== level) return { ok: false, reason: "not-at-level" };
    const cost = upgradeCost(building, level);
    if (!cost) return { ok: false, reason: "max-level" };
    if (!pay(db, accountId, cost)) return { ok: false, reason: "not-enough" };
    db.prepare("UPDATE buildings SET level = level + 1 WHERE account_id = ? AND building_id = ?").run(
      accountId,
      building,
    );
    return { ok: true };
  })();
}

/**
 * Takes a cost from the account, if it has enough of all three. One UPDATE
 * that only changes the row when there is enough, as for buying an
 * adventurer, so the check and the payment can't be split. Returns whether
 * it paid.
 *
 * Two requests can't run through this at the same time anyway: better-sqlite3
 * is synchronous, and Node runs one piece of JavaScript at a time. That is
 * different from a .NET service, where two requests on two threads could
 * both read "enough wood" before either writes; the single UPDATE would
 * still be safe there.
 */
function pay(db: Db, accountId: number, cost: Cost): boolean {
  const paid = db
    .prepare(
      `UPDATE accounts SET wood = wood - ?, stone = stone - ?, silver = silver - ?
       WHERE id = ? AND wood >= ? AND stone >= ? AND silver >= ?`,
    )
    .run(cost.wood, cost.stone, cost.silver, accountId, cost.wood, cost.stone, cost.silver);
  return paid.changes > 0;
}

/**
 * Adds what a job earned until `until` to the account, or as XP to the
 * character, and removes the job. Returns what it paid: for XP, what the
 * character actually gained, which stops at its max level.
 */
function payOut(db: Db, accountId: number, job: Job, until: number, now: number): number {
  const amount = jobEarned(job, until);
  // A job in a building that no longer exists pays nothing, but is removed.
  const building = BUILDINGS[job.building] as (typeof BUILDINGS)[BuildingId] | undefined;
  let paid = 0;
  if (building && amount > 0) {
    if (building.earns === "xp") {
      paid = addXp(db, job.characterId, amount, now);
    } else {
      db.prepare(ADD_RESOURCE[building.earns]).run(amount, accountId);
      paid = amount;
    }
  }
  db.prepare("DELETE FROM village_jobs WHERE character_id = ?").run(job.characterId);
  return paid;
}

function setRest(db: Db, characterId: number, rest: { healingUntil: number; restingUntil: number }): void {
  db.prepare("UPDATE characters SET healing_until = ?, resting_until = ? WHERE id = ?").run(
    rest.healingUntil,
    rest.restingUntil,
    characterId,
  );
}
