// Restarting the server in the middle of a game. A "restart" here is a new
// GameManager on the same database: everything in memory is gone, and the
// new one has to rebuild its games from the stored events.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { TurnMessage } from "../shared/protocol.ts";
import { FIRST_DUNGEON_MAP } from "../shared/rules/dungeon-map.ts";
import { baseStats } from "../shared/rules/stats.ts";
import { insertCharacter } from "./characters.ts";
import { openDatabase, type Db } from "./database.ts";
import { GameManager, type GameCharacter } from "./game-manager.ts";
import { SqliteGameStore } from "./game-store.ts";

const CYCLE = 10_000;
/** No shuffling: Ann is character 1, Ben character 2. */
const noShuffle = () => 0.999;
const ANN = 1;
const BEN = 2;

function addPlayer(db: Db, name: string): GameCharacter {
  const accountId = Number(
    db
      .prepare(
        `INSERT INTO accounts (account_name, account_name_key, display_name, password_hash, created_at)
         VALUES (?, ?, ?, 'not a real hash', 0)`,
      )
      .run(name, name.toLowerCase(), name).lastInsertRowid,
  );
  const recordId = insertCharacter(db, accountId, 0);
  return { recordId, accountId, displayName: name, characterName: "Adventurer 1", stats: baseStats(), maxXpGain: 450, wonDungeonBefore: false };
}

function setup() {
  const db = openDatabase(":memory:");
  const ann = addPlayer(db, "Ann");
  const ben = addPlayer(db, "Ben");
  return { db, ann, ben, server: startServer(db) };
}

/** A server process: a game manager on the database, rebuilt from what is stored. */
function startServer(db: Db) {
  const turns: TurnMessage[] = [];
  const games = new GameManager({
    cycleMs: CYCLE,
    onTurn: (t) => turns.push(t),
    random: noShuffle,
    store: new SqliteGameStore(db),
  });
  const restored = games.restore();
  /** Advances in 1-second steps, like the real timer. */
  const run = (seconds: number) => {
    for (let i = 0; i < seconds; i++) games.advance(1000);
  };
  return { games, turns, restored, run };
}

test("after a normal shutdown a game continues exactly where it was", () => {
  const { db, ann, ben, server } = setup();
  server.games.start("g", [ann, ben]);
  server.games.setPlan("g", ann.accountId, ANN, [{ type: "place", hex: FIRST_DUNGEON_MAP.startHexes[2]! }]);
  server.run(12); // Ann's first turn fires at 10 s.
  server.games.setPlan("g", ben.accountId, BEN, [{ type: "place", hex: FIRST_DUNGEON_MAP.startHexes[1]! }]);
  server.games.saveClock(); // the shutdown

  const after = startServer(db);
  assert.deepEqual(after.restored, [
    {
      gameId: "g",
      players: [
        { accountId: ann.accountId, displayName: "Ann" },
        { accountId: ben.accountId, displayName: "Ben" },
      ],
    },
  ]);
  // The same state, plans, sequence number and time left until each turn.
  for (const account of [ann, ben]) {
    assert.deepEqual(after.games.snapshot("g", account.accountId), server.games.snapshot("g", account.accountId));
  }
  assert.equal(after.games.snapshot("g", ann.accountId)!.sequence, 1);
  assert.deepEqual(after.games.snapshot("g", ann.accountId)!.nextTurns, [
    { characterId: BEN, inSeconds: 3 },
    { characterId: ANN, inSeconds: 8 },
  ]);

  // And from here the restarted game plays out exactly like the original
  // would have: the original manager stands in for "no restart". (It shares
  // the database, which only receives a second copy of the same events.)
  server.run(60);
  after.run(60);
  assert.ok(after.turns.length > 0);
  assert.deepEqual(after.turns, server.turns.slice(1));
});

test("after a crash, only the game time since the last heartbeat is lost", () => {
  const { db, ann, ben, server } = setup();
  server.games.start("g", [ann, ben]);
  // The server time is saved at 5 s (the heartbeat) and then crashes at
  // 7 s, without saving it again.
  server.run(7);

  const after = startServer(db);
  assert.deepEqual(after.games.snapshot("g", ann.accountId)!.nextTurns, [
    { characterId: ANN, inSeconds: 5 },
    { characterId: BEN, inSeconds: 10 },
  ]);
});

test("a turn is never resolved twice after a crash", () => {
  const { db, ann, ben, server } = setup();
  server.games.start("g", [ann, ben]);
  // Ann's turn fires at 10 s, between two heartbeats, and the server crashes
  // at 11 s. The turn saved the server time with it, so after the restart
  // the clock isn't before that turn.
  server.run(11);
  assert.equal(server.turns.length, 1);

  const after = startServer(db);
  const snapshot = after.games.snapshot("g", ann.accountId)!;
  assert.equal(snapshot.sequence, 1);
  assert.deepEqual(snapshot.nextTurns, [
    { characterId: BEN, inSeconds: 5 },
    { characterId: ANN, inSeconds: 10 },
  ]);
  after.run(5);
  assert.deepEqual(
    after.turns.map((t) => [t.sequence, t.characterId]),
    [[2, BEN]],
  );
});

