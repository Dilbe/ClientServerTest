// Opens the SQLite database and brings its tables up to date.
//
// better-sqlite3 is synchronous: a query returns its result directly instead
// of a Promise. That is a deliberate choice (see architecture.md, Storage):
// queries on a local file take microseconds, and code without `await` can't
// be interrupted halfway by other work.

import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export type Db = Database.Database;

/**
 * The database schema as a list of steps. A new database runs all of them; an
 * existing one only the steps it doesn't have yet. SQLite's `user_version`
 * remembers how many have run. Never change a step once it is merged: add a
 * new one instead, as with migrations in Entity Framework.
 */
const migrations: string[] = [
  `
  CREATE TABLE accounts (
    id               INTEGER PRIMARY KEY,
    account_name     TEXT NOT NULL,
    account_name_key TEXT NOT NULL UNIQUE,  -- lowercase, for case-insensitive lookup
    display_name     TEXT NOT NULL,
    display_name_changed INTEGER NOT NULL DEFAULT 0,
    password_hash    TEXT NOT NULL,
    disabled         INTEGER NOT NULL DEFAULT 0,
    created_at       INTEGER NOT NULL       -- milliseconds since 1970 (UTC)
  );

  -- Every display name an account has used. Old names stay here after a
  -- change, so nobody else can take them (see architecture.md).
  CREATE TABLE display_names (
    name_key   TEXT PRIMARY KEY,            -- see displayNameKey()
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE
  );

  CREATE TABLE characters (
    id         INTEGER PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    data       TEXT NOT NULL,               -- JSON, see characters.ts
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX characters_account ON characters(account_id);

  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,            -- SHA-256 of the cookie value, never the value itself
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX sessions_account ON sessions(account_id);
  `,
  `
  -- The event store for running games (architecture.md, Event store). Rows
  -- are only ever added, never changed: a game is its list of events, and
  -- its state is rebuilt from them on startup. See game-store.ts.
  CREATE TABLE game_events (
    game_id    TEXT NOT NULL,
    sequence   INTEGER NOT NULL,            -- 1, 2, 3, ... within the game
    type       TEXT NOT NULL,
    data       TEXT NOT NULL,               -- JSON
    created_at INTEGER NOT NULL,            -- milliseconds since 1970 (UTC)
    PRIMARY KEY (game_id, sequence)
  );

  -- Who each game's character numbers stand for: the only place that ties a
  -- stored game to people. Deleting an account removes its rows, after which
  -- its events no longer point to anyone.
  CREATE TABLE game_members (
    game_id      TEXT NOT NULL,
    character_id INTEGER NOT NULL,          -- the number within the game: 1, 2, 3, ...
    account_id   INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    character_record_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    left_game    INTEGER NOT NULL DEFAULT 0, -- 1 once the player has gone back to the lobby
    PRIMARY KEY (game_id, character_id)
  );
  CREATE INDEX game_members_account ON game_members(account_id);

  -- One row: how long the server has been running, summed over all its
  -- runs. Saved every few seconds and on shutdown, so game clocks can go on
  -- after a restart as if the downtime never happened.
  CREATE TABLE server_clock (
    id         INTEGER PRIMARY KEY CHECK (id = 1),
    running_ms INTEGER NOT NULL,
    saved_at   INTEGER NOT NULL             -- milliseconds since 1970: when the server last said it was alive
  );
  `,
  `
  -- Silver is won with dungeons and belongs to the account, not to a
  -- character (design.md, Rewards). Existing accounts start with none.
  ALTER TABLE accounts ADD COLUMN silver INTEGER NOT NULL DEFAULT 0;
  `,
  `
  -- Characters have no names (design.md, Characters): the name was a copy of
  -- the display name, personal data stored twice. They are told apart by
  -- their number within the account instead: 1, 2, 3, ...
  ALTER TABLE characters DROP COLUMN name;
  ALTER TABLE characters ADD COLUMN number INTEGER NOT NULL DEFAULT 0;
  -- Every account has one character so far, which becomes number 1. Should
  -- an account have more, they are numbered in the order they were created.
  UPDATE characters SET number = (
    SELECT COUNT(*) FROM characters AS earlier
    WHERE earlier.account_id = characters.account_id AND earlier.id <= characters.id
  );
  CREATE UNIQUE INDEX characters_account_number ON characters(account_id, number);
  `,
  `
  -- The dungeons each account has won at least once, so their one-time
  -- rewards are only given on the first win (design.md, Rewards). The
  -- dungeon id is the fixed id from shared/rules/dungeon-map.ts, which is
  -- why those ids may never change once in use.
  CREATE TABLE dungeons_won (
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    dungeon_id TEXT NOT NULL,
    PRIMARY KEY (account_id, dungeon_id)
  );
  `,
  `
  -- Wins are per dungeon per difficulty (design.md, Unlocking dungeons): a
  -- one-time reward comes with the first win on each difficulty, and the
  -- wins decide what a player can play. SQLite can't change a primary key,
  -- so the table is made again with the difficulty in it. Wins from before
  -- difficulties existed count as Normal. The difficulty id is the fixed id
  -- from shared/rules/difficulties.ts.
  CREATE TABLE dungeons_won_new (
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    dungeon_id TEXT NOT NULL,
    difficulty TEXT NOT NULL,
    PRIMARY KEY (account_id, dungeon_id, difficulty)
  );
  INSERT INTO dungeons_won_new (account_id, dungeon_id, difficulty)
    SELECT account_id, dungeon_id, 'normal' FROM dungeons_won;
  DROP TABLE dungeons_won;
  ALTER TABLE dungeons_won_new RENAME TO dungeons_won;
  `,
  `
  -- How many adventurers of each rank each account has bought: the price of
  -- the next one follows from it (design.md, Getting more characters). Only
  -- purchases count, so it can't be worked out from the characters. Nobody
  -- recorded purchases before, so every account starts without rows: a
  -- missing row means none bought.
  CREATE TABLE adventurers_bought (
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    rank       INTEGER NOT NULL,
    count      INTEGER NOT NULL,
    PRIMARY KEY (account_id, rank)
  );
  `,
  `
  -- The one-time hints each account has seen (design.md, Rewards), so each
  -- shows only once per player. The hint id is the fixed id from
  -- shared/hints.ts. Existing accounts start without rows: nothing seen yet.
  CREATE TABLE hints_seen (
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    hint_id    TEXT NOT NULL,
    PRIMARY KEY (account_id, hint_id)
  );
  `,
];

