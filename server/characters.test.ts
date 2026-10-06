import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { createAccount } from "./accounts.ts";
import {
  addDungeonResult,
  buyAdventurer,
  charactersOfAccount,
  insertCharacter,
  loadCharacterData,
  rankUp,
  renameCharacter,
  resetUpgrades,
  upgradeStat,
} from "./characters.ts";
import { migrate, openDatabase, type Db } from "./database.ts";
import { levelFromXp, maxXp } from "../shared/rules/advancement.ts";
import { pointsLeft } from "../shared/rules/upgrades.ts";

test("a new account gets one character: number 1, a level 1 adventurer", async () => {
  const db = openDatabase(":memory:");
  const result = await createAccount(db, { accountName: "ivan", displayName: "Ivan", password: "correct horse battery" });
  assert.ok(result.ok);
  const characters = charactersOfAccount(db, result.account.id);
  assert.equal(characters.length, 1);
  assert.equal(characters[0]!.number, 1);
  assert.deepEqual(characters[0]!.data, { version: 6, class: "adventurer", rank: 1, xp: 0, upgrades: [], kills: {} });
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
  assert.deepEqual(characters[2]!.data, { version: 6, class: "adventurer", rank: 1, xp: 0, upgrades: [], kills: {} });
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
  assert.throws(() => loadCharacterData('{"version":99}'));
  assert.throws(() => loadCharacterData('{"version":3,"name":"<script>","class":"adventurer","rank":1,"xp":0}'));
});

test("a version 1 record is upgraded to a rank 1 adventurer, keeping its XP", () => {
  assert.deepEqual(loadCharacterData('{"version":1,"xp":30}'), { version: 6, class: "adventurer", rank: 1, xp: 30, upgrades: [], kills: {} });
});

test("an old record gets the new shape when XP is added, and never more than its max level needs", async () => {
  const db = openDatabase(":memory:");
  const result = await createAccount(db, { accountName: "kim", displayName: "Kim", password: "correct horse battery" });
  assert.ok(result.ok);
  const [character] = charactersOfAccount(db, result.account.id);
  db.prepare("UPDATE characters SET data = ? WHERE id = ?").run('{"version":1,"xp":215}', character!.id);

  addDungeonResult(db, character!.id, { xp: 5 }, 1000);
  const stored = () => (db.prepare("SELECT data FROM characters WHERE id = ?").get(character!.id) as { data: string }).data;
  assert.deepEqual(JSON.parse(stored()), { version: 6, class: "adventurer", rank: 1, xp: 220, upgrades: [], kills: {} });
  addDungeonResult(db, character!.id, { xp: 10 }, 2000);
  assert.equal(JSON.parse(stored()).xp, 225);
});

test("a stored character past its new max level keeps its XP, stays at max level and gains no more (issue #93)", async () => {
  const db = openDatabase(":memory:");
  // 450 XP was the max of rank 1 with the old XP curve; the new max is 225.
  const accountId = await characterWithXp(db, 450);
  const [character] = charactersOfAccount(db, accountId);
  assert.equal(character!.data.xp, 450);
  assert.equal(levelFromXp(character!.data.xp, 1), 10);
  // It has the 54 points of level 10.
  assert.deepEqual(upgradeStat(db, accountId, 1, "actions", 0), { ok: true }); // 20

  addDungeonResult(db, character!.id, { xp: 10 }, 1000);
  assert.equal(charactersOfAccount(db, accountId)[0]!.data.xp, 450);
});

test("a version 3 record gets no upgrades", () => {
  assert.deepEqual(loadCharacterData('{"version":3,"name":"Runner","class":"adventurer","rank":1,"xp":30}'), {
    version: 6,
    name: "Runner",
    class: "adventurer",
    rank: 1,
    xp: 30,
    upgrades: [],
    kills: {},
  });
  assert.throws(() =>
    loadCharacterData('{"version":5,"class":"adventurer","rank":1,"xp":0,"upgrades":[{"stat":"luck","paid":1}]}'),
  );
  assert.throws(() =>
    loadCharacterData('{"version":5,"class":"adventurer","rank":1,"xp":0,"upgrades":[{"stat":"hitPoints","paid":0}]}'),
  );
  // Movement can't be upgraded: a current record with a movement upgrade is bad.
  assert.throws(() =>
    loadCharacterData('{"version":5,"class":"adventurer","rank":1,"xp":0,"upgrades":[{"stat":"movement","paid":5}]}'),
  );
});

