// The character page's HTTP API, with a real server.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { maxXp } from "../shared/rules/advancement.ts";
import type { ClassId } from "../shared/rules/classes.ts";
import { STARTING_CHARACTERS } from "./accounts.ts";
import { startTestServer } from "./test-helpers.ts";

const server = await startTestServer();
after(() => server.close());

/** The response body, untyped: the tests check its shape themselves. */
const body = (response: Response): Promise<any> => response.json();

function giveSilver(displayName: string, silver: number): void {
  server.db.prepare("UPDATE accounts SET silver = ? WHERE display_name = ?").run(silver, displayName);
}

/** A character as the page shows it, with no rest (`healedInMs` and `readyInMs` 0). */
function summary(number: number, rank = 1, xp = 0) {
  return {
    number,
    name: null,
    class: "adventurer",
    rank,
    xp,
    upgrades: [],
    workDoneInMs: 0,
    healedInMs: 0,
    readyInMs: 0,
    workplace: null,
    inGame: false,
    inRunningGame: false,
  };
}

const STARTING_PRICES = [
  { rank: 1, price: 10 },
  { rank: 2, price: 90 },
  { rank: 3, price: 450 },
  { rank: 4, price: 1000 },
  { rank: 5, price: 2500 },
];

test("the character page lists the player's characters and the price of each rank", async () => {
  const cookie = await server.signup("mia", "Mia");
  const response = await server.get("/api/characters", cookie);
  assert.equal(response.status, 200);
  assert.deepEqual(await body(response), {
    // A new account starts with 3 adventurers (design.md, Getting more characters).
    characters: [summary(1), summary(2), summary(3)],
    silver: 0,
    adventurerPrices: STARTING_PRICES,
  });
  assert.equal((await server.get("/api/characters")).status, 401);
});

test("the character page says which characters are in a game", async () => {
  const cookie = await server.signup("ivy", "Ivy");
  const socket = await server.connect(cookie);
  socket.ws.send(JSON.stringify({ type: "create-game", characters: [2] }));
  while ((await socket.nextOf("lobby")).myGame === null);
  const page = await body(await server.get("/api/characters", cookie));
  assert.deepEqual(
    page.characters.map((c: { inGame: boolean }) => c.inGame),
    [false, true, false],
  );
  socket.ws.close();
});

test("a character in a game the player left can't be chosen until that game ends", async () => {
  const cookie = await server.signup("una", "Una");
  const una = await server.connect(cookie);
  const wyn = await server.connect(await server.signup("wyn", "Wyn"));
  una.ws.send(JSON.stringify({ type: "create-game", characters: [2] }));
  let lobby = await una.nextOf("lobby");
  while (lobby.myGame === null) lobby = await una.nextOf("lobby");
  wyn.ws.send(JSON.stringify({ type: "join-game", gameId: lobby.myGame.id, characters: [1] }));
  while (lobby.myGame.players.length !== 2) lobby = await una.nextOf("lobby");
  una.ws.send(JSON.stringify({ type: "start-game" }));
  await una.nextOf("game");

  // Una leaves the running game. It goes on with Wyn, and with Una's
  // character 2 (issue #195). Her account isn't in a game any more, but
  // both screens still say character 2 is: their "In a game" option opens
  // selected from that (issues #215 and #214).
  una.ws.send(JSON.stringify({ type: "leave-game" }));
  while (lobby.myGame !== null) lobby = await una.nextOf("lobby");
  assert.deepEqual(
    lobby.yourCharacters.map((c: { inGame: boolean }) => c.inGame),
    [false, true, false],
  );
  const page = await body(await server.get("/api/characters", cookie));
  assert.deepEqual(
    page.characters.map((c: { inGame: boolean }) => c.inGame),
    [false, true, false],
  );

  // Not for a new game, nor added to the choice in an open one.
  const refused = "Adventurer 2 is still in a game and can't go into another one until it ends.";
  una.ws.send(JSON.stringify({ type: "create-game", characters: [1, 2] }));
  assert.equal((await una.nextOf("refused")).reason, refused);
  una.ws.send(JSON.stringify({ type: "create-game", characters: [1] }));
  while (lobby.myGame === null) lobby = await una.nextOf("lobby");
  una.ws.send(JSON.stringify({ type: "choose-characters", characters: [1, 2] }));
  assert.equal((await una.nextOf("refused")).reason, refused);

  // Choosing again a character that is already in the open party is fine.
  una.ws.send(JSON.stringify({ type: "choose-characters", characters: [1, 3] }));
  while (lobby.myGame.players[0].characters.length !== 2) lobby = await una.nextOf("lobby");
  una.ws.close();
  wyn.ws.close();
});