/**
 * Opens (or creates) the database file. Pass ":memory:" for a throwaway
 * database in tests. When steps are pending, a copy of the database is made
 * first (see `copyBeforeMigrating`).
 */
export function openDatabase(file: string): Db {
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  // WAL: writes go to a separate log first, which is faster and safer on a crash.
  db.pragma("journal_mode = WAL");
  // SQLite only enforces REFERENCES when this is switched on, per connection.
  db.pragma("foreign_keys = ON");
  if (file !== ":memory:") copyBeforeMigrating(db, file);
  migrate(db);
  return db;
}

/**
 * The name of the copy made before step `step` (counted from 1) runs, like
 * `game.db.before-step-9`: the database as step 8 left it. It is named after
 * the step and not after the release, because the server doesn't know its
 * release version this early, and in development it has none.
 */
export function copyFileName(file: string, step: number): string {
  return `${file}.before-step-${step}`;
}

/**
 * Copies the database when steps are pending, so a release that went wrong
 * can go back to it (architecture.md, Database updates; `restoreDatabase`).
 * A new, empty database has nothing to keep, so it gets no copy.
 *
 * `VACUUM INTO` writes a consistent copy of the open database to a new file,
 * in one statement. It is safe while the database is in use, unlike copying
 * the file: with WAL, recent changes may still be in the separate -wal file.
 * It fails when the target exists, so an older copy with the same name is
 * removed first. That can only be one from a start that was stopped before
 * its steps ran (or a copy restored earlier), and this one is newer.
 */
function copyBeforeMigrating(db: Db, file: string): void {
  const current = db.pragma("user_version", { simple: true }) as number;
  if (current === 0 || current >= migrations.length) return;
  const copy = copyFileName(file, current + 1);
  rmSync(copy, { force: true });
  db.prepare("VACUUM INTO ?").run(copy);
  console.log(`Copied the database to ${copy} before running steps ${current + 1} to ${migrations.length}.`);
}

/**
 * Puts a copy made by `copyBeforeMigrating` back in place of the database
 * (architecture.md, Rolling back). Only for emergencies: everything since
 * the copy was made is lost. Run it with the server stopped: a running
 * server would keep writing to the file it has open, which is no longer the
 * database afterwards.
 *
 * Nothing is deleted. The current database moves aside as
 * `game.db.replaced-<time>`, together with its -wal file: after a crash that
 * file holds the last changes, and left next to the restored copy SQLite
 * would apply them to it, which breaks it. Returns the name it moved to.
 */
export function restoreDatabase(copy: string, file: string, now = new Date()): string {
  // Check the copy before touching anything: it must be a readable SQLite
  // database, so a wrong file name can't replace the database with nothing.
  const check = new Database(copy, { readonly: true, fileMustExist: true });
  try {
    const result = check.pragma("quick_check", { simple: true });
    if (result !== "ok") throw new Error(`${copy} is damaged: ${result}`);
  } finally {
    check.close();
  }

  const aside = `${file}.replaced-${now.toISOString().replace(/[:.]/g, "-")}`;
  for (const suffix of ["", "-wal", "-shm"]) {
    if (existsSync(file + suffix)) renameSync(file + suffix, aside + suffix);
  }
  // A copy of the copy, so the same copy can be restored again if needed.
  copyFileSync(copy, file);
  return aside;
}

/**
 * Runs the steps the database doesn't have yet. `upTo` stops after that many
 * steps, so a test can make a database as an older version left it.
 */
export function migrate(db: Db, upTo = migrations.length): void {
  const current = db.pragma("user_version", { simple: true }) as number;
  for (let step = current; step < upTo; step++) {
    // Each step and its version number change together, or not at all.
    db.transaction(() => {
      db.exec(migrations[step]!);
      db.pragma(`user_version = ${step + 1}`);
    })();
  }
}
