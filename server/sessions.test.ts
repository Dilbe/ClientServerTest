import { test } from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "./database.ts";
import { createSession, hashToken, useSession } from "./sessions.ts";

const DAY = 24 * 60 * 60 * 1000;

function setup() {
  const db = openDatabase(":memory:");
  db.prepare("INSERT INTO accounts (id, account_name, account_name_key, display_name, password_hash, created_at) VALUES (1, 'a', 'a', 'A', 'x', 0)").run();
  return db;
}

test("only the hash of the token is stored", () => {
  const db = setup();
  const token = createSession(db, 1, 0);
  const row = db.prepare("SELECT token_hash FROM sessions").get() as { token_hash: string };
  assert.equal(row.token_hash, hashToken(token));
  assert.notEqual(row.token_hash, token);
});

test("a session expires after 30 days without use", () => {
  const db = setup();
  const token = createSession(db, 1, 0);
  assert.ok(useSession(db, token, 29 * DAY));
  assert.equal(useSession(db, token, 29 * DAY + 30 * DAY), undefined);
});

test("using a session extends it", () => {
  const db = setup();
  const token = createSession(db, 1, 0);
  assert.equal(useSession(db, token, 10)?.extended, false); // used just now: not worth a write
  assert.equal(useSession(db, token, 20 * DAY)?.extended, true);
  assert.ok(useSession(db, token, 45 * DAY)); // 25 days after the last use
});
