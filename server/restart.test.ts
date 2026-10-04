// A server restart in the middle of a game, over real WebSocket connections:
// the second server runs on the same database as the first, the players
// reconnect with the cookies they already had, and find their game as it was.

import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { openDatabase } from "./database.ts";
import { startTestServer, type TestSocket } from "./test-helpers.ts";

function send(socket: TestSocket, message: unknown): void {
  socket.ws.send(JSON.stringify(message));
}

async function lobbyWhere(socket: TestSocket, matches: (lobby: any) => boolean): Promise<any> {
  for (;;) {
    const lobby = await socket.nextOf("lobby");
    if (matches(lobby)) return lobby;
  }
}

test("a running game survives a restart, with its plans and turn times", async () => {
  const db = openDatabase(":memory:");
  const first = await startTestServer({ db, turnCycleMs: 60_000 });
  const annCookie = await first.signup("ann", "Ann");
  const benCookie = await first.signup("ben", "Ben");
  const ann = await first.connect(annCookie);
  const ben = await first.connect(benCookie);

  send(ann, { type: "create-game" });
  const open = await lobbyWhere(ben, (l) => l.openGames.length > 0);
  send(ben, { type: "join-game", gameId: open.openGames[0].id });
  await lobbyWhere(ann, (l) => l.myGame?.players.length === 2);
  send(ann, { type: "start-game" });
  const before = await ann.nextOf("game");
  const plan = { type: "place", hex: before.state.map.startHexes[1] };
  send(ann, { type: "set-plan", characterId: before.yourCharacters[0], plan });
  await ann.nextOf("plan");

  // The server stops. (A real stop ends the process, which closes the
  // connections with it; here the test closes them itself.)
  ann.ws.close();
  ben.ws.close();
  await Promise.all([once(ann.ws, "close"), once(ben.ws, "close")]);
  await first.close();

  // The lobby is empty after a restart, but the started game comes back, and
  // with it its players' place in the lobby.
  const second = await startTestServer({ db, turnCycleMs: 60_000 });
  const annAgain = await second.connect(annCookie);
  const lobby = await annAgain.nextOf("lobby");
  assert.equal(lobby.myGame.id, before.gameId);
  assert.equal(lobby.myGame.started, true);

  const after = await annAgain.nextOf("game");
  assert.equal(after.gameId, before.gameId);
  assert.equal(after.sequence, before.sequence);
  assert.deepEqual(after.state, before.state);
  assert.deepEqual(after.yourCharacters, before.yourCharacters);
  assert.deepEqual(after.plans, [{ characterId: before.yourCharacters[0], plan }]);
  // The same time left until each turn. The turn timer only moves the clock
  // once a second, so allow for one tick.
  assert.equal(after.nextTurns.length, before.nextTurns.length);
  after.nextTurns.forEach((t: any, i: number) => {
    assert.equal(t.characterId, before.nextTurns[i].characterId);
    assert.ok(Math.abs(t.inSeconds - before.nextTurns[i].inSeconds) <= 1, `${t.inSeconds}`);
  });

  annAgain.ws.close();
  await second.close();
  db.close();
});
