import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { createAccount } from "./accounts.ts";
import {
  addXp,
  buyAdventurer,
  charactersOfAccount,
  insertCharacter,
  loadCharacterData,
  renameCharacter,
} from "./characters.ts";
import { migrate, openDatabase, type Db } from "./database.ts";

test("a new account gets one character: number 1, a level 1 adventurer", async () => {
  const db = openDatabase(":memory:");
  const result = await createAccount(db, { accountName: "ivan", displayName: "Ivan", password: "correct horse battery" });
  assert.ok(result.ok);
  const characters = charactersOfAccount(db, result.account.id);
  assert.equal(characters.length, 1);
  assert.equal(characters[0]!.number, 1);
  assert.deepEqual(characters[0]!.data, { version: 3, class: "adventurer", rank: 1, xp: 0 });
});

test("the migration removes character names and numbers the existing characters", () => {
  // A database as the version before this migration left it: 3 steps.
  const db = new Database(":memory:");
  migrate(db, 3);
  const addAccount = (name: string) =>
    Number(
      db
        .prepare(
          `INSERT INTO accounts (account_name, account_name_key, display_name, password_hash, created_at)
           VALUES (?, ?, ?, 'not a real hash', 0)`,
        )
        .run(name, name, name).lastInsertRowid,
    );
  const addOldCharacter = (accountId: number, name: string) =>
    db
      .prepare("INSERT INTO characters (account_id, name, data, created_at, updated_at) VALUES (?, ?, ?, 0, 0)")
      .run(accountId, name, '{"version":2,"class":"adventurer","rank":1,"xp":30}');
  const ann = addAccount("ann");
  const ben = addAccount("ben");
  addOldCharacter(ann, "Ann");
  addOldCharacter(ben, "Ben");
  // No account has two characters yet, but the migration would number them in order.
  addOldCharacter(ben, "Ben");

  migrate(db);

  const columns = (db.prepare("PRAGMA table_info(characters)").all() as { name: string }[]).map((c) => c.name);
  assert.ok(!columns.includes("name"));
  assert.deepEqual(
    charactersOfAccount(db, ann).map((c) => [c.number, c.data.xp]),
    [[1, 30]],
  );
  assert.deepEqual(
    charactersOfAccount(db, ben).map((c) => c.number),
    [1, 2],
  );
  // The number is unique within the account.
  assert.throws(() =>
    db
      .prepare("INSERT INTO characters (account_id, number, data, created_at, updated_at) VALUES (?, 1, '{}', 0, 0)")
      .run(ann),
  );
  // The next new character gets the next number.
  insertCharacter(db, ben, 0);
  assert.deepEqual(
    charactersOfAccount(db, ben).map((c) => c.number),
    [1, 2, 3],
  );
});

async function accountWithSilver(db: Db, silver: number): Promise<number> {
  const result = await createAccount(db, { accountName: "lea", displayName: "Lea", password: "correct horse battery" });
  assert.ok(result.ok);
  db.prepare("UPDATE accounts SET silver = ? WHERE id = ?").run(silver, result.account.id);
  return result.account.id;
}

const silverOf = (db: Db, accountId: number) =>
  (db.prepare("SELECT silver FROM accounts WHERE id = ?").get(accountId) as { silver: number }).silver;

test("buying an adventurer costs 10 silver for every character the player has", async () => {
  const db = openDatabase(":memory:");
  const accountId = await accountWithSilver(db, 35);

  assert.deepEqual(buyAdventurer(db, accountId, 0), { ok: true }); // the second: 10
  assert.equal(silverOf(db, accountId), 25);
  assert.deepEqual(buyAdventurer(db, accountId, 0), { ok: true }); // the third: 20
  assert.equal(silverOf(db, accountId), 5);

  const characters = charactersOfAccount(db, accountId);
  assert.deepEqual(
    characters.map((c) => c.number),
    [1, 2, 3],
  );
  assert.deepEqual(characters[2]!.data, { version: 3, class: "adventurer", rank: 1, xp: 0 });
});

test("buying without enough silver changes nothing", async () => {
  const db = openDatabase(":memory:");
  const accountId = await accountWithSilver(db, 9);
  assert.deepEqual(buyAdventurer(db, accountId, 0), { ok: false, reason: "not-enough-silver" });
  assert.equal(silverOf(db, accountId), 9);
  assert.equal(charactersOfAccount(db, accountId).length, 1);
});

test("when adding the character fails, the silver isn't taken either", async () => {
  const db = openDatabase(":memory:");
  const accountId = await accountWithSilver(db, 10);
  // Make the insert fail halfway through the purchase, as a crash or a bug would.
  db.exec(`CREATE TRIGGER fail_insert BEFORE INSERT ON characters BEGIN SELECT RAISE(ABORT, 'broken'); END`);
  assert.throws(() => buyAdventurer(db, accountId, 0), /broken/);
  assert.equal(silverOf(db, accountId), 10);
  assert.equal(charactersOfAccount(db, accountId).length, 1);
});

test("a name is stored only when the player chose one", async () => {
  const db = openDatabase(":memory:");
  const accountId = await accountWithSilver(db, 0);
  const stored = () => JSON.parse((db.prepare("SELECT data FROM characters").get() as { data: string }).data);

  assert.deepEqual(renameCharacter(db, accountId, 1, "Runner", 0), { ok: true });
  assert.equal(stored().name, "Runner");
  renameCharacter(db, accountId, 1, null, 0);
  assert.equal("name" in stored(), false);
  assert.deepEqual(renameCharacter(db, accountId, 2, "Nobody", 0), { ok: false, reason: "no-such-character" });
});

test("bad character data is caught when loaded", () => {
  assert.throws(() => loadCharacterData('{"version":1,"xp":-5}'));
  assert.throws(() => loadCharacterData('{"version":2,"class":"adventurer","rank":6,"xp":0}'));
  assert.throws(() => loadCharacterData('{"version":2,"class":"wizard","rank":1,"xp":0}'));
  // Rank 1 means max level 10, which needs 450 XP: more can't be right.
  assert.throws(() => loadCharacterData('{"version":2,"class":"adventurer","rank":1,"xp":451}'));
  assert.throws(() => loadCharacterData('{"version":99}'));
  assert.throws(() => loadCharacterData('{"version":3,"name":"<script>","class":"adventurer","rank":1,"xp":0}'));
});

test("a version 1 record is upgraded to a rank 1 adventurer, keeping its XP", () => {
  assert.deepEqual(loadCharacterData('{"version":1,"xp":30}'), { version: 3, class: "adventurer", rank: 1, xp: 30 });
});

test("an old record gets the new shape when XP is added, and never more than its max level needs", async () => {
  const db = openDatabase(":memory:");
  const result = await createAccount(db, { accountName: "kim", displayName: "Kim", password: "correct horse battery" });
  assert.ok(result.ok);
  const [character] = charactersOfAccount(db, result.account.id);
  db.prepare("UPDATE characters SET data = ? WHERE id = ?").run('{"version":1,"xp":440}', character!.id);

  addXp(db, character!.id, 5, 1000);
  const stored = () => (db.prepare("SELECT data FROM characters WHERE id = ?").get(character!.id) as { data: string }).data;
  assert.deepEqual(JSON.parse(stored()), { version: 3, class: "adventurer", rank: 1, xp: 445 });
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
