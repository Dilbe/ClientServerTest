// Rewards at the end of a game, on a real (in-memory) database: XP for kills
// whether the dungeon is won or lost, silver only for a win, one-time
// rewards only for a player's first win of a dungeon on each difficulty,
// kill counts for diminishing returns, and all of them still there after a
// restart (design.md, Rewards).

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import type { TurnMessage } from "../shared/protocol.ts";
import { FIRST_DUNGEON } from "../shared/rules/dungeon-map.ts";
import { fromOffset } from "../shared/rules/hex.ts";
import { baseStats, MONSTER_TYPES } from "../shared/rules/stats.ts";
import type { Plan } from "../shared/rules/turn.ts";
import { silverOf } from "./accounts.ts";
import { charactersOfAccount, insertCharacter } from "./characters.ts";
import { openDatabase, type Db } from "./database.ts";
import { dungeonWinsOf, hasWon, recordFirstWin } from "./dungeons-won.ts";
import { GameManager, type GameCharacter } from "./game-manager.ts";
import { SqliteGameStore } from "./game-store.ts";

const CYCLE = 10_000;
/** A "random" that never swaps anything: Ann is character 1 and acts first, monster 0 follows her. */
const noShuffle = () => 0.999;
const ANN = 1;

function addPlayer(db: Db, name: string, stats = baseStats()): GameCharacter {
  const accountId = Number(
    db
      .prepare(
        `INSERT INTO accounts (account_name, account_name_key, display_name, password_hash, created_at)
         VALUES (?, ?, ?, 'not a real hash', 0)`,
      )
      .run(name, name.toLowerCase(), name).lastInsertRowid,
  );
  const recordId = insertCharacter(db, accountId, 0);
  return { recordId, accountId, displayName: name, characterName: "Adventurer 1", stats, maxXpGain: 450, wonDungeonBefore: false, earlierKills: [] };
}

function startServer(db: Db) {
  const turns: TurnMessage[] = [];
  const games = new GameManager({ cycleMs: CYCLE, onTurn: (t) => turns.push(t), random: noShuffle, store: new SqliteGameStore(db) });
  games.restore();
  /** Advances in 1-second steps, like the real timer, until the game is over (or the time is up). */
  const runToEnd = (gameId: string, accountId: number) => {
    for (let i = 0; i < 2000 && games.snapshot(gameId, accountId)?.result === null; i++) games.advance(1000);
    return games.snapshot(gameId, accountId)!.result;
  };
  return { games, turns, runToEnd };
}

/**
 * The first dungeon with monsters of 1 hit point, and Ann with 8 actions:
 * enough to enter the room, walk along row 1 to the monsters and kill
 * monster 0 in her first turn (and with `killBoth`, monster 1 too).
 */
function setup(t: TestContext, killBoth: boolean) {
  t.mock.property(MONSTER_TYPES.basic, "stats", { ...MONSTER_TYPES.basic.stats, hitPoints: 1 });
  const db = openDatabase(":memory:");
  const ann = addPlayer(db, "Ann", { ...baseStats(), actions: 8 });
  const ben = addPlayer(db, "Ben");
  const server = startServer(db);
  server.games.start("g", [ann, ben]);
  assert.equal(server.games.setPlan("g", ann.accountId, ANN, annsPlan(killBoth)), undefined);
  return { db, ann, ben, server };
}

/** Ann's first turn: kill monster 0, and with `killBoth` monster 1 too (see `setup`). */
function annsPlan(killBoth: boolean): Plan {
  const plan: Plan = [
    { type: "place", hex: fromOffset(0, 1) },
    { type: "move", to: fromOffset(1, 1) },
    { type: "move", to: fromOffset(2, 1) },
    { type: "move", to: fromOffset(3, 1) },
    { type: "move", to: fromOffset(4, 1) },
    { type: "attack", monsterId: 0 },
  ];
  if (killBoth) plan.push({ type: "move", to: fromOffset(4, 2) }, { type: "attack", monsterId: 1 });
  return plan;
}

function xpOf(db: Db, character: GameCharacter): number {
  return charactersOfAccount(db, character.accountId)[0]!.data.xp;
}

