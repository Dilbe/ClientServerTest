import { test } from "node:test";
import assert from "node:assert/strict";
import { Lobby, MAX_PLAYERS } from "./lobby.ts";

const ann = { accountId: 1, displayName: "Ann" };
const ben = { accountId: 2, displayName: "Ben" };
const cat = { accountId: 3, displayName: "Cat" };

function setup() {
  return new Lobby((id) => id !== 3); // Cat is offline
}

test("create, join and see the game", () => {
  const lobby = setup();
  assert.equal(lobby.create(ann), undefined);
  const gameId = lobby.snapshotFor(ben.accountId).openGames[0]!.id;
  assert.equal(lobby.join(ben, gameId), undefined);
  assert.equal(lobby.join(cat, gameId), undefined);

  const forBen = lobby.snapshotFor(ben.accountId);
  assert.deepEqual(forBen.myGame, {
    id: gameId,
    creator: "Ann",
    players: [
      { displayName: "Ann", online: true },
      { displayName: "Ben", online: true },
      { displayName: "Cat", online: false },
    ],
    started: false,
  });
});

test("an account is in at most one game", () => {
  const lobby = setup();
  lobby.create(ann);
  lobby.create(ben);
  const annGame = lobby.snapshotFor(ann.accountId).myGame!.id;
  assert.match(lobby.create(ann)!, /already in a game/);
  assert.match(lobby.join(ben, annGame)!, /already in a game/);
  assert.match(lobby.join(ann, annGame)!, /already in a game/);
});

test("only the creator can start, and nobody can join after the start", () => {
  const lobby = setup();
  lobby.create(ann);
  const gameId = lobby.snapshotFor(ann.accountId).myGame!.id;
  lobby.join(ben, gameId);
  assert.match(lobby.start(ben.accountId)!, /Only the player who created/);
  assert.equal(lobby.start(ann.accountId), undefined);
  assert.match(lobby.join(cat, gameId)!, /already started/);
  assert.match(lobby.start(ann.accountId)!, /already started/);

  // A started game is no longer listed, but its players still see it.
  assert.deepEqual(lobby.snapshotFor(cat.accountId).openGames, []);
  assert.equal(lobby.snapshotFor(ben.accountId).myGame?.started, true);
});

test("a game can be started solo", () => {
  const lobby = setup();
  lobby.create(ann);
  assert.equal(lobby.start(ann.accountId), undefined);
});

test("when the creator leaves, the next player becomes creator; the last one removes the game", () => {
  const lobby = setup();
  lobby.create(ann);
  const gameId = lobby.snapshotFor(ann.accountId).myGame!.id;
  lobby.join(ben, gameId);
  assert.equal(lobby.leave(ann.accountId), undefined);
  assert.equal(lobby.snapshotFor(ben.accountId).myGame?.creator, "Ben");
  assert.equal(lobby.start(ben.accountId), undefined);
  assert.equal(lobby.leave(ben.accountId), undefined);
  assert.equal(lobby.snapshotFor(ben.accountId).myGame, null);
  assert.match(lobby.join(cat, gameId)!, /no longer exists/);
  assert.match(lobby.leave(ben.accountId)!, /not in a game/);
});

test("unknown games are refused", () => {
  assert.match(setup().join(ann, "made-up")!, /no longer exists/);
});

test("open games are listed oldest first", () => {
  const lobby = setup();
  lobby.create(ann);
  lobby.create(ben);
  assert.deepEqual(
    lobby.snapshotFor(cat.accountId).openGames.map((g) => g.creator),
    ["Ann", "Ben"],
  );
});

test("a game takes at most 4 players", () => {
  const lobby = setup();
  lobby.create(ann);
  const gameId = lobby.gameIdOf(ann.accountId)!;
  for (let id = 2; id <= MAX_PLAYERS; id++) assert.equal(lobby.join({ accountId: id, displayName: `P${id}` }, gameId), undefined);
  assert.match(lobby.join({ accountId: 99, displayName: "Fifth" }, gameId)!, /full/);
  assert.equal(lobby.playersOf(gameId).length, MAX_PLAYERS);
});