test("buying an adventurer takes the silver and adds the next character", async () => {
  const cookie = await server.signup("noa", "Noa");
  giveSilver("Noa", 115);

  const response = await server.post("/api/characters/buy-adventurer", { rank: 2 }, cookie);
  assert.equal(response.status, 200);
  const page = await body(response);
  assert.equal(page.silver, 25);
  // Only the price of rank 2 went up.
  assert.deepEqual(
    page.adventurerPrices.map((p: { price: number }) => p.price),
    [10, 180, 450, 1000, 2500],
  );
  assert.deepEqual(page.characters[STARTING_CHARACTERS], summary(STARTING_CHARACTERS + 1, 2));

  // The next rank 2 costs 180, and 25 isn't enough.
  const refused = await server.post("/api/characters/buy-adventurer", { rank: 2 }, cookie);
  assert.equal(refused.status, 409);
  assert.match((await body(refused)).error, /Not enough silver/);
  assert.equal((await body(await server.get("/api/characters", cookie))).silver, 25);
});

test("the client can't set the price: anything it sends about it is ignored", async () => {
  const cookie = await server.signup("oli", "Oli");
  giveSilver("Oli", 5);
  const response = await server.post("/api/characters/buy-adventurer", { rank: 1, price: 0, silver: 1000 }, cookie);
  assert.equal(response.status, 409);
});

test("only a whole rank from 1 to 5 can be bought", async () => {
  const cookie = await server.signup("oscar", "Oscar");
  giveSilver("Oscar", 100000);
  for (const request of [{}, { rank: 0 }, { rank: 6 }, { rank: 1.5 }, { rank: "1" }, { rank: null }]) {
    const response = await server.post("/api/characters/buy-adventurer", request, cookie);
    assert.equal(response.status, 400, JSON.stringify(request));
    assert.match((await body(response)).error, /^Rank: /);
  }
  const page = await body(await server.get("/api/characters", cookie));
  assert.equal(page.silver, 100000);
  assert.equal(page.characters.length, STARTING_CHARACTERS);
});

test("buying works in a party and during a game (issue #153); the game brings the chosen character", async () => {
  const cookie = await server.signup("pia", "Pia");
  giveSilver("Pia", 100);
  assert.equal((await server.post("/api/characters/buy-adventurer", { rank: 1 }, cookie)).status, 200);

  const pia = await server.connect(cookie);
  const bought = STARTING_CHARACTERS + 1;
  pia.ws.send(JSON.stringify({ type: "create-game", characters: [bought] }));
  let lobby = await pia.nextOf("lobby");
  while (!lobby.myGame) lobby = await pia.nextOf("lobby");

  // In an open game.
  assert.equal((await server.post("/api/characters/buy-adventurer", { rank: 1 }, cookie)).status, 200);
  assert.equal((await body(await server.get("/api/characters", cookie))).characters[bought - 1].inGame, true);

  // In a running game.
  pia.ws.send(JSON.stringify({ type: "start-game" }));
  await pia.nextOf("game");
  assert.equal((await server.post("/api/characters/buy-adventurer", { rank: 1 }, cookie)).status, 200);
  const page = await body(await server.get("/api/characters", cookie));
  assert.equal(page.characters.length, bought + 2);
  assert.equal(page.silver, 100 - 10 - 20 - 30);

  const { number } = server.db
    .prepare(
      `SELECT characters.number FROM game_members
       JOIN characters ON characters.id = game_members.character_record_id
       JOIN accounts ON accounts.id = game_members.account_id
       WHERE accounts.display_name = 'Pia'`,
    )
    .get() as { number: number };
  assert.equal(number, bought);
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
  const missing = await server.post("/api/characters/rename", { number: 9, name: "Mine now" }, cookie);
  assert.equal(missing.status, 404);
});

