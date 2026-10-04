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

test("starting a game sends each player the game, and a reconnect sends it again", async () => {
  const eve = await server.connect(await server.signup("eve", "Eve"));
  const fay = await server.connect(await server.signup("fay", "Fay"));
  eve.ws.send(JSON.stringify({ type: "create-game" }));
  let fayView = await fay.nextOf("lobby");
  let eveGame = fayView.openGames.find((g: { creator: string }) => g.creator === "Eve");
  while (!eveGame) {
    fayView = await fay.nextOf("lobby");
    eveGame = fayView.openGames.find((g: { creator: string }) => g.creator === "Eve");
  }
  fay.ws.send(JSON.stringify({ type: "join-game", gameId: eveGame.id }));
  eve.ws.send(JSON.stringify({ type: "start-game" }));

  const forEve = await eve.nextOf("game");
  const forFay = await fay.nextOf("game");
  // The same game, except that each is told which character is theirs.
  assert.deepEqual({ ...forFay, yourCharacters: [] }, { ...forEve, yourCharacters: [] });
  assert.equal(forEve.yourCharacters.length, 1);
  assert.equal(forFay.yourCharacters.length, 1);
  assert.notEqual(forEve.yourCharacters[0], forFay.yourCharacters[0]);
  assert.equal(forEve.gameId, eveGame.id);
  assert.equal(forEve.sequence, 0);
  assert.deepEqual(forEve.players.map((p: { displayName: string }) => p.displayName).sort(), ["Eve", "Fay"]);
  assert.equal(forEve.state.characters.length, 2);
  assert.equal(forEve.state.monsters.length, 2);
  // The first turn is a full cycle away (60 seconds in the test server).
  assert.equal(forEve.nextTurns[0].inSeconds, 60);

  fay.ws.close();
  await once(fay.ws, "close");
  const fayAgain = await server.connect(await loginCookie("fay"));
  const snapshot = await fayAgain.nextOf("game");
  assert.equal(snapshot.gameId, eveGame.id);
  assert.deepEqual(snapshot.yourCharacters, forFay.yourCharacters);

  eve.ws.close();
  fayAgain.ws.close();
});

test("get-game sends a new snapshot of the player's own game, and is refused outside a game", async () => {
  const gus = await server.connect(await server.signup("gus", "Gus"));
  gus.ws.send(JSON.stringify({ type: "get-game" }));
  assert.equal((await gus.nextOf("refused")).reason, "You are not in a running game.");

  gus.ws.send(JSON.stringify({ type: "create-game" }));
  gus.ws.send(JSON.stringify({ type: "start-game" }));
  const first = await gus.nextOf("game");
  gus.ws.send(JSON.stringify({ type: "get-game" }));
  const again = await gus.nextOf("game");
  assert.equal(again.gameId, first.gameId);
  assert.deepEqual(again.yourCharacters, first.yourCharacters);
  gus.ws.close();
});

test("a plan is sent live to everyone in the game, and only the character's player may set it", async () => {
  const hal = await server.connect(await server.signup("hal", "Hal"));
  const ivy = await server.connect(await server.signup("ivy", "Ivy"));
  hal.ws.send(JSON.stringify({ type: "create-game" }));
  let ivyView = await ivy.nextOf("lobby");
  let halGame = ivyView.openGames.find((g: { creator: string }) => g.creator === "Hal");
  while (!halGame) {
    ivyView = await ivy.nextOf("lobby");
    halGame = ivyView.openGames.find((g: { creator: string }) => g.creator === "Hal");
  }
  ivy.ws.send(JSON.stringify({ type: "join-game", gameId: halGame.id }));
  hal.ws.send(JSON.stringify({ type: "start-game" }));
  const halsCharacter = (await hal.nextOf("game")).yourCharacters[0];
  const ivysCharacter = (await ivy.nextOf("game")).yourCharacters[0];

  const plan = { type: "place", hex: { q: 0, r: 1 } };
  hal.ws.send(JSON.stringify({ type: "set-plan", characterId: halsCharacter, plan }));
  const expected = { type: "plan", gameId: halGame.id, characterId: halsCharacter, plan };
  // Both players get it, the one who set it too.
  assert.deepEqual(await ivy.nextOf("plan"), expected);
  assert.deepEqual(await hal.nextOf("plan"), expected);

  // Hal can't plan for Ivy's character; nobody hears about the attempt.
  hal.ws.send(JSON.stringify({ type: "set-plan", characterId: ivysCharacter, plan }));
  assert.equal((await hal.nextOf("refused")).reason, "That is not your character.");

  hal.ws.send(JSON.stringify({ type: "clear-plan", characterId: halsCharacter }));
  assert.deepEqual(await ivy.nextOf("plan"), { ...expected, plan: null });

  // A reconnect sees the current plans in the snapshot.
  ivy.ws.send(JSON.stringify({ type: "set-plan", characterId: ivysCharacter, plan }));
  await ivy.nextOf("plan");
  ivy.ws.send(JSON.stringify({ type: "get-game" }));
  assert.deepEqual((await ivy.nextOf("game")).plans, [{ characterId: ivysCharacter, plan }]);

  hal.ws.close();
  ivy.ws.close();
});

test("planning outside a running game is refused", async () => {
  const jon = await server.connect(await server.signup("jon", "Jon"));
  jon.ws.send(JSON.stringify({ type: "clear-plan", characterId: 1 }));
  assert.equal((await jon.nextOf("refused")).reason, "You are not in a running game.");
  jon.ws.close();
});

async function loginCookie(accountName: string): Promise<string> {
  const response = await server.post("/api/login", { accountName, password: "correct horse battery" });
  return response.headers.getSetCookie()[0]!.split(";")[0]!;
}
