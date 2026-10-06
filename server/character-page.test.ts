// The character page's HTTP API, with a real server.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { maxXp } from "../shared/rules/advancement.ts";
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

test("buying is refused while in a game; the game brings the chosen character", async () => {
  const cookie = await server.signup("pia", "Pia");
  giveSilver("Pia", 100);
  assert.equal((await server.post("/api/characters/buy-adventurer", {}, cookie)).status, 200);

  const pia = await server.connect(cookie);
  pia.ws.send(JSON.stringify({ type: "create-game", characters: [2] }));
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
  assert.equal(number, 2);

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
  sam.ws.send(JSON.stringify({ type: "create-game", characters: [1] }));
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
    .run(JSON.stringify({ version: 5, class: "adventurer", rank: 1, xp, upgrades: [] }), displayName);
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
  // Movement can't be upgraded. The page doesn't offer it, but anyone can
  // send this request, so the server must refuse it itself.
  const movement = await server.post("/api/characters/upgrade", { number: 1, stat: "movement" }, cookie);
  assert.equal(movement.status, 400);
  assert.equal((await server.post("/api/characters/upgrade", { number: 2, stat: "hitPoints" }, cookie)).status, 404);

  const tia = await server.connect(cookie);
  tia.ws.send(JSON.stringify({ type: "create-game", characters: [1] }));
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

  giveXp("Uma", 60);
  await server.post("/api/characters/upgrade", { number: 1, stat: "attackDamage" }, cookie);
  const response = await server.post("/api/characters/reset-upgrades", { number: 1 }, cookie);
  assert.equal(response.status, 200);
  const [character] = (await body(response)).characters;
  assert.equal(character.xp, 30);
  assert.deepEqual(character.upgrades, []);
  assert.equal((await server.post("/api/characters/reset-upgrades", { number: 2 }, cookie)).status, 404);
});

/** Replaces the player's characters with these, numbered 1, 2, 3, ...: each at the max level of its rank. */
function giveMaxLevelCharacters(displayName: string, ranks: number[]): void {
  const { id } = server.db.prepare("SELECT id FROM accounts WHERE display_name = ?").get(displayName) as { id: number };
  server.db.prepare("DELETE FROM characters WHERE account_id = ?").run(id);
  ranks.forEach((rank, i) =>
    server.db
      .prepare("INSERT INTO characters (account_id, number, data, created_at, updated_at) VALUES (?, ?, ?, 0, 0)")
      .run(id, i + 1, JSON.stringify({ version: 5, class: "adventurer", rank, xp: maxXp(rank), upgrades: [] })),
  );
}

test("ranking up: two max-level adventurers become one of the next rank", async () => {
  const cookie = await server.signup("vic", "Vic");
  giveMaxLevelCharacters("Vic", [1, 1, 1]);

  const response = await server.post("/api/characters/rank-up", { first: 1, second: 3 }, cookie);
  assert.equal(response.status, 200);
  const page = await body(response);
  assert.deepEqual(page.characters, [
    { number: 2, name: null, class: "adventurer", rank: 1, xp: maxXp(1), upgrades: [] },
    { number: 4, name: null, class: "adventurer", rank: 2, xp: 0, upgrades: [] },
  ]);
  // Used-up characters no longer count for the price.
  assert.equal(page.adventurerPrice, 20);
});

test("ranking up is refused for each rule the server checks", async () => {
  const cookie = await server.signup("wes", "Wes");
  giveMaxLevelCharacters("Wes", [1, 2, 5, 5]);
  // And character 5: rank 1, level 1.
  server.db
    .prepare(
      `INSERT INTO characters (account_id, number, data, created_at, updated_at)
       SELECT id, 5, ?, 0, 0 FROM accounts WHERE display_name = 'Wes'`,
    )
    .run(JSON.stringify({ version: 5, class: "adventurer", rank: 1, xp: 0, upgrades: [] }));
  const before = (await body(await server.get("/api/characters", cookie))).characters;

  const refusals: [unknown, number, RegExp][] = [
    [{ first: 1, second: 2 }, 409, /same class and rank/],
    [{ first: 1, second: 5 }, 409, /max level/],
    [{ first: 3, second: 4 }, 409, /highest rank/],
    [{ first: 1, second: 9 }, 404, /no character with that number/],
    [{ first: 1, second: 1 }, 400, /two different characters/],
    [{ first: 1 }, 400, /^Character:/],
  ];
  for (const [request, status, error] of refusals) {
    const response = await server.post("/api/characters/rank-up", request, cookie);
    assert.equal(response.status, status, JSON.stringify(request));
    assert.match((await body(response)).error, error);
  }

  // Another player's characters aren't found by number, even when they could rank up.
  const otherCookie = await server.signup("xan", "Xan");
  // Xan has characters 1 to 7; Wes has no 6 or 7.
  giveMaxLevelCharacters("Xan", [1, 1, 1, 1, 1, 1, 1]);
  const theirs = await server.post("/api/characters/rank-up", { first: 6, second: 7 }, cookie);
  assert.equal(theirs.status, 404);
  assert.equal((await body(await server.get("/api/characters", otherCookie))).characters.length, 7);

  assert.deepEqual((await body(await server.get("/api/characters", cookie))).characters, before);
  assert.equal((await server.post("/api/characters/rank-up", { first: 1, second: 2 })).status, 401);
});

test("ranking up is refused while in a game", async () => {
  const cookie = await server.signup("yara", "Yara");
  giveMaxLevelCharacters("Yara", [1, 1]);

  const yara = await server.connect(cookie);
  yara.ws.send(JSON.stringify({ type: "create-game", characters: [2] }));
  let lobby = await yara.nextOf("lobby");
  while (!lobby.myGame) lobby = await yara.nextOf("lobby");

  const refused = await server.post("/api/characters/rank-up", { first: 1, second: 2 }, cookie);
  assert.equal(refused.status, 409);
  assert.match((await body(refused)).error, /in a game/);
  assert.equal((await body(await server.get("/api/characters", cookie))).characters.length, 2);
  yara.ws.close();
});