test("renaming is refused while in a game, and the game shows the character's name", async () => {
  const cookie = await server.signup("sam", "Sam");
  await server.post("/api/characters/rename", { number: 1, name: "Tank 1" }, cookie);

  const sam = await server.connect(cookie);
  sam.ws.send(JSON.stringify({ type: "create-game", characters: [1] }));
  sam.ws.send(JSON.stringify({ type: "start-game" }));
  const game = await sam.nextOf("game");
  assert.deepEqual(game.players[0], { characterId: 1, displayName: "Sam", characterName: "Tank 1", class: "adventurer", rank: 1 });

  const refused = await server.post("/api/characters/rename", { number: 1, name: "Other" }, cookie);
  assert.equal(refused.status, 409);
  assert.match((await body(refused)).error, /in a game/);
  // A character that isn't in the game can be renamed (issue #153).
  assert.equal((await server.post("/api/characters/rename", { number: 2, name: "Spare" }, cookie)).status, 200);
  sam.ws.close();
});

test("renaming a character chosen in an open party shows the new name there (issue #153)", async () => {
  const cookie = await server.signup("sol", "Sol");
  const sol = await server.connect(cookie);
  sol.ws.send(JSON.stringify({ type: "create-game", characters: [1] }));
  let lobby = await sol.nextOf("lobby");
  while (!lobby.myGame) lobby = await sol.nextOf("lobby");

  assert.equal((await server.post("/api/characters/rename", { number: 1, name: "Scout" }, cookie)).status, 200);
  while (lobby.myGame.players[0].characters[0].name !== "Scout") lobby = await sol.nextOf("lobby");

  // The game starts with the new name.
  sol.ws.send(JSON.stringify({ type: "start-game" }));
  assert.equal((await sol.nextOf("game")).players[0].characterName, "Scout");
  sol.ws.close();
});

/** Sets the total XP of the player's characters, keeping everything else. */
function setXp(displayName: string, xp: number): void {
  server.db
    .prepare(
      `UPDATE characters SET data = json_set(data, '$.xp', ?)
       WHERE account_id = (SELECT id FROM accounts WHERE display_name = ?)`,
    )
    .run(xp, displayName);
}

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
  assert.equal((await server.post("/api/characters/upgrade", { number: 9, stat: "hitPoints" }, cookie)).status, 404);

  const tia = await server.connect(cookie);
  tia.ws.send(JSON.stringify({ type: "create-game", characters: [1] }));
  tia.ws.send(JSON.stringify({ type: "start-game" }));
  const game = await tia.nextOf("game");
  assert.equal(game.state.characters[0].stats.hitPoints, 11);

  tia.ws.close();
});

