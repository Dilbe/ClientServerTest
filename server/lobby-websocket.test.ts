// The lobby over real WebSocket connections, with two players.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { startTestServer } from "./test-helpers.ts";

const server = await startTestServer();
after(() => server.close());

test("two players form a party and start a game, seeing each other's changes live", async () => {
  const ann = await server.connect(await server.signup("ann", "Ann"));
  const ben = await server.connect(await server.signup("ben", "Ben"));

  ann.ws.send(JSON.stringify({ type: "create-game" }));
  const seenByBen = await ben.nextOf("lobby");
  // Ben may first get the snapshot from his own connect; wait for the game.
  const lobbyForBen = seenByBen.openGames.length > 0 ? seenByBen : await ben.nextOf("lobby");
  const game = lobbyForBen.openGames[0];
  assert.equal(game.creator, "Ann");

  ben.ws.send(JSON.stringify({ type: "join-game", gameId: game.id }));
  let annView = await ann.nextOf("lobby");
  while (annView.myGame?.players.length !== 2) annView = await ann.nextOf("lobby");
  assert.deepEqual(
    annView.myGame.players.map((p: { displayName: string }) => p.displayName),
    ["Ann", "Ben"],
  );

  // Ben isn't the creator.
  ben.ws.send(JSON.stringify({ type: "start-game" }));
  assert.match((await ben.nextOf("refused")).reason, /Only the player who created/);

  ann.ws.send(JSON.stringify({ type: "start-game" }));
  let benView = await ben.nextOf("lobby");
  while (!benView.myGame?.started) benView = await ben.nextOf("lobby");
  assert.deepEqual(benView.openGames, []);

  // A reconnect brings Ben straight back to the started game.
  ben.ws.close();
  await once(ben.ws, "close");
  const benAgain = await server.connect(await loginCookie("ben"));
  const snapshot = await benAgain.nextOf("lobby");
  assert.equal(snapshot.myGame.started, true);

  ann.ws.close();
  benAgain.ws.close();
});

test("others see a player go offline, and the player stays in the game", async () => {
  const cat = await server.connect(await server.signup("cat", "Cat"));
  cat.ws.send(JSON.stringify({ type: "create-game" }));
  await cat.nextOf("lobby");

  const dan = await server.connect(await server.signup("dan", "Dan"));
  const catGame = (await dan.nextOf("lobby")).openGames.find((g: { creator: string }) => g.creator === "Cat");
  assert.equal(catGame.players[0].online, true);

  cat.ws.close();
  const update = await dan.nextOf("lobby");
  const after = update.openGames.find((g: { creator: string }) => g.creator === "Cat");
  assert.equal(after.players[0].online, false);
  dan.ws.close();
});

async function loginCookie(accountName: string): Promise<string> {
  const response = await server.post("/api/login", { accountName, password: "correct horse battery" });
  return response.headers.getSetCookie()[0]!.split(";")[0]!;
}
