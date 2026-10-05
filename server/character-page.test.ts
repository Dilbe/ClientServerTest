// The character page's HTTP API, with a real server.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "./test-helpers.ts";

const server = await startTestServer();
after(() => server.close());

/** The response body, untyped: the tests check its shape themselves. */
const body = (response: Response): Promise<any> => response.json();

function giveSilver(displayName: string, silver: number): void {
  server.db.prepare("UPDATE accounts SET silver = ? WHERE display_name = ?").run(silver, displayName);
}

test("the character page lists the player's characters and the price of the next one", async () => {
  const cookie = await server.signup("mia", "Mia");
  const response = await server.get("/api/characters", cookie);
  assert.equal(response.status, 200);
  assert.deepEqual(await body(response), {
    characters: [{ number: 1, name: null, class: "adventurer", rank: 1, xp: 0, upgrades: [] }],
    silver: 0,
    adventurerPrice: 10,
    inGame: false,
  });
  assert.equal((await server.get("/api/characters")).status, 401);
});

test("buying an adventurer takes the silver and adds the next character", async () => {
  const cookie = await server.signup("noa", "Noa");
  giveSilver("Noa", 25);

  const response = await server.post("/api/characters/buy-adventurer", {}, cookie);
  assert.equal(response.status, 200);
  const page = await body(response);
  assert.equal(page.silver, 15);
  assert.equal(page.adventurerPrice, 20);
  assert.deepEqual(
    page.characters.map((c: { number: number }) => c.number),
    [1, 2],
  );

  // The third costs 20, and 15 isn't enough.
  const refused = await server.post("/api/characters/buy-adventurer", {}, cookie);
  assert.equal(refused.status, 409);
  assert.match((await body(refused)).error, /Not enough silver/);
  assert.equal((await body(await server.get("/api/characters", cookie))).silver, 15);
});

test("the client can't set the price: anything it sends about it is ignored", async () => {
  const cookie = await server.signup("oli", "Oli");
  giveSilver("Oli", 5);
  const response = await server.post("/api/characters/buy-adventurer", { price: 0, silver: 1000 }, cookie);
  assert.equal(response.status, 409);
});

test("buying is refused while in a game; the game brings the character with the lowest number", async () => {
  const cookie = await server.signup("pia", "Pia");
  giveSilver("Pia", 100);
  assert.equal((await server.post("/api/characters/buy-adventurer", {}, cookie)).status, 200);

  const pia = await server.connect(cookie);
  pia.ws.send(JSON.stringify({ type: "create-game" }));
  let lobby = await pia.nextOf("lobby");
  while (!lobby.myGame) lobby = await pia.nextOf("lobby");

  // An open game counts too.
  let refused = await server.post("/api/characters/buy-adventurer", {}, cookie);
  assert.equal(refused.status, 409);
  assert.match((await body(refused)).error, /in a game/);
  assert.equal((await body(await server.get("/api/characters", cookie))).inGame, true);

  pia.ws.send(JSON.stringify({ type: "start-game" }));
  await pia.nextOf("game");
  refused = await server.post("/api/characters/buy-adventurer", {}, cookie);
  assert.equal(refused.status, 409);

  // The page can still be viewed, and nothing was bought.
  const page = await body(await server.get("/api/characters", cookie));
  assert.equal(page.characters.length, 2);
  assert.equal(page.silver, 90);

  const { number } = server.db
    .prepare(
      `SELECT characters.number FROM game_members
       JOIN characters ON characters.id = game_members.character_record_id
       JOIN accounts ON accounts.id = game_members.account_id
       WHERE accounts.display_name = 'Pia'`,
    )
    .get() as { number: number };
  assert.equal(number, 1);

  // Back in the lobby, buying works again.
  pia.ws.send(JSON.stringify({ type: "leave-game" }));
  lobby = await pia.nextOf("lobby");
  while (lobby.myGame) lobby = await pia.nextOf("lobby");
  assert.equal((await server.post("/api/characters/buy-adventurer", {}, cookie)).status, 200);
  pia.ws.close();
});

test("renaming a character, and going back to the default name", async () => {
  const cookie = await server.signup("quin", "Quin");
  const renamed = await server.post("/api/characters/rename", { number: 1, name: "Runner" }, cookie);
  assert.equal(renamed.status, 200);
  assert.equal((await body(renamed)).characters[0].name, "Runner");

  const cleared = await server.post("/api/characters/rename", { number: 1, name: null }, cookie);
  assert.equal((await body(cleared)).characters[0].name, null);
});