test("upgrading during a game counts there at once; the record gets it when the game ends (issue #153)", async () => {
  const cookie = await server.signup("tom", "Tom");
  setXp("Tom", 15); // level 3: 5 points
  const tom = await server.connect(cookie);
  tom.ws.send(JSON.stringify({ type: "create-game", characters: [1] }));
  // In an open party the record gets the upgrade, and the game starts with it.
  let lobby = await tom.nextOf("lobby");
  while (!lobby.myGame) lobby = await tom.nextOf("lobby");
  assert.equal((await server.post("/api/characters/upgrade", { number: 1, stat: "hitPoints" }, cookie)).status, 200);
  tom.ws.send(JSON.stringify({ type: "start-game" }));
  assert.equal((await tom.nextOf("game")).state.characters[0].stats.hitPoints, 11);

  // 4 points left: the second hit point costs 2. (XP gained in the game
  // counts too: server/rewards.test.ts tests that with real kills.)
  const response = await server.post("/api/characters/upgrade", { number: 1, stat: "hitPoints" }, cookie);
  assert.equal(response.status, 200);
  const [character] = (await body(response)).characters;
  assert.equal(character.inRunningGame, true);
  assert.deepEqual(character.upgrades, [
    { stat: "hitPoints", paid: 1 },
    { stat: "hitPoints", paid: 2 },
  ]);

  // Everyone in the game is told; it counts at once.
  assert.deepEqual(await tom.nextOf("upgraded"), {
    type: "upgraded",
    gameId: lobby.myGame.id,
    characterId: 1,
    upgrade: { stat: "hitPoints" },
  });
  tom.ws.send(JSON.stringify({ type: "get-game" }));
  const game = await tom.nextOf("game");
  assert.equal(game.state.characters[0].stats.hitPoints, 12);
  assert.equal(game.state.characters[0].hp, 12);

  // The record doesn't have it yet: it comes with the rewards at the end.
  const { data } = server.db
    .prepare("SELECT data FROM characters WHERE account_id = (SELECT id FROM accounts WHERE display_name = 'Tom') AND number = 1")
    .get() as { data: string };
  assert.equal(JSON.parse(data).upgrades.length, 1);

  // 2 points left: the third hit point costs 3.
  const tooDear = await server.post("/api/characters/upgrade", { number: 1, stat: "hitPoints" }, cookie);
  assert.equal(tooDear.status, 409);
  assert.match((await body(tooDear)).error, /Not enough upgrade points/);

  // Renaming, resetting and ranking up wait until the game ends.
  for (const [path, request] of [
    ["/api/characters/rename", { number: 1, name: "Other" }],
    ["/api/characters/reset-upgrades", { number: 1 }],
    ["/api/characters/rank-up", { first: 1, second: 2 }],
    ["/api/characters/advanced-class", { first: 1, second: 2, class: "tank" }],
  ] as const) {
    const refused = await server.post(path, request, cookie);
    assert.equal(refused.status, 409, path);
    assert.match((await body(refused)).error, /in a game/);
  }
  tom.ws.close();
});

test("upgrading an ability stores it, is refused without the rank, and reaches the game", async () => {
  const cookie = await server.signup("abe", "Abe");
  giveMaxLevelCharacters("Abe", [3, 1]);

  const response = await server.post("/api/characters/upgrade-ability", { number: 1, ability: "charge", upgrade: "range", paid: 0 }, cookie);
  assert.equal(response.status, 200);
  assert.deepEqual((await body(response)).characters[0].upgrades, [{ ability: "charge", upgrade: "range", paid: 5 }]);

  const noRank = await server.post("/api/characters/upgrade-ability", { number: 2, ability: "heavyStrike", upgrade: "cooldown" }, cookie);
  assert.equal(noRank.status, 409);
  assert.match((await body(noRank)).error, /rank/);
  const noRange = await server.post("/api/characters/upgrade-ability", { number: 1, ability: "heavyStrike", upgrade: "range" }, cookie);
  assert.equal(noRange.status, 409);
  for (const request of [
    { number: 1, ability: "lightningBolt", upgrade: "cooldown" },
    { number: 1, ability: "charge", upgrade: "damage" },
    { number: 1, ability: "charge" },
  ]) {
    assert.equal((await server.post("/api/characters/upgrade-ability", request, cookie)).status, 400, JSON.stringify(request));
  }
  assert.equal(
    (await server.post("/api/characters/upgrade-ability", { number: 3, ability: "charge", upgrade: "range" }, cookie)).status,
    404,
  );

  const abe = await server.connect(cookie);
  abe.ws.send(JSON.stringify({ type: "create-game", characters: [1] }));
  abe.ws.send(JSON.stringify({ type: "start-game" }));
  const game = await abe.nextOf("game");
  assert.deepEqual(game.state.characters[0].abilityUpgrades, { charge: { range: 1 } });

  // During the game too (issue #153), up to the limit.
  const inGame = await server.post("/api/characters/upgrade-ability", { number: 1, ability: "charge", upgrade: "range" }, cookie);
  assert.equal(inGame.status, 200);
  assert.deepEqual((await abe.nextOf("upgraded")).upgrade, { ability: "charge", upgrade: "range" });
  const atLimit = await server.post("/api/characters/upgrade-ability", { number: 1, ability: "charge", upgrade: "range" }, cookie);
  assert.equal(atLimit.status, 409);
  assert.match((await body(atLimit)).error, /any more/);
  abe.ws.close();
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
  assert.equal((await server.post("/api/characters/reset-upgrades", { number: 9 }, cookie)).status, 404);
});