test("a won dungeon gives every character the XP of every kill and every player the silver", (t) => {
  const { db, ann, ben, server } = setup(t, true);
  assert.equal(server.runToEnd("g", ann.accountId), "won");
  const xp = 2 * MONSTER_TYPES.basic.xp;
  assert.equal(xpOf(db, ann), xp);
  assert.equal(xpOf(db, ben), xp);
  assert.equal(silverOf(db, ann.accountId), FIRST_DUNGEON.silverReward);
  assert.equal(silverOf(db, ben.accountId), FIRST_DUNGEON.silverReward);

  // What the result screen shows.
  const snapshot = server.games.snapshot("g", ben.accountId)!;
  assert.deepEqual(
    snapshot.state.characters.map((c) => c.xpGained),
    [xp, xp],
  );
  assert.equal(snapshot.silverReward, FIRST_DUNGEON.silverReward);

  // After a restart the rewards are still there, and rebuilding the game
  // from its events doesn't pay them out a second time.
  const after = startServer(db);
  after.games.advance(60_000);
  assert.equal(after.games.snapshot("g", ann.accountId)!.result, "won");
  assert.equal(xpOf(db, ann), xp);
  assert.equal(silverOf(db, ben.accountId), FIRST_DUNGEON.silverReward);
});

test("a lost dungeon keeps the XP but gives no silver", (t) => {
  const { db, ann, ben, server } = setup(t, false);
  // Ann kills monster 0; nobody plans anything after that, so monster 1 kills both.
  assert.equal(server.runToEnd("g", ann.accountId), "lost");
  assert.equal(xpOf(db, ann), MONSTER_TYPES.basic.xp);
  assert.equal(xpOf(db, ben), MONSTER_TYPES.basic.xp);
  assert.equal(silverOf(db, ann.accountId), 0);
  assert.equal(silverOf(db, ben.accountId), 0);

  startServer(db);
  assert.equal(xpOf(db, ann), MONSTER_TYPES.basic.xp);
});

/** The kills stored with the player's first character. */
function killsOf(db: Db, character: GameCharacter) {
  return charactersOfAccount(db, character.accountId)[0]!.data.kills;
}

test("every monster that died counts as a kill for every character (diminishing returns)", (t) => {
  const { db, ann, ben, server } = setup(t, true);
  assert.equal(server.runToEnd("g", ann.accountId), "won");
  assert.deepEqual(killsOf(db, ann), { first: { normal: [1, 1] } });
  assert.deepEqual(killsOf(db, ben), { first: { normal: [1, 1] } });
  // Rebuilding the game after a restart doesn't count them again.
  startServer(db).games.advance(60_000);
  assert.deepEqual(killsOf(db, ann), { first: { normal: [1, 1] } });
});

test("the kills of a lost dungeon count too", (t) => {
  const { db, ann, ben, server } = setup(t, false);
  // Only monster 0 dies.
  assert.equal(server.runToEnd("g", ann.accountId), "lost");
  assert.deepEqual(killsOf(db, ann), { first: { normal: [1] } });
  assert.deepEqual(killsOf(db, ben), { first: { normal: [1] } });
});

test("a kill counts also for a character that gains nothing from it", (t) => {
  t.mock.property(MONSTER_TYPES.basic, "stats", { ...MONSTER_TYPES.basic.stats, hitPoints: 1 });
  const db = openDatabase(":memory:");
  const ann = addPlayer(db, "Ann", { ...baseStats(), actions: 8 });
  const ben = { ...addPlayer(db, "Ben"), maxXpGain: 0 };
  const server = startServer(db);
  server.games.start("g", [ann, ben]);
  assert.equal(server.games.setPlan("g", ann.accountId, ANN, annsPlan(true)), undefined);
  assert.equal(server.runToEnd("g", ann.accountId), "won");
  assert.equal(xpOf(db, ben), 0);
  assert.deepEqual(killsOf(db, ben), { first: { normal: [1, 1] } });
});

