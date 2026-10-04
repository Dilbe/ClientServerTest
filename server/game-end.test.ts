// The end of a game over real WebSocket connections: lobby → game → result →
// lobby (design.md, The end of a game).
//
// The test server runs with a turn cycle of 1 millisecond. The turn timer
// still ticks once a second, so the first tick after the start fires every
// turn at once: without plans the characters stand still, the monsters kill
// them, and the game is lost within about a second.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { startTestServer, type TestSocket } from "./test-helpers.ts";

const server = await startTestServer({ turnCycleMs: 1 });
after(() => server.close());

/** Skips messages until a lobby message that matches. */
async function lobbyWhere(socket: TestSocket, matches: (lobby: any) => boolean): Promise<any> {
  for (;;) {
    const lobby = await socket.nextOf("lobby");
    if (matches(lobby)) return lobby;
  }
}

/** Skips turns until the one that ends the game, and returns its result. */
async function gameEnd(socket: TestSocket): Promise<string> {
  for (;;) {
    const turn = await socket.nextOf("turn");
    const ended = turn.events.find((e: { type: string }) => e.type === "gameEnded");
    if (ended) return ended.result;
  }
}

async function loginCookie(accountName: string): Promise<string> {
  const response = await server.post("/api/login", { accountName, password: "correct horse battery" });
  return response.headers.getSetCookie()[0]!.split(";")[0]!;
}

function send(socket: TestSocket, message: unknown): void {
  socket.ws.send(JSON.stringify(message));
}

test("the full loop: lobby, game, result, and back to the lobby", async () => {
  const ann = await server.connect(await server.signup("ann", "Ann"));
  const ben = await server.connect(await server.signup("ben", "Ben"));

  // Lobby: Ann creates a game, Ben joins, Ann starts.
  send(ann, { type: "create-game" });
  const open = await lobbyWhere(ben, (l) => l.openGames.length > 0);
  send(ben, { type: "join-game", gameId: open.openGames[0].id });
  await lobbyWhere(ann, (l) => l.myGame?.players.length === 2);
  send(ann, { type: "start-game" });
  const game = await ann.nextOf("game");
  assert.equal(game.result, null);

  // Game: nobody plans, so the party loses.
  assert.equal(await gameEnd(ann), "lost");
  assert.equal(await gameEnd(ben), "lost");

  // Result: the finished game stays, so a player who reconnects still sees
  // how it ended. Its clock has stopped and nothing can be planned any more.
  ben.ws.close();
  await once(ben.ws, "close");
  const benAgain = await server.connect(await loginCookie("ben"));
  const finished = await benAgain.nextOf("game");
  assert.equal(finished.gameId, game.gameId);
  assert.equal(finished.result, "lost");
  assert.deepEqual(finished.nextTurns, []);
  send(benAgain, { type: "set-plan", characterId: finished.yourCharacters[0], plan: { type: "move", to: { q: 0, r: 0 } } });
  assert.equal((await benAgain.nextOf("refused")).reason, "The game is over.");

  // Back to the lobby: Ann goes first. Her account is free at once, while
  // Ben is still looking at the result.
  send(ann, { type: "leave-game" });
  await lobbyWhere(ann, (l) => l.myGame === null);
  const benStill = await lobbyWhere(benAgain, (l) => l.myGame?.players.length === 1);
  assert.equal(benStill.myGame.started, true);
  send(benAgain, { type: "get-game" });
  assert.equal((await benAgain.nextOf("game")).result, "lost");

  send(ann, { type: "create-game" });
  const annNew = await lobbyWhere(ann, (l) => l.myGame !== null);
  assert.notEqual(annNew.myGame.id, game.gameId);

  // Ben goes back too: the last player has left, so the game is removed.
  send(benAgain, { type: "leave-game" });
  await lobbyWhere(benAgain, (l) => l.myGame === null);
  send(benAgain, { type: "get-game" });
  assert.equal((await benAgain.nextOf("refused")).reason, "You are not in a running game.");

  // And round again: the same two accounts play a new game together.
  send(benAgain, { type: "join-game", gameId: annNew.myGame.id });
  await lobbyWhere(ann, (l) => l.myGame?.players.length === 2);
  send(ann, { type: "start-game" });
  const second = await benAgain.nextOf("game");
  assert.equal(second.gameId, annNew.myGame.id);
  assert.equal(second.sequence, 0);
  assert.equal(second.result, null);

  ann.ws.close();
  benAgain.ws.close();
});