/**
 * Replaces the player's characters with these, numbered 1, 2, 3, ...: each
 * at the max level of its rank, adventurers unless the class is given.
 */
function giveMaxLevelCharacters(displayName: string, ranks: number[], classId: ClassId = "adventurer"): void {
  const { id } = server.db.prepare("SELECT id FROM accounts WHERE display_name = ?").get(displayName) as { id: number };
  server.db.prepare("DELETE FROM characters WHERE account_id = ?").run(id);
  ranks.forEach((rank, i) =>
    server.db
      .prepare("INSERT INTO characters (account_id, number, data, created_at, updated_at) VALUES (?, ?, ?, 0, 0)")
      .run(id, i + 1, JSON.stringify({ version: 5, class: classId, rank, xp: maxXp(classId, rank), upgrades: [] })),
  );
}

test("ranking up: two max-level adventurers become one of the next rank", async () => {
  const cookie = await server.signup("vic", "Vic");
  giveMaxLevelCharacters("Vic", [1, 1, 1]);

  const response = await server.post("/api/characters/rank-up", { first: 1, second: 3 }, cookie);
  assert.equal(response.status, 200);
  const page = await body(response);
  assert.deepEqual(page.characters, [
    summary(2, 1, maxXp("adventurer", 1)),
    summary(4, 2),
  ]);
  // Ranking up never changes a price.
  assert.deepEqual(page.adventurerPrices, STARTING_PRICES);
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

test("making an advanced class: two max-level rank 5 adventurers become one rank 1 character of the picked class", async () => {
  const cookie = await server.signup("ivo", "Ivo");
  giveMaxLevelCharacters("Ivo", [5, 1, 5]);

  const response = await server.post("/api/characters/advanced-class", { first: 1, second: 3, class: "caster" }, cookie);
  assert.equal(response.status, 200);
  const page = await body(response);
  assert.deepEqual(page.characters, [summary(2, 1, maxXp("adventurer", 1)), { ...summary(4), class: "caster" }]);
  // It isn't bought: no price changes.
  assert.deepEqual(page.adventurerPrices, STARTING_PRICES);
});

test("making an advanced class is refused for each rule the server checks", async () => {
  const cookie = await server.signup("bea", "Bea");
  giveMaxLevelCharacters("Bea", [5, 5, 4, 5]);
  // Character 4 is a rank 5 adventurer one XP short of its max level.
  server.db
    .prepare(
      `UPDATE characters SET data = json_set(data, '$.xp', ?)
       WHERE number = 4 AND account_id = (SELECT id FROM accounts WHERE display_name = 'Bea')`,
    )
    .run(maxXp("adventurer", 5) - 1);
  const before = (await body(await server.get("/api/characters", cookie))).characters;

  const refusals: [unknown, number, RegExp][] = [
    [{ first: 1, second: 3, class: "tank" }, 409, /rank 5 adventurers/],
    [{ first: 1, second: 4, class: "tank" }, 409, /max level/],
    [{ first: 1, second: 9, class: "tank" }, 404, /no character with that number/],
    [{ first: 1, second: 1, class: "tank" }, 400, /two different characters/],
    // Only the four advanced classes: not an adventurer, nor a class that doesn't exist.
    [{ first: 1, second: 2, class: "adventurer" }, 400, /^Class:/],
    [{ first: 1, second: 2, class: "wizard" }, 400, /^Class:/],
    [{ first: 1, second: 2 }, 400, /^Class:/],
  ];
  for (const [request, status, error] of refusals) {
    const response = await server.post("/api/characters/advanced-class", request, cookie);
    assert.equal(response.status, status, JSON.stringify(request));
    assert.match((await body(response)).error, error);
  }

  // Another player's characters aren't found by number.
  await server.signup("cid", "Cid");
  giveMaxLevelCharacters("Cid", [5, 5, 5, 5, 5, 5]);
  const theirs = await server.post("/api/characters/advanced-class", { first: 5, second: 6, class: "tank" }, cookie);
  assert.equal(theirs.status, 404);

  assert.deepEqual((await body(await server.get("/api/characters", cookie))).characters, before);
  assert.equal((await server.post("/api/characters/advanced-class", { first: 1, second: 2, class: "tank" })).status, 401);
});

test("an advanced class ranks up like an adventurer, at its own max level", async () => {
  const cookie = await server.signup("dot", "Dot");
  giveMaxLevelCharacters("Dot", [1, 1], "tank");
  const response = await server.post("/api/characters/rank-up", { first: 1, second: 2 }, cookie);
  assert.equal(response.status, 200);
  assert.deepEqual((await body(response)).characters, [{ ...summary(3, 2), class: "tank" }]);
});

test("ranking up in an open party takes the used-up characters out of the choice; in a running game it is refused", async () => {
  const cookie = await server.signup("yara", "Yara");
  giveMaxLevelCharacters("Yara", [1, 1, 1]);

  const yara = await server.connect(cookie);
  yara.ws.send(JSON.stringify({ type: "create-game", characters: [2, 3] }));
  let lobby = await yara.nextOf("lobby");
  while (!lobby.myGame) lobby = await yara.nextOf("lobby");

  // Issue #153: allowed in an open party. Character 2 is used up, so it
  // drops out of the choice and the turn order; character 3 stays.
  assert.equal((await server.post("/api/characters/rank-up", { first: 1, second: 2 }, cookie)).status, 200);
  while (lobby.myGame.players[0].characters.length !== 1) lobby = await yara.nextOf("lobby");
  assert.deepEqual(
    lobby.myGame.players[0].characters.map((c: { number: number }) => c.number),
    [3],
  );
  assert.deepEqual(lobby.myGame.turnOrder, [{ player: 0, number: 3 }]);

  // With character 3 used up too, the party has nobody to bring.
  giveMaxLevelCharacters("Yara", [1, 1, 1]);
  assert.equal((await server.post("/api/characters/rank-up", { first: 1, second: 3 }, cookie)).status, 200);
  while (lobby.myGame.players[0].characters.length !== 0) lobby = await yara.nextOf("lobby");
  yara.ws.send(JSON.stringify({ type: "start-game" }));
  assert.equal((await yara.nextOf("refused")).reason, "Yara has no characters chosen.");

  // In a running game the character can't be used up.
  yara.ws.send(JSON.stringify({ type: "choose-characters", characters: [2] }));
  while (lobby.myGame.players[0].characters.length !== 1) lobby = await yara.nextOf("lobby");
  yara.ws.send(JSON.stringify({ type: "start-game" }));
  await yara.nextOf("game");
  const refused = await server.post("/api/characters/rank-up", { first: 2, second: 4 }, cookie);
  assert.equal(refused.status, 409);
  assert.match((await body(refused)).error, /in a game/);
  assert.equal((await body(await server.get("/api/characters", cookie))).characters.length, 2);
  yara.ws.close();
});
