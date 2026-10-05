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
    characters: [{ number: 1, class: "adventurer", rank: 1, xp: 0 }],
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
