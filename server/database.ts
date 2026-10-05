// Opens the SQLite database and brings its tables up to date.
//
// better-sqlite3 is synchronous: a query returns its result directly instead
// of a Promise. That is a deliberate choice (see architecture.md, Storage):
// queries on a local file take microseconds, and code without `await` can't
// be interrupted halfway by other work.

import { mkdirSync } from "node:fs";
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
];

/** Opens (or creates) the database file. Pass ":memory:" for a throwaway database in tests. */
export function openDatabase(file: string): Db {
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  // WAL: writes go to a separate log first, which is faster and safer on a crash.
  db.pragma("journal_mode = WAL");
  // SQLite only enforces REFERENCES when this is switched on, per connection.
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
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
