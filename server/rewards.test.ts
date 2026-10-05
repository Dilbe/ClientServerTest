// Rewards at the end of a game, on a real (in-memory) database: XP for kills
// whether the dungeon is won or lost, silver only for a win, and both still
// there after a restart (design.md, Rewards).

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
  return { recordId, accountId, displayName: name, stats, maxXpGain: 450 };
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
  const plan: Plan = [
    { type: "place", hex: fromOffset(0, 1) },
    { type: "move", to: fromOffset(1, 1) },
    { type: "move", to: fromOffset(2, 1) },
    { type: "move", to: fromOffset(3, 1) },
    { type: "move", to: fromOffset(4, 1) },
    { type: "attack", monsterId: 0 },
  ];
  if (killBoth) plan.push({ type: "move", to: fromOffset(4, 2) }, { type: "attack", monsterId: 1 });
  assert.equal(server.games.setPlan("g", ann.accountId, ANN, plan), undefined);
  return { db, ann, ben, server };
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

test("the character records aren't touched until the game ends", (t) => {
  const { db, ann, server } = setup(t, false);
  server.games.advance(CYCLE); // Ann's first turn: monster 0 dies.
  assert.equal(server.games.snapshot("g", ann.accountId)!.state.characters[0]!.xpGained, MONSTER_TYPES.basic.xp);
  assert.equal(xpOf(db, ann), 0);
});
