// The copy made before migrations, and restoring it (architecture.md,
// Database updates and Rolling back). These use real files in a temporary
// folder: a copy of an in-memory database can't be made or restored.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import {
  copyFileName,
  copyInDataFolder,
  migrate,
  openDatabase,
  restoreDatabase,
  restoreOnStartup,
} from "./database.ts";

/** A fresh folder for one test, removed again when the test ends. */
function tempFolder(t: { after(fn: () => void): void }): string {
  const folder = mkdtempSync(path.join(tmpdir(), "database-test-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  return folder;
}

/** A database file as an older version of the server left it: `steps` steps, and one account. */
function oldDatabase(file: string, steps: number, accountName: string): void {
  const db = new Database(file);
  migrate(db, steps);
  db.prepare(
    `INSERT INTO accounts (account_name, account_name_key, display_name, password_hash, created_at)
     VALUES (?, ?, ?, 'not a real hash', 0)`,
  ).run(accountName, accountName, accountName);
  db.close();
}

function accountNames(file: string): string[] {
  const db = new Database(file, { readonly: true });
  const names = db.prepare("SELECT account_name FROM accounts ORDER BY id").pluck().all() as string[];
  db.close();
  return names;
}

function stepsDone(file: string): number {
  const db = new Database(file, { readonly: true });
  const version = db.pragma("user_version", { simple: true }) as number;
  db.close();
  return version;
}

test("a database with pending steps is copied first, as it was", (t) => {
  const file = path.join(tempFolder(t), "game.db");
  oldDatabase(file, 3, "ann");

  openDatabase(file).close();

  const copy = copyFileName(file, 4);
  assert.equal(path.basename(copy), "game.db.before-step-4");
  assert.equal(stepsDone(copy), 3);
  assert.deepEqual(accountNames(copy), ["ann"]);
  // The database itself has all steps now; the copy doesn't.
  assert.ok(stepsDone(file) > 3);
});

test("no copy is made of an up-to-date database or of a new one", (t) => {
  const folder = tempFolder(t);
  const file = path.join(folder, "game.db");

  openDatabase(file).close(); // new: nothing to keep
  openDatabase(file).close(); // up to date: no steps pending

  assert.deepEqual(
    readdirSync(folder).filter((name) => name.includes(".before-")),
    [],
  );
});

test("a copy made earlier with the same name is replaced", (t) => {
  const folder = tempFolder(t);
  const file = path.join(folder, "game.db");
  // A copy left by an earlier start, of a database that had only "old".
  oldDatabase(copyFileName(file, 4), 3, "old");
  oldDatabase(file, 3, "ann");

  openDatabase(file).close();

  assert.deepEqual(accountNames(copyFileName(file, 4)), ["ann"]);
});

test("a restored copy opens with its old contents, and the replaced database is kept", (t) => {
  const file = path.join(tempFolder(t), "game.db");
  oldDatabase(file, 3, "ann");
  const db = openDatabase(file);
  db.prepare(
    `INSERT INTO accounts (account_name, account_name_key, display_name, password_hash, created_at)
     VALUES ('bob', 'bob', 'bob', 'not a real hash', 0)`,
  ).run();
  db.close();

  const aside = restoreDatabase(copyFileName(file, 4), file, new Date("2026-10-10T12:00:00Z"));

  assert.equal(path.basename(aside), "game.db.replaced-2026-10-10T12-00-00-000Z");
  assert.deepEqual(accountNames(aside), ["ann", "bob"]);
  assert.equal(stepsDone(file), 3);
  assert.deepEqual(accountNames(file), ["ann"]);
  // The copy stays, so it can be restored again.
  assert.ok(existsSync(copyFileName(file, 4)));
  // Opening it runs the steps again, as the next start of the server would.
  const restored = openDatabase(file);
  assert.deepEqual(
    restored.prepare("SELECT account_name FROM accounts").pluck().all(),
    ["ann"],
  );
  restored.close();
});

test("the -wal file of the replaced database moves aside with it", (t) => {
  const file = path.join(tempFolder(t), "game.db");
  oldDatabase(file, 3, "ann");
  openDatabase(file).close();
  // Like a server that crashed: its last changes are still in the -wal file.
  const crashed = openDatabase(file);
  crashed.pragma("wal_autocheckpoint = 0");
  crashed.prepare(
    `INSERT INTO accounts (account_name, account_name_key, display_name, password_hash, created_at)
     VALUES ('bob', 'bob', 'bob', 'not a real hash', 0)`,
  ).run();
  assert.ok(existsSync(`${file}-wal`));

  const aside = restoreDatabase(copyFileName(file, 4), file);
  crashed.close();

  assert.ok(!existsSync(`${file}-wal`));
  assert.deepEqual(accountNames(file), ["ann"]);
  assert.deepEqual(accountNames(aside), ["ann", "bob"]);
});

test("restoring refuses a file that isn't a database, and changes nothing", (t) => {
  const folder = tempFolder(t);
  const file = path.join(folder, "game.db");
  oldDatabase(file, 3, "ann");
  openDatabase(file).close();

  const notADatabase = path.join(folder, "notes.txt");
  writeFileSync(notADatabase, "not a database");

  assert.throws(() => restoreDatabase(path.join(folder, "no-such-copy"), file));
  assert.throws(() => restoreDatabase(notADatabase, file));
  assert.deepEqual(accountNames(file), ["ann"]);
  assert.deepEqual(
    readdirSync(folder).filter((name) => name.includes(".replaced-")),
    [],
  );
});

/** A database that went through a release with migrations: step 3 → all steps, so it has a copy before step 4. */
function migratedDatabase(t: { after(fn: () => void): void }): string {
  const file = path.join(tempFolder(t), "game.db");
  oldDatabase(file, 3, "ann");
  const db = openDatabase(file);
  db.prepare(
    `INSERT INTO accounts (account_name, account_name_key, display_name, password_hash, created_at)
     VALUES ('bob', 'bob', 'bob', 'not a real hash', 0)`,
  ).run();
  db.close();
  return file;
}

test("RESTORE_DATABASE restores the copy on startup", (t) => {
  const file = migratedDatabase(t);

  const restored = restoreOnStartup("game.db.before-step-4", file);

  assert.equal(restored?.copy, copyFileName(file, 4));
  assert.deepEqual(accountNames(file), ["ann"]);
  assert.deepEqual(accountNames(restored!.aside), ["ann", "bob"]);
  // The server then opens it as usual, which runs the steps again.
  const db = openDatabase(file);
  assert.deepEqual(db.prepare("SELECT account_name FROM accounts").pluck().all(), ["ann"]);
  db.close();
});

test("a start with RESTORE_DATABASE still set after a restore refuses, and changes nothing", (t) => {
  const file = migratedDatabase(t);
  restoreOnStartup("game.db.before-step-4", file);
  // The server ran after the restore: a new account, and the migrations
  // made a new copy with the same name as the one restored.
  const db = openDatabase(file);
  db.prepare(
    `INSERT INTO accounts (account_name, account_name_key, display_name, password_hash, created_at)
     VALUES ('cat', 'cat', 'cat', 'not a real hash', 0)`,
  ).run();
  db.close();
  assert.ok(existsSync(copyFileName(file, 4)));
  const before = readdirSync(path.dirname(file)).sort();

  assert.throws(() => restoreOnStartup("game.db.before-step-4", file), /Remove the RESTORE_DATABASE setting/);

  assert.deepEqual(readdirSync(path.dirname(file)).sort(), before);
  assert.deepEqual(accountNames(file), ["ann", "cat"]);
});

test("a start without RESTORE_DATABASE removes the marker, so a later restore works", (t) => {
  const file = migratedDatabase(t);
  restoreOnStartup("game.db.before-step-4", file);

  assert.equal(restoreOnStartup(undefined, file), undefined);
  openDatabase(file).close();

  assert.ok(restoreOnStartup("game.db.before-step-4", file));
});

test("RESTORE_DATABASE with a copy that isn't there refuses, and changes nothing", (t) => {
  const file = migratedDatabase(t);

  assert.throws(() => restoreOnStartup("game.db.before-step-99", file), /there is no copy/);

  assert.deepEqual(accountNames(file), ["ann", "bob"]);
  assert.ok(!existsSync(`${file}.restored`));
});

test("only a plain file name in the data folder is accepted, and not the database itself", () => {
  const file = path.join("/data", "game.db");
  assert.equal(copyInDataFolder("game.db.before-step-9", file), "/data/game.db.before-step-9");
  for (const name of ["../game.db.before-step-9", "/tmp/game.db", "sub/game.db", "..\\game.db", "..", "."]) {
    assert.throws(() => copyInDataFolder(name, file), /without a folder/, name);
  }
  for (const name of ["game.db", "game.db-wal", "game.db-shm"]) {
    assert.throws(() => copyInDataFolder(name, file), /the database itself/, name);
  }
});
