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

function migrate(db: Db): void {
  const current = db.pragma("user_version", { simple: true }) as number;
  for (let step = current; step < migrations.length; step++) {
    // Each step and its version number change together, or not at all.
    db.transaction(() => {
      db.exec(migrations[step]!);
      db.pragma(`user_version = ${step + 1}`);
    })();
  }
}
