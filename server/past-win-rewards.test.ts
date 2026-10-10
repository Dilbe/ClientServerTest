// The one-time upgrade of characters for Hard and Heroic wins from before
// issue #155 (past-win-rewards.ts), run as a migration step.

import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { levelFromXp, xpForLevel } from "../shared/rules/advancement.ts";
import { charactersOfAccount, insertCharacter, newCharacterData, type CharacterData } from "./characters.ts";
import { migrate, type Db } from "./database.ts";

/** A database as the version before issue #155 left it: 8 steps. */
function oldDatabase(): Db {
  const db = new Database(":memory:");
  migrate(db, 8);
  return db;
}

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

/** Adds a character of this rank and level, with anything else in `more`. */
function addCharacter(db: Db, accountId: number, rank: number, level: number, more: Partial<CharacterData> = {}): void {
  insertCharacter(db, accountId, 0, { ...newCharacterData(), rank, xp: xpForLevel(level), ...more });
}

function addWins(db: Db, accountId: number, difficulty: string, dungeonIds: string[]): void {
  const insert = db.prepare("INSERT INTO dungeons_won (account_id, dungeon_id, difficulty) VALUES (?, ?, ?)");
  for (const dungeonId of dungeonIds) insert.run(accountId, dungeonId, difficulty);
}

/** Each character as "number: rank/level". */
function summary(db: Db, accountId: number): string[] {
  return charactersOfAccount(db, accountId).map((c) => `${c.number}: ${c.data.rank}/${levelFromXp(c.data.xp, c.data.rank)}`);
}

test("per Hard win, the rank 1 character with the lowest level becomes a level 1, rank 2 character", () => {
  const db = oldDatabase();
  const ann = addAccount(db, "ann");
  addCharacter(db, ann, 1, 8);
  addCharacter(db, ann, 1, 3);
  addCharacter(db, ann, 1, 1);
  addWins(db, ann, "hard", ["first", "second"]);

  migrate(db);

  assert.deepEqual(summary(db, ann), ["1: 1/8", "2: 2/1", "3: 2/1"]);
});

test("an upgraded character starts at level 1 without upgrades, and keeps its name, class and kills", () => {
  const db = oldDatabase();
  const ann = addAccount(db, "ann");
  addCharacter(db, ann, 1, 5, {
    name: "Runner",
    upgrades: [{ stat: "hitPoints", paid: 2 }],
    kills: { first: { normal: [3, 1] } },
  });
  addWins(db, ann, "hard", ["first"]);

  migrate(db);

  const [character] = charactersOfAccount(db, ann);
  assert.deepEqual(character!.data, {
    version: 7,
    name: "Runner",
    class: "adventurer",
    rank: 2,
    xp: 0,
    upgrades: [],
    kills: { first: { normal: [3, 1] } },
  });
});

test("of equally low characters, the newest is picked", () => {
  const db = oldDatabase();
  const ann = addAccount(db, "ann");
  addCharacter(db, ann, 1, 1);
  addCharacter(db, ann, 1, 1);
  addCharacter(db, ann, 1, 1);
  addWins(db, ann, "hard", ["first"]);

  migrate(db);

  assert.deepEqual(summary(db, ann), ["1: 1/1", "2: 1/1", "3: 2/1"]);
});

test("per Heroic win, the lowest rank, then the lowest level, below rank 3 becomes a level 1, rank 3 character", () => {
  const db = oldDatabase();
  const ann = addAccount(db, "ann");
  addCharacter(db, ann, 4, 1); // never picked: it would go down
  addCharacter(db, ann, 2, 1);
  addCharacter(db, ann, 1, 9);
  addCharacter(db, ann, 1, 4);
  addWins(db, ann, "heroic", ["first", "second"]);

  migrate(db);

  // The rank 1 characters first, the lower level first.
  assert.deepEqual(summary(db, ann), ["1: 4/1", "2: 2/1", "3: 3/1", "4: 3/1"]);
});

test("Heroic wins go first, and no character is upgraded twice", () => {
  const db = oldDatabase();
  const ann = addAccount(db, "ann");
  addCharacter(db, ann, 1, 2);
  addCharacter(db, ann, 1, 1);
  addCharacter(db, ann, 1, 6);
  addWins(db, ann, "heroic", ["first"]);
  addWins(db, ann, "hard", ["first", "second"]);

  migrate(db);

  // Heroic takes the lowest (2), then Hard the next two (1, then 3).
  assert.deepEqual(summary(db, ann), ["1: 2/1", "2: 3/1", "3: 2/1"]);
});

test("when no character fits, the account gets a new level 1 character of that rank", () => {
  const db = oldDatabase();
  const ann = addAccount(db, "ann");
  addCharacter(db, ann, 2, 4); // all rank 1 characters were ranked up
  addWins(db, ann, "hard", ["first"]);
  addWins(db, ann, "heroic", ["first", "second"]);

  migrate(db);

  // Heroic upgrades the rank 2 and adds one; Hard finds no rank 1 and adds one.
  assert.deepEqual(summary(db, ann), ["1: 3/1", "2: 3/1", "3: 2/1"]);
});

test("Normal wins and accounts without wins change nothing", () => {
  const db = oldDatabase();
  const ann = addAccount(db, "ann");
  const ben = addAccount(db, "ben");
  addCharacter(db, ann, 1, 1);
  addCharacter(db, ben, 1, 1);
  addWins(db, ann, "normal", ["first", "second"]);

  migrate(db);

  assert.deepEqual(summary(db, ann), ["1: 1/1"]);
  assert.deepEqual(summary(db, ben), ["1: 1/1"]);
});

test("each account is upgraded for its own wins only", () => {
  const db = oldDatabase();
  const ann = addAccount(db, "ann");
  const ben = addAccount(db, "ben");
  addCharacter(db, ann, 1, 1);
  addCharacter(db, ben, 1, 1);
  addWins(db, ann, "hard", ["first"]);

  migrate(db);

  assert.deepEqual(summary(db, ann), ["1: 2/1"]);
  assert.deepEqual(summary(db, ben), ["1: 1/1"]);
});