test("a version 4 record loses its movement upgrades, gets those points back and keeps its other upgrades", async () => {
  // Level 5 has earned 14 points: 1 + 5 + 2 spent, 5 of them on movement.
  const old = {
    version: 4,
    class: "adventurer",
    rank: 1,
    xp: 60,
    upgrades: [
      { stat: "hitPoints", paid: 1 },
      { stat: "movement", paid: 5 },
      { stat: "hitPoints", paid: 2 },
    ],
  };
  const loaded = loadCharacterData(JSON.stringify(old));
  assert.deepEqual(loaded, {
    version: 6,
    class: "adventurer",
    rank: 1,
    xp: 60,
    upgrades: [
      { stat: "hitPoints", paid: 1 },
      { stat: "hitPoints", paid: 2 },
    ],
    kills: {},
  });
  assert.equal(pointsLeft(levelFromXp(loaded.xp, loaded.rank), loaded.upgrades), 11);

  // Through the database: the points can be spent again. 3 + 4 + 5 = 12 is
  // one too many for the 11 points left, so the third upgrade is refused.
  const db = openDatabase(":memory:");
  const accountId = await characterWithXp(db, 0);
  db.prepare("UPDATE characters SET data = ? WHERE account_id = ?").run(JSON.stringify(old), accountId);
  assert.equal(charactersOfAccount(db, accountId)[0]!.data.upgrades.length, 2);
  assert.deepEqual(upgradeStat(db, accountId, 1, "hitPoints", 0), { ok: true }); // 3
  assert.deepEqual(upgradeStat(db, accountId, 1, "hitPoints", 0), { ok: true }); // 4
  assert.deepEqual(upgradeStat(db, accountId, 1, "hitPoints", 0), { ok: false, reason: "not-enough-points" }); // 5
});

test("a version 5 record starts without kills (issue #97), and bad kill counts are refused", () => {
  assert.deepEqual(loadCharacterData('{"version":5,"class":"adventurer","rank":1,"xp":30,"upgrades":[]}'), {
    version: 6,
    class: "adventurer",
    rank: 1,
    xp: 30,
    upgrades: [],
    kills: {},
  });
  const withKills = (kills: unknown) =>
    JSON.stringify({ version: 6, class: "adventurer", rank: 1, xp: 0, upgrades: [], kills });
  assert.deepEqual(loadCharacterData(withKills({ warren: { hard: [0, 2] } })).kills, { warren: { hard: [0, 2] } });
  assert.throws(() => loadCharacterData(withKills({ warren: { hard: [-1] } })));
  assert.throws(() => loadCharacterData(withKills({ warren: { nightmare: [1] } })));
  assert.throws(() => loadCharacterData(withKills({ nowhere: { normal: [1] } })));
});

/** An account whose character 1 has this much XP. */
async function characterWithXp(db: Db, xp: number): Promise<number> {
  const accountId = await accountWithSilver(db, 0);
  db.prepare("UPDATE characters SET data = ? WHERE account_id = ?").run(
    JSON.stringify({ version: 5, class: "adventurer", rank: 1, xp, upgrades: [] }),
    accountId,
  );
  return accountId;
}

test("upgrading a stat stores the upgrade with what it cost, while the points last", async () => {
  const db = openDatabase(":memory:");
  // Level 3: 2 + 3 = 5 points.
  const accountId = await characterWithXp(db, 15);
  assert.deepEqual(upgradeStat(db, accountId, 1, "hitPoints", 0), { ok: true }); // 1
  assert.deepEqual(upgradeStat(db, accountId, 1, "hitPoints", 0), { ok: true }); // 2
  // 2 points left; attack damage costs 5.
  assert.deepEqual(upgradeStat(db, accountId, 1, "attackDamage", 0), { ok: false, reason: "not-enough-points" });
  assert.deepEqual(upgradeStat(db, accountId, 1, "hitPoints", 0), { ok: false, reason: "not-enough-points" }); // 3
  assert.deepEqual(charactersOfAccount(db, accountId)[0]!.data.upgrades, [
    { stat: "hitPoints", paid: 1 },
    { stat: "hitPoints", paid: 2 },
  ]);
  assert.deepEqual(upgradeStat(db, accountId, 2, "hitPoints", 0), { ok: false, reason: "no-such-character" });
});