test("a second clear gives less XP for the monsters killed before, counted per difficulty", (t) => {
  // 1 hit point on Normal is 3 on Hard: Ann hits for 3, so one attack still kills.
  t.mock.property(MONSTER_TYPES.basic, "stats", { ...MONSTER_TYPES.basic.stats, hitPoints: 1 });
  const db = openDatabase(":memory:");
  const ann = addPlayer(db, "Ann", { ...baseStats(), actions: 8, attackDamage: 3 });
  const server = startServer(db);
  const earlierKills = (difficulty: "normal" | "hard") =>
    charactersOfAccount(db, ann.accountId)[0]!.data.kills.first?.[difficulty] ?? [];
  const play = (gameId: string, difficulty: "normal" | "hard") => {
    server.games.start(gameId, [{ ...ann, earlierKills: earlierKills(difficulty) }], FIRST_DUNGEON, undefined, difficulty);
    assert.equal(server.games.setPlan(gameId, ann.accountId, ANN, annsPlan(true)), undefined);
    assert.equal(server.runToEnd(gameId, ann.accountId), "won");
    return server.games.snapshot(gameId, ann.accountId)!.state.characters[0]!.xpGained;
  };
  // Two monsters of 10 XP: 20, then 2 × 9, then 2 × 8.
  assert.equal(play("g1", "normal"), 20);
  assert.equal(play("g2", "normal"), 18);
  assert.equal(play("g3", "normal"), 16);
  // Hard has its own counts: full XP again.
  assert.equal(play("g4", "hard"), 60);
  assert.deepEqual(charactersOfAccount(db, ann.accountId)[0]!.data.kills, { first: { normal: [3, 3], hard: [1, 1] } });
});

test("the character records aren't touched until the game ends", (t) => {
  const { db, ann, server } = setup(t, false);
  server.games.advance(CYCLE); // Ann's first turn: monster 0 dies.
  assert.equal(server.games.snapshot("g", ann.accountId)!.state.characters[0]!.xpGained, MONSTER_TYPES.basic.xp);
  assert.equal(xpOf(db, ann), 0);
});

/** The numbers of the account's characters. */
function numbersOf(db: Db, character: GameCharacter): number[] {
  return charactersOfAccount(db, character.accountId).map((c) => c.number);
}

test("a first win of a dungeon gives a new character, a second win doesn't", (t) => {
  const { db, ann, ben, server } = setup(t, true);
  assert.equal(server.runToEnd("g", ann.accountId), "won");
  // Both players win the first dungeon for the first time.
  assert.deepEqual(numbersOf(db, ann), [1, 2]);
  assert.deepEqual(numbersOf(db, ben), [1, 2]);
  assert.deepEqual(dungeonWinsOf(db, ann.accountId), [{ dungeonId: "first", difficulty: "normal" }]);
  // The new character is a level 1, rank 1 adventurer without XP or a name.
  assert.deepEqual(charactersOfAccount(db, ann.accountId)[1]!.data, {
    version: 6,
    class: "adventurer",
    rank: 1,
    xp: 0,
    upgrades: [],
    kills: {},
  });
  // What the result screen shows.
  assert.deepEqual(server.games.snapshot("g", ann.accountId)!.oneTimeRewards, FIRST_DUNGEON.oneTimeRewards);

  // Ann wins it again, alone: silver, but no new character.
  const silverBefore = silverOf(db, ann.accountId);
  server.games.start("g2", [{ ...ann, wonDungeonBefore: hasWon(db, ann.accountId, "first", "normal") }]);
  assert.deepEqual(server.games.snapshot("g2", ann.accountId)!.oneTimeRewards, []);
  assert.equal(server.games.setPlan("g2", ann.accountId, ANN, annsPlan(true)), undefined);
  assert.equal(server.runToEnd("g2", ann.accountId), "won");
  assert.equal(silverOf(db, ann.accountId), silverBefore + FIRST_DUNGEON.silverReward);
  assert.deepEqual(numbersOf(db, ann), [1, 2]);
});

