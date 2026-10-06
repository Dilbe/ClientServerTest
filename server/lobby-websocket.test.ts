// The lobby over real WebSocket connections, with two players.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { insertCharacter } from "./characters.ts";
import { recordFirstWin } from "./dungeons-won.ts";
import { startTestServer } from "./test-helpers.ts";

const server = await startTestServer();
after(() => server.close());

test("two players form a party and start a game, seeing each other's changes live", async () => {
  const ann = await server.connect(await server.signup("ann", "Ann"));
  const ben = await server.connect(await server.signup("ben", "Ben"));

  ann.ws.send(JSON.stringify({ type: "create-game", characters: [1] }));
  const seenByBen = await ben.nextOf("lobby");
  // Ben may first get the snapshot from his own connect; wait for the game.
  const lobbyForBen = seenByBen.openGames.length > 0 ? seenByBen : await ben.nextOf("lobby");
  const game = lobbyForBen.openGames[0];
  assert.equal(game.creator, "Ann");

  ben.ws.send(JSON.stringify({ type: "join-game", gameId: game.id, characters: [1] }));
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
  cat.ws.send(JSON.stringify({ type: "create-game", characters: [1] }));
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
  eve.ws.send(JSON.stringify({ type: "create-game", characters: [1], turnDuration: "slow" }));
  let fayView = await fay.nextOf("lobby");
  let eveGame = fayView.openGames.find((g: { creator: string }) => g.creator === "Eve");
  while (!eveGame) {
    fayView = await fay.nextOf("lobby");
    eveGame = fayView.openGames.find((g: { creator: string }) => g.creator === "Eve");
  }
  assert.equal(eveGame.turnDuration, "slow");
  fay.ws.send(JSON.stringify({ type: "join-game", gameId: eveGame.id, characters: [1] }));
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
  // The first turn is a full cycle away: the turn duration Eve chose.
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

  gus.ws.send(JSON.stringify({ type: "create-game", characters: [1] }));
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
  hal.ws.send(JSON.stringify({ type: "create-game", characters: [1] }));
  let ivyView = await ivy.nextOf("lobby");
  let halGame = ivyView.openGames.find((g: { creator: string }) => g.creator === "Hal");
  while (!halGame) {
    ivyView = await ivy.nextOf("lobby");
    halGame = ivyView.openGames.find((g: { creator: string }) => g.creator === "Hal");
  }
  ivy.ws.send(JSON.stringify({ type: "join-game", gameId: halGame.id, characters: [1] }));
  hal.ws.send(JSON.stringify({ type: "start-game" }));
  const halsCharacter = (await hal.nextOf("game")).yourCharacters[0];
  const ivysCharacter = (await ivy.nextOf("game")).yourCharacters[0];

  const plan = [{ type: "place", hex: { q: 0, r: 1 } }];
  hal.ws.send(JSON.stringify({ type: "set-plan", characterId: halsCharacter, plan }));
  const expected = { type: "plan", gameId: halGame.id, characterId: halsCharacter, plan };
  // Both players get it, the one who set it too.
  assert.deepEqual(await ivy.nextOf("plan"), expected);
  assert.deepEqual(await hal.nextOf("plan"), expected);

  // Hal can't plan for Ivy's character; nobody hears about the attempt.
  hal.ws.send(JSON.stringify({ type: "set-plan", characterId: ivysCharacter, plan }));
  assert.equal((await hal.nextOf("refused")).reason, "That is not your character.");

  // Nor plan more actions than the character has.
  hal.ws.send(JSON.stringify({ type: "set-plan", characterId: halsCharacter, plan: [...plan, ...plan] }));
  assert.equal((await hal.nextOf("refused")).reason, "That character has only 1 action(s) per turn.");

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

test("the creator chooses the dungeon, the others see it live, and the game starts in it", async () => {
  const kim = await server.connect(await server.signup("kim", "Kim"));
  const lou = await server.connect(await server.signup("lou", "Lou"));
  kim.ws.send(JSON.stringify({ type: "create-game", characters: [1] }));
  let louView = await lou.nextOf("lobby");
  let kimGame = louView.openGames.find((g: { creator: string }) => g.creator === "Kim");
  while (!kimGame) {
    louView = await lou.nextOf("lobby");
    kimGame = louView.openGames.find((g: { creator: string }) => g.creator === "Kim");
  }
  assert.equal(kimGame.dungeonId, "first");
  lou.ws.send(JSON.stringify({ type: "join-game", gameId: kimGame.id, characters: [1] }));

  // Only the creator chooses.
  lou.ws.send(JSON.stringify({ type: "choose-dungeon", dungeonId: "second" }));
  assert.match((await lou.nextOf("refused")).reason, /Only the player who created/);

  kim.ws.send(JSON.stringify({ type: "choose-dungeon", dungeonId: "second" }));
  louView = await lou.nextOf("lobby");
  while (louView.myGame?.dungeonId !== "second") louView = await lou.nextOf("lobby");

  kim.ws.send(JSON.stringify({ type: "start-game" }));
  const game = await lou.nextOf("game");
  assert.equal(game.state.map.hexes.length, 48);
  assert.equal(game.state.monsters.length, 4);
  assert.equal(game.silverReward, 20);

  kim.ws.close();
  lou.ws.close();
});

test("each player sees the dungeons they have won, and the game knows who gets the one-time rewards", async () => {
  const mia = await server.connect(await server.signup("mia", "Mia"));
  const ned = await server.connect(await server.signup("ned", "Ned"));
  const miaId = server.db.prepare("SELECT id FROM accounts WHERE account_name_key = 'mia'").pluck().get() as number;
  recordFirstWin(server.db, miaId, "first", [], 0);

  // Creating a game sends everyone a new lobby, each with their own dungeons won.
  mia.ws.send(JSON.stringify({ type: "create-game", characters: [1] }));
  let miaView = await mia.nextOf("lobby");
  while (miaView.myGame === null) miaView = await mia.nextOf("lobby");
  assert.deepEqual(miaView.dungeonsWon, ["first"]);
  let nedView = await ned.nextOf("lobby");
  while (!nedView.openGames.some((g: { creator: string }) => g.creator === "Mia")) nedView = await ned.nextOf("lobby");
  assert.deepEqual(nedView.dungeonsWon, []);

  ned.ws.send(JSON.stringify({ type: "join-game", gameId: miaView.myGame.id, characters: [1] }));
  nedView = await ned.nextOf("lobby");
  while (nedView.myGame === null) nedView = await ned.nextOf("lobby");
  mia.ws.send(JSON.stringify({ type: "start-game" }));
  assert.deepEqual((await mia.nextOf("game")).oneTimeRewards, []);
  assert.deepEqual((await ned.nextOf("game")).oneTimeRewards, [{ type: "newCharacter" }]);

  mia.ws.close();
  ned.ws.close();
});

test("players choose 1 to 3 of their own characters, see each other's choices live, and play with them", async () => {
  const oda = await server.connect(await server.signup("oda", "Oda"));
  const pim = await server.connect(await server.signup("pim", "Pim"));
  // Oda has three characters; the second one has a name.
  const odaId = accountId("oda");
  insertCharacter(server.db, odaId, 0);
  insertCharacter(server.db, odaId, 0);
  const second = server.db.prepare("SELECT id FROM characters WHERE account_id = ? AND number = 2").pluck().get(odaId);
  server.db
    .prepare("UPDATE characters SET data = json_set(data, '$.name', 'Runner') WHERE id = ?")
    .run(second as number);

  // The lobby lists each player's own characters to choose from.
  oda.ws.send(JSON.stringify({ type: "get-lobby" }));
  let odaView = await oda.nextOf("lobby");
  while (odaView.yourCharacters.length !== 3) odaView = await oda.nextOf("lobby");
  assert.deepEqual(odaView.yourCharacters, [
    { number: 1, name: "Adventurer 1", level: 1 },
    { number: 2, name: "Runner", level: 1 },
    { number: 3, name: "Adventurer 3", level: 1 },
  ]);

  // Only their own: Pim has no character 2. The schema refuses more than 3.
  pim.ws.send(JSON.stringify({ type: "create-game", characters: [2] }));
  assert.equal((await pim.nextOf("refused")).reason, "That is not your character.");
  oda.ws.send(JSON.stringify({ type: "create-game", characters: [1, 2, 3, 4] }));
  oda.ws.send(JSON.stringify({ type: "create-game", characters: [2, 3] }));
  odaView = await oda.nextOf("lobby");
  while (odaView.myGame === null) odaView = await oda.nextOf("lobby");
  assert.deepEqual(odaView.myGame.players[0].characters, [
    { number: 2, name: "Runner" },
    { number: 3, name: "Adventurer 3" },
  ]);

  pim.ws.send(JSON.stringify({ type: "join-game", gameId: odaView.myGame.id, characters: [1] }));
  // Oda changes her choice; Pim sees it live.
  oda.ws.send(JSON.stringify({ type: "choose-characters", characters: [1, 2, 3] }));
  let pimView = await pim.nextOf("lobby");
  while (pimView.myGame?.players[0].characters.length !== 3) pimView = await pim.nextOf("lobby");
  assert.deepEqual(
    pimView.myGame.players.map((p: { displayName: string; characters: { number: number }[] }) => [
      p.displayName,
      p.characters.map((c) => c.number),
    ]),
    [
      ["Oda", [1, 2, 3]],
      ["Pim", [1]],
    ],
  );

  oda.ws.send(JSON.stringify({ type: "start-game" }));
  const forOda = await oda.nextOf("game");
  const forPim = await pim.nextOf("game");
  assert.equal(forOda.yourCharacters.length, 3);
  assert.equal(forPim.yourCharacters.length, 1);
  // Each character has its own turn on the track.
  assert.equal(forOda.state.characters.length, 4);
  assert.equal(forOda.state.track.length, 4);
  assert.deepEqual(
    forOda.players.map((p: { displayName: string; characterName: string }) => `${p.characterName} (${p.displayName})`).sort(),
    ["Adventurer 1 (Oda)", "Adventurer 1 (Pim)", "Adventurer 3 (Oda)", "Runner (Oda)"],
  );

  // Oda can plan for each of hers.
  for (const characterId of forOda.yourCharacters) {
    oda.ws.send(JSON.stringify({ type: "clear-plan", characterId }));
    assert.equal((await oda.nextOf("plan")).characterId, characterId);
  }

  // After the start, the choice is fixed.
  pim.ws.send(JSON.stringify({ type: "choose-characters", characters: [1] }));
  assert.match((await pim.nextOf("refused")).reason, /already started/);

  oda.ws.close();
  pim.ws.close();
});

function accountId(accountName: string): number {
  return server.db.prepare("SELECT id FROM accounts WHERE account_name_key = ?").pluck().get(accountName) as number;
}

async function loginCookie(accountName: string): Promise<string> {
  const response = await server.post("/api/login", { accountName, password: "correct horse battery" });
  return response.headers.getSetCookie()[0]!.split(";")[0]!;
}

test("a character with more XP than its max level needs starts a game that gives it no more XP (issue #93)", async () => {
  const ola = await server.connect(await server.signup("ola", "Ola"));
  // 450 XP was the max of rank 1 before the XP curve was halved; the max is now 225.
  server.db
    .prepare(
      "UPDATE characters SET data = ? WHERE account_id = (SELECT id FROM accounts WHERE account_name_key = 'ola')",
    )
    .run(JSON.stringify({ version: 5, class: "adventurer", rank: 1, xp: 450, upgrades: [] }));

  ola.ws.send(JSON.stringify({ type: "create-game", characters: [1] }));
  ola.ws.send(JSON.stringify({ type: "start-game" }));
  const game = await ola.nextOf("game");
  assert.equal(game.state.characters[0].maxXpGain, 0);
  ola.ws.close();
});