test("resetting follows the example in design.md: level 5 with 60 XP becomes level 4 with 30 XP", async () => {
  const db = openDatabase(":memory:");
  const accountId = await characterWithXp(db, 60);
  // Level 5 has earned 14 points: spend some of them.
  upgradeStat(db, accountId, 1, "attackDamage", 0); // 5
  upgradeStat(db, accountId, 1, "hitPoints", 0); // 1
  assert.equal(charactersOfAccount(db, accountId)[0]!.data.upgrades.length, 2);

  assert.deepEqual(resetUpgrades(db, accountId, 1, 0), { ok: true });
  const { data } = charactersOfAccount(db, accountId)[0]!;
  assert.equal(data.xp, 30);
  assert.deepEqual(data.upgrades, []);
  // All 9 points of level 4 can be spent again: 5 + 1 + 2 = 8, then 3 is too many.
  assert.deepEqual(upgradeStat(db, accountId, 1, "attackDamage", 0), { ok: true });
  assert.deepEqual(upgradeStat(db, accountId, 1, "hitPoints", 0), { ok: true });
  assert.deepEqual(upgradeStat(db, accountId, 1, "hitPoints", 0), { ok: true });
  assert.deepEqual(upgradeStat(db, accountId, 1, "hitPoints", 0), { ok: false, reason: "not-enough-points" });
});

test("a level 1 character can't reset: it has no level to lose", async () => {
  const db = openDatabase(":memory:");
  const accountId = await characterWithXp(db, 4);
  assert.deepEqual(resetUpgrades(db, accountId, 1, 0), { ok: false, reason: "level-too-low" });
  assert.equal(charactersOfAccount(db, accountId)[0]!.data.xp, 4);
});

test("safety net: more points spent than earned resets the upgrades for free, keeping the level", async () => {
  // Level 2 has earned 2 points, but 3 were spent: as if the XP curve got steeper.
  const overspent = loadCharacterData(
    JSON.stringify({
      version: 5,
      class: "adventurer",
      rank: 1,
      xp: 5,
      upgrades: [
        { stat: "hitPoints", paid: 1 },
        { stat: "hitPoints", paid: 2 },
      ],
    }),
  );
  assert.deepEqual(overspent.upgrades, []);
  assert.equal(overspent.xp, 5);

  // Exactly what was earned is fine, also when today's costs would be higher.
  const paidInFull = loadCharacterData(
    JSON.stringify({
      version: 5,
      class: "adventurer",
      rank: 1,
      xp: 5,
      upgrades: [{ stat: "attackDamage", paid: 2 }],
    }),
  );
  assert.deepEqual(paidInFull.upgrades, [{ stat: "attackDamage", paid: 2 }]);

  // Through the database too: the character can spend all its points again.
  const db = openDatabase(":memory:");
  const accountId = await characterWithXp(db, 5);
  db.prepare("UPDATE characters SET data = ? WHERE account_id = ?").run(
    JSON.stringify({ version: 5, class: "adventurer", rank: 1, xp: 5, upgrades: [{ stat: "actions", paid: 20 }] }),
    accountId,
  );
  assert.deepEqual(charactersOfAccount(db, accountId)[0]!.data.upgrades, []);
  assert.deepEqual(upgradeStat(db, accountId, 1, "hitPoints", 0), { ok: true });
  assert.deepEqual(charactersOfAccount(db, accountId)[0]!.data, {
    version: 6,
    class: "adventurer",
    rank: 1,
    xp: 5,
    upgrades: [{ stat: "hitPoints", paid: 1 }],
    kills: {},
  });
});

/**
 * An account with these characters, numbered 1, 2, 3, ...: each a rank and
 * a level, given as "at max level" (true) or not (false).
 */
async function accountWithCharacters(db: Db, characters: [rank: number, maxLevel: boolean][]): Promise<number> {
  const accountId = await accountWithSilver(db, 0);
  db.prepare("DELETE FROM characters WHERE account_id = ?").run(accountId);
  for (const [rank, atMax] of characters) {
    const xp = atMax ? maxXp(rank) : 0;
    insertCharacter(db, accountId, 0, { version: 6, class: "adventurer", rank, xp, upgrades: [], kills: {} });
  }
  return accountId;
}

const numbersOf = (db: Db, accountId: number) => charactersOfAccount(db, accountId).map((c) => c.number);

