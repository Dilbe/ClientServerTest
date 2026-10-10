// The wins per dungeon per difficulty in the database (design.md, Unlocking
// dungeons). What the wins unlock is tested in shared/rules/difficulties.test.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { levelFromXp, xpForLevel } from "../shared/rules/advancement.ts";
import { migrate, openDatabase, type Db } from "./database.ts";
import { dungeonWinsOf, hasWon, recordFirstWin } from "./dungeons-won.ts";
import { charactersOfAccount } from "./characters.ts";

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

test("wins from before difficulties existed count as Normal", () => {
  // A database as the version before difficulties left it: 5 steps.
  const db = new Database(":memory:");
  migrate(db, 5);
  const ann = addAccount(db, "ann");
  const insert = db.prepare("INSERT INTO dungeons_won (account_id, dungeon_id) VALUES (?, ?)");
  insert.run(ann, "first");
  insert.run(ann, "second");

  migrate(db);

  assert.deepEqual(dungeonWinsOf(db, ann), [
    { dungeonId: "first", difficulty: "normal" },
    { dungeonId: "second", difficulty: "normal" },
  ]);
  assert.equal(hasWon(db, ann, "first", "normal"), true);
  assert.equal(hasWon(db, ann, "first", "hard"), false);
});

test("a dungeon is won once per difficulty, each with its own one-time rewards", () => {
  const db = openDatabase(":memory:");
  const ann = addAccount(db, "ann");
  const characters = () => db.prepare("SELECT COUNT(*) FROM characters WHERE account_id = ?").pluck().get(ann);
  const reward = { type: "newCharacter", class: "adventurer", rank: 1, level: 1 } as const;
  recordFirstWin(db, ann, "first", "normal", [reward], 0);
  recordFirstWin(db, ann, "first", "hard", [reward], 0);
  // Again on Hard: already won there, so nothing more.
  recordFirstWin(db, ann, "first", "hard", [reward], 0);
  assert.equal(characters(), 2);
  // Sorted by difficulty, then by dungeon, whatever order they were won in.
  recordFirstWin(db, ann, "second", "normal", [], 0);
  assert.deepEqual(dungeonWinsOf(db, ann), [
    { dungeonId: "first", difficulty: "normal" },
    { dungeonId: "second", difficulty: "normal" },
    { dungeonId: "first", difficulty: "hard" },
  ]);
});

test("ids that are no longer a dungeon or a difficulty are left out", () => {
  const db = openDatabase(":memory:");
  const ann = addAccount(db, "ann");
  const insert = db.prepare("INSERT INTO dungeons_won (account_id, dungeon_id, difficulty) VALUES (?, ?, ?)");
  insert.run(ann, "first", "normal");
  insert.run(ann, "gone", "normal");
  insert.run(ann, "first", "nightmare");
  assert.deepEqual(dungeonWinsOf(db, ann), [{ dungeonId: "first", difficulty: "normal" }]);
});

test("a new character reward gives exactly the class, rank and level it names", () => {
  const db = openDatabase(":memory:");
  const ann = addAccount(db, "ann");

  recordFirstWin(db, ann, "first", "heroic", [{ type: "newCharacter", class: "adventurer", rank: 3, level: 5 }], 0);

  const [character] = charactersOfAccount(db, ann);
  assert.equal(character!.data.class, "adventurer");
  assert.equal(character!.data.rank, 3);
  // The XP level 5 needs, and no upgrades yet: its points are there to spend.
  assert.equal(character!.data.xp, xpForLevel(5));
  assert.equal(levelFromXp(character!.data.xp, 3), 5);
  assert.deepEqual(character!.data.upgrades, []);
});