test("in a party where one player has won the dungeon before, only the other gets the one-time rewards", (t) => {
  t.mock.property(MONSTER_TYPES.basic, "stats", { ...MONSTER_TYPES.basic.stats, hitPoints: 1 });
  const db = openDatabase(":memory:");
  const ann = addPlayer(db, "Ann", { ...baseStats(), actions: 8 });
  const ben = addPlayer(db, "Ben");
  recordFirstWin(db, ann.accountId, "first", "normal", [], 0);
  const server = startServer(db);
  server.games.start("g", [ann, ben].map((c) => ({ ...c, wonDungeonBefore: hasWon(db, c.accountId, "first", "normal") })));
  // Each player sees what they will get for a win.
  assert.deepEqual(server.games.snapshot("g", ann.accountId)!.oneTimeRewards, []);
  assert.deepEqual(server.games.snapshot("g", ben.accountId)!.oneTimeRewards, FIRST_DUNGEON.oneTimeRewards);
  assert.equal(server.games.setPlan("g", ann.accountId, ANN, annsPlan(true)), undefined);

  assert.equal(server.runToEnd("g", ann.accountId), "won");
  assert.deepEqual(numbersOf(db, ann), [1]);
  assert.deepEqual(numbersOf(db, ben), [1, 2]);
  assert.deepEqual(dungeonWinsOf(db, ben.accountId), [{ dungeonId: "first", difficulty: "normal" }]);
});

test("a lost dungeon gives no one-time rewards and doesn't count as won", (t) => {
  const { db, ann, ben, server } = setup(t, false);
  assert.equal(server.runToEnd("g", ann.accountId), "lost");
  assert.deepEqual(numbersOf(db, ann), [1]);
  assert.deepEqual(numbersOf(db, ben), [1]);
  assert.deepEqual(dungeonWinsOf(db, ann.accountId), []);
});

test("the one-time rewards survive a restart and aren't given again when the game is rebuilt", (t) => {
  const { db, ann, ben, server } = setup(t, true);
  assert.equal(server.runToEnd("g", ann.accountId), "won");

  const after = startServer(db);
  after.games.advance(60_000);
  assert.deepEqual(numbersOf(db, ann), [1, 2]);
  assert.deepEqual(numbersOf(db, ben), [1, 2]);
  assert.deepEqual(dungeonWinsOf(db, ben.accountId), [{ dungeonId: "first", difficulty: "normal" }]);
  // A player who comes back after the restart still sees what they got.
  assert.deepEqual(after.games.snapshot("g", ben.accountId)!.oneTimeRewards, FIRST_DUNGEON.oneTimeRewards);
});

test("recording a first win twice gives the rewards once", () => {
  const db = openDatabase(":memory:");
  const ann = addPlayer(db, "Ann");
  recordFirstWin(db, ann.accountId, "first", "normal", FIRST_DUNGEON.oneTimeRewards, 0);
  recordFirstWin(db, ann.accountId, "first", "normal", FIRST_DUNGEON.oneTimeRewards, 0);
  assert.deepEqual(numbersOf(db, ann), [1, 2]);
});

test("a first win on Hard gives the one-time rewards again, with the Hard XP", (t) => {
  // 1 hit point on Normal is 3 on Hard: Ann hits for 3, so one attack still kills.
  t.mock.property(MONSTER_TYPES.basic, "stats", { ...MONSTER_TYPES.basic.stats, hitPoints: 1 });
  const db = openDatabase(":memory:");
  const ann = addPlayer(db, "Ann", { ...baseStats(), actions: 8, attackDamage: 3 });
  recordFirstWin(db, ann.accountId, "first", "normal", [], 0);
  const server = startServer(db);
  const wonDungeonBefore = hasWon(db, ann.accountId, "first", "hard");
  assert.equal(wonDungeonBefore, false);
  server.games.start("g", [{ ...ann, wonDungeonBefore }], FIRST_DUNGEON, undefined, "hard");
  assert.deepEqual(server.games.snapshot("g", ann.accountId)!.oneTimeRewards, FIRST_DUNGEON.oneTimeRewards);
  assert.equal(server.games.setPlan("g", ann.accountId, ANN, annsPlan(true)), undefined);

  assert.equal(server.runToEnd("g", ann.accountId), "won");
  assert.deepEqual(numbersOf(db, ann), [1, 2]);
  assert.equal(xpOf(db, ann), 2 * MONSTER_TYPES.basic.xp * 3);
  assert.deepEqual(dungeonWinsOf(db, ann.accountId), [
    { dungeonId: "first", difficulty: "normal" },
    { dungeonId: "first", difficulty: "hard" },
  ]);
});