test("ranking up uses up two max-level characters for one of the next rank, with the next number", async () => {
  const db = openDatabase(":memory:");
  const accountId = await accountWithCharacters(db, [
    [1, false],
    [1, true],
    [1, true],
  ]);
  db.prepare("UPDATE characters SET data = json_set(data, '$.name', 'Runner') WHERE number = 2").run();

  assert.deepEqual(rankUp(db, accountId, 2, 3, 0), { ok: true, number: 4 });
  const characters = charactersOfAccount(db, accountId);
  // Character 1 keeps its number; the new one has no name, XP or upgrades.
  assert.deepEqual(
    characters.map((c) => c.number),
    [1, 4],
  );
  assert.deepEqual(characters[1]!.data, { version: 6, class: "adventurer", rank: 2, xp: 0, upgrades: [], kills: {} });
});

test("numbers are never reused, also when the highest numbers were used up", async () => {
  const db = openDatabase(":memory:");
  const accountId = await accountWithCharacters(db, [
    [1, true],
    [1, true],
    [1, true],
  ]);
  assert.deepEqual(rankUp(db, accountId, 2, 3, 0), { ok: true, number: 4 });
  // Only 2 characters now, so the next one costs 20, and gets number 5.
  db.prepare("UPDATE accounts SET silver = 20 WHERE id = ?").run(accountId);
  assert.deepEqual(buyAdventurer(db, accountId, 0), { ok: true });
  assert.deepEqual(numbersOf(db, accountId), [1, 4, 5]);
});

test("ranking up is refused unless both characters can rank up together, and then nothing changes", async () => {
  const db = openDatabase(":memory:");
  const accountId = await accountWithCharacters(db, [
    [1, true], // 1
    [1, false], // 2: level 1
    [2, true], // 3: another rank
    [5, true], // 4
    [5, true], // 5: rank 5 is the highest
  ]);
  const before = db.prepare("SELECT * FROM characters ORDER BY id").all();

  const refusals: [number, number, string][] = [
    [1, 6, "no-such-character"], // there is no character 6
    [1, 1, "no-such-character"], // one character can't be used up twice
    [1, 2, "not-max-level"],
    [2, 1, "not-max-level"],
    [1, 3, "different-class-or-rank"],
    [4, 5, "max-rank"],
  ];
  for (const [first, second, reason] of refusals) {
    assert.deepEqual(rankUp(db, accountId, first, second, 0), { ok: false, reason }, `${first} + ${second}`);
  }
  assert.deepEqual(db.prepare("SELECT * FROM characters ORDER BY id").all(), before);
});

test("ranking up removes the used-up characters from the game link table", async () => {
  const db = openDatabase(":memory:");
  const accountId = await accountWithCharacters(db, [
    [1, true],
    [1, true],
  ]);
  const records = db.prepare("SELECT id FROM characters ORDER BY number").pluck().all() as number[];
  const link = db.prepare(
    "INSERT INTO game_members (game_id, character_id, account_id, character_record_id) VALUES (?, ?, ?, ?)",
  );
  link.run("g", 1, accountId, records[0]);
  link.run("g", 2, accountId, records[1]);

  assert.deepEqual(rankUp(db, accountId, 1, 2, 0), { ok: true, number: 3 });
  assert.equal(db.prepare("SELECT COUNT(*) FROM game_members").pluck().get(), 0);
});

test("when adding the new character fails, neither character is used up", async () => {
  const db = openDatabase(":memory:");
  const accountId = await accountWithCharacters(db, [
    [1, true],
    [1, true],
  ]);
  db.exec(`CREATE TRIGGER fail_insert BEFORE INSERT ON characters BEGIN SELECT RAISE(ABORT, 'broken'); END`);
  assert.throws(() => rankUp(db, accountId, 1, 2, 0), /broken/);
  assert.deepEqual(numbersOf(db, accountId), [1, 2]);
});

test("the password is stored as an argon2id hash", async () => {
  const db = openDatabase(":memory:");
  await createAccount(db, { accountName: "judy", displayName: "Judy", password: "correct horse battery" });
  const { password_hash } = db.prepare("SELECT password_hash FROM accounts").get() as { password_hash: string };
  assert.match(password_hash, /^\$argon2id\$/);
  assert.doesNotMatch(password_hash, /correct horse/);
});
