import { test } from "node:test";
import assert from "node:assert/strict";
import { createAccount } from "./accounts.ts";
import { charactersOfAccount, loadCharacterData } from "./characters.ts";
import { openDatabase } from "./database.ts";

test("a new account gets one character named after the display name", async () => {
  const db = openDatabase(":memory:");
  const result = await createAccount(db, { accountName: "ivan", displayName: "Ivan", password: "correct horse battery" });
  assert.ok(result.ok);
  const characters = charactersOfAccount(db, result.account.id);
  assert.equal(characters.length, 1);
  assert.equal(characters[0]!.name, "Ivan");
  assert.deepEqual(characters[0]!.data, { version: 1, xp: 0 });
});

test("bad character data is caught when loaded", () => {
  assert.throws(() => loadCharacterData('{"version":1,"xp":-5}'));
  assert.throws(() => loadCharacterData('{"version":99}'));
});

test("the password is stored as an argon2id hash", async () => {
  const db = openDatabase(":memory:");
  await createAccount(db, { accountName: "judy", displayName: "Judy", password: "correct horse battery" });
  const { password_hash } = db.prepare("SELECT password_hash FROM accounts").get() as { password_hash: string };
  assert.match(password_hash, /^\$argon2id\$/);
  assert.doesNotMatch(password_hash, /correct horse/);
});