test("renaming checks the name, and only finds the player's own characters", async () => {
  const cookie = await server.signup("rae", "Rae");
  for (const name of ["", " Runner", "<b>Runner</b>", "a".repeat(21)]) {
    const response = await server.post("/api/characters/rename", { number: 1, name }, cookie);
    assert.equal(response.status, 400, JSON.stringify(name));
    assert.match((await body(response)).error, /^Name:/);
  }
  // Rae has only character 1. Other accounts' characters 2 aren't hers to rename.
  const missing = await server.post("/api/characters/rename", { number: 2, name: "Mine now" }, cookie);
  assert.equal(missing.status, 404);
});

test("renaming is refused while in a game, and the game shows the character's name", async () => {
  const cookie = await server.signup("sam", "Sam");
  await server.post("/api/characters/rename", { number: 1, name: "Tank 1" }, cookie);

  const sam = await server.connect(cookie);
  sam.ws.send(JSON.stringify({ type: "create-game" }));
  sam.ws.send(JSON.stringify({ type: "start-game" }));
  const game = await sam.nextOf("game");
  assert.deepEqual(game.players[0], { characterId: 1, displayName: "Sam", characterName: "Tank 1" });

  const refused = await server.post("/api/characters/rename", { number: 1, name: "Other" }, cookie);
  assert.equal(refused.status, 409);
  assert.match((await body(refused)).error, /in a game/);
  sam.ws.close();
});

function giveXp(displayName: string, xp: number): void {
  server.db
    .prepare(
      `UPDATE characters SET data = ?
       WHERE account_id = (SELECT id FROM accounts WHERE display_name = ?)`,
    )
    .run(JSON.stringify({ version: 4, class: "adventurer", rank: 1, xp, upgrades: [] }), displayName);
}

test("upgrading a stat: the server works out the cost; the game starts with the upgraded stats", async () => {
  const cookie = await server.signup("tia", "Tia");
  giveXp("Tia", 10); // level 2: 2 points

  const response = await server.post("/api/characters/upgrade", { number: 1, stat: "hitPoints", paid: 0 }, cookie);
  assert.equal(response.status, 200);
  assert.deepEqual((await body(response)).characters[0].upgrades, [{ stat: "hitPoints", paid: 1 }]);

  // 1 point left; the second hit point costs 2.
  const refused = await server.post("/api/characters/upgrade", { number: 1, stat: "hitPoints" }, cookie);
  assert.equal(refused.status, 409);
  assert.match((await body(refused)).error, /Not enough upgrade points/);

  for (const request of [{ number: 1, stat: "luck" }, { number: 0, stat: "hitPoints" }, { stat: "hitPoints" }]) {
    assert.equal((await server.post("/api/characters/upgrade", request, cookie)).status, 400, JSON.stringify(request));
  }
  assert.equal((await server.post("/api/characters/upgrade", { number: 2, stat: "hitPoints" }, cookie)).status, 404);

  const tia = await server.connect(cookie);
  tia.ws.send(JSON.stringify({ type: "create-game" }));
  tia.ws.send(JSON.stringify({ type: "start-game" }));
  const game = await tia.nextOf("game");
  assert.equal(game.state.characters[0].stats.hitPoints, 11);

  // While in the game, upgrading and resetting are refused.
  giveXp("Tia", 30);
  const inGame = await server.post("/api/characters/upgrade", { number: 1, stat: "hitPoints" }, cookie);
  assert.equal(inGame.status, 409);
  assert.match((await body(inGame)).error, /in a game/);
  assert.equal((await server.post("/api/characters/reset-upgrades", { number: 1 }, cookie)).status, 409);
  tia.ws.close();
});

test("resetting upgrades costs a level, and isn't possible at level 1", async () => {
  const cookie = await server.signup("uma", "Uma");
  const levelOne = await server.post("/api/characters/reset-upgrades", { number: 1 }, cookie);
  assert.equal(levelOne.status, 409);
  assert.match((await body(levelOne)).error, /level 2 or higher/);

  giveXp("Uma", 120);
  await server.post("/api/characters/upgrade", { number: 1, stat: "attackDamage" }, cookie);
  const response = await server.post("/api/characters/reset-upgrades", { number: 1 }, cookie);
  assert.equal(response.status, 200);
  const [character] = (await body(response)).characters;
  assert.equal(character.xp, 60);
  assert.deepEqual(character.upgrades, []);
  assert.equal((await server.post("/api/characters/reset-upgrades", { number: 2 }, cookie)).status, 404);
});