test("players who went back to the lobby aren't put back in the game", () => {
  const { db, ann, ben, server } = setup();
  server.games.start("g", [ann, ben]);
  server.games.leave("g", ann.accountId);
  assert.deepEqual(startServer(db).restored, [
    { gameId: "g", players: [{ accountId: ben.accountId, displayName: "Ben" }] },
  ]);

  // The last one leaves: the game is closed and doesn't come back. It stays
  // in the database, though.
  server.games.leave("g", ben.accountId);
  server.games.remove("g");
  assert.deepEqual(startServer(db).restored, []);
  const types = db.prepare("SELECT type FROM game_events WHERE game_id = 'g' ORDER BY sequence").pluck().all();
  assert.deepEqual(types.at(-1), "gameClosed");
});

test("a finished game comes back with its result until its players have left", () => {
  const { db, ann, ben, server } = setup();
  server.games.start("g", [ann, ben]);
  // Without plans the monsters kill both characters.
  while (server.games.snapshot("g", ann.accountId)!.result === null) server.run(1);

  const after = startServer(db);
  assert.equal(after.games.snapshot("g", ben.accountId)!.result, "lost");
  assert.deepEqual(after.games.snapshot("g", ben.accountId)!.nextTurns, []);
});

test("a game whose stored events are broken is closed instead of stopping the server", (t) => {
  const { db, ann, ben, server } = setup();
  server.games.start("g", [ann, ben]);
  server.games.start("other", [addPlayer(db, "Cid")]);
  db.prepare("UPDATE game_events SET data = '{}' WHERE game_id = 'g'").run();

  t.mock.method(console, "error", () => {}); // The error is expected; keep the test output clean.
  assert.deepEqual(
    startServer(db).restored.map((g) => g.gameId),
    ["other"],
  );
  // Closed, so it isn't tried again on the next start.
  assert.deepEqual(
    startServer(db).restored.map((g) => g.gameId),
    ["other"],
  );
});

test("the event store holds only game-local character numbers", () => {
  const { db, ann, ben, server } = setup();
  server.games.start("g", [ann, ben]);
  server.run(30);
  const data = db.prepare("SELECT data FROM game_events").pluck().all().join("\n");
  // Accounts, character records and names are only in the link table.
  for (const text of ["accountId", "recordId", "Ann", "Ben"]) assert.ok(!data.includes(text), text);
});

test("a game stored before the actions stat (issue #43) still loads", () => {
  const { db, ann, ben, server } = setup();
  server.games.start("g", [ann, ben]);
  // A move before placement is cancelled, so the first turn has a planCancelled event.
  server.games.setPlan("g", ann.accountId, ANN, [{ type: "move", to: FIRST_DUNGEON_MAP.startHexes[0]! }]);
  server.run(12);
  server.games.setPlan("g", ben.accountId, BEN, [{ type: "place", hex: FIRST_DUNGEON_MAP.startHexes[1]! }]);
  server.games.saveClock();
  const before = server.games.snapshot("g", ann.accountId)!;
  assert.ok(server.turns[0]!.events.some((e) => e.type === "planCancelled"));

  // Write the events back the way the server stored them before: no actions
  // stat, a plan of one action instead of a list, and cancellations without
  // the number of the action.
  const rows = db.prepare("SELECT sequence, data FROM game_events WHERE game_id = 'g'").all() as {
    sequence: number;
    data: string;
  }[];
  for (const row of rows) {
    const data = JSON.parse(row.data);
    for (const c of data.state?.characters ?? []) delete c.stats.actions;
    if (Array.isArray(data.plan)) data.plan = data.plan[0];
    for (const e of data.events ?? []) delete e.action;
    db.prepare("UPDATE game_events SET data = ? WHERE game_id = 'g' AND sequence = ?").run(
      JSON.stringify(data),
      row.sequence,
    );
  }
  assert.ok(!(db.prepare("SELECT data FROM game_events").pluck().all() as string[]).join().includes('"actions"'));

  assert.deepEqual(startServer(db).games.snapshot("g", ann.accountId), before);
});

test("a game stored before rewards (issue #27) still loads", () => {
  const { db, ann, ben, server } = setup();
  server.games.start("g", [ann, ben]);
  server.run(12);
  server.games.saveClock();
  const before = server.games.snapshot("g", ann.accountId)!;

  // Write the start back the way the server stored it before: no XP in the
  // characters' state and no silver reward.
  const row = db.prepare("SELECT data FROM game_events WHERE game_id = 'g' AND sequence = 1").get() as { data: string };
  const data = JSON.parse(row.data);
  for (const c of data.state.characters) {
    delete c.xpGained;
    delete c.maxXpGain;
  }
  delete data.silverReward;
  db.prepare("UPDATE game_events SET data = ? WHERE game_id = 'g' AND sequence = 1").run(JSON.stringify(data));

  assert.deepEqual(startServer(db).games.snapshot("g", ann.accountId), before);
});

test("a game stored before one-time rewards (issue #31) still loads, and its win gives none", () => {
  const { db, ann, ben, server } = setup();
  server.games.start("g", [ann, ben]);
  server.games.saveClock();

  // Write the start back the way the server stored it before: no dungeon id
  // and no one-time rewards.
  const row = db.prepare("SELECT data FROM game_events WHERE game_id = 'g' AND sequence = 1").get() as { data: string };
  const data = JSON.parse(row.data);
  delete data.dungeonId;
  delete data.oneTimeRewards;
  delete data.firstWinCharacters;
  db.prepare("UPDATE game_events SET data = ? WHERE game_id = 'g' AND sequence = 1").run(JSON.stringify(data));

  const after = startServer(db);
  assert.equal(after.restored.length, 1);
  assert.deepEqual(after.games.snapshot("g", ann.accountId)!.oneTimeRewards, []);
});
