import { test } from "node:test";
import assert from "node:assert/strict";
import { createAccount } from "./accounts.ts";
import { addXp, charactersOfAccount, loadCharacterData } from "./characters.ts";
import { openDatabase } from "./database.ts";

test("a new account gets one character named after the display name", async () => {
  const db = openDatabase(":memory:");
  const result = await createAccount(db, { accountName: "ivan", displayName: "Ivan", password: "correct horse battery" });
  assert.ok(result.ok);
  const characters = charactersOfAccount(db, result.account.id);
  assert.equal(characters.length, 1);
  assert.equal(characters[0]!.name, "Ivan");
  assert.deepEqual(characters[0]!.data, { version: 2, class: "adventurer", rank: 1, xp: 0 });
});

test("bad character data is caught when loaded", () => {
  assert.throws(() => loadCharacterData('{"version":1,"xp":-5}'));
  assert.throws(() => loadCharacterData('{"version":2,"class":"adventurer","rank":6,"xp":0}'));
  assert.throws(() => loadCharacterData('{"version":2,"class":"wizard","rank":1,"xp":0}'));
  // Rank 1 means max level 10, which needs 450 XP: more can't be right.
  assert.throws(() => loadCharacterData('{"version":2,"class":"adventurer","rank":1,"xp":451}'));
  assert.throws(() => loadCharacterData('{"version":99}'));
});

test("a version 1 record is upgraded to a rank 1 adventurer, keeping its XP", () => {
  assert.deepEqual(loadCharacterData('{"version":1,"xp":30}'), { version: 2, class: "adventurer", rank: 1, xp: 30 });
});

test("an old record gets the new shape when XP is added, and never more than its max level needs", async () => {
  const db = openDatabase(":memory:");
  const result = await createAccount(db, { accountName: "kim", displayName: "Kim", password: "correct horse battery" });
  assert.ok(result.ok);
  const [character] = charactersOfAccount(db, result.account.id);
  db.prepare("UPDATE characters SET data = ? WHERE id = ?").run('{"version":1,"xp":440}', character!.id);

  addXp(db, character!.id, 5, 1000);
  const stored = () => (db.prepare("SELECT data FROM characters WHERE id = ?").get(character!.id) as { data: string }).data;
  assert.deepEqual(JSON.parse(stored()), { version: 2, class: "adventurer", rank: 1, xp: 445 });
  addXp(db, character!.id, 10, 2000);
  assert.equal(JSON.parse(stored()).xp, 450);
});

test("the password is stored as an argon2id hash", async () => {
  const db = openDatabase(":memory:");
  await createAccount(db, { accountName: "judy", displayName: "Judy", password: "correct horse battery" });
  const { password_hash } = db.prepare("SELECT password_hash FROM accounts").get() as { password_hash: string };
  assert.match(password_hash, /^\$argon2id\$/);
  assert.doesNotMatch(password_hash, /correct horse/);
});
