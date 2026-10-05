import { test } from "node:test";
import assert from "node:assert/strict";
import { DUNGEONS } from "../shared/rules/dungeon-map.ts";
import { Lobby } from "./lobby.ts";

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
    dungeonId: "first",
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

test("a game takes at most as many characters as its dungeon allows", () => {
  const lobby = setup();
  lobby.create(ann);
  const gameId = lobby.gameIdOf(ann.accountId)!;
  const max = DUNGEONS.first.maxCharacters;
  for (let id = 2; id <= max; id++) assert.equal(lobby.join({ accountId: id, displayName: `P${id}` }, gameId), undefined);
  assert.match(lobby.join({ accountId: 99, displayName: "Fifth" }, gameId)!, /full: its dungeon allows at most 4/);
  assert.equal(lobby.playersOf(gameId).length, max);
});

/** A lobby whose second dungeon allows only 2 characters: the real ones all allow 4. */
function smallSecondDungeon() {
  return new Lobby(() => true, { ...DUNGEONS, second: { ...DUNGEONS.second, maxCharacters: 2 } });
}

test("the creator chooses the dungeon, and everyone sees it", () => {
  const lobby = setup();
  lobby.create(ann);
  const gameId = lobby.gameIdOf(ann.accountId)!;
  lobby.join(ben, gameId);
  assert.equal(lobby.chooseDungeon(ann.accountId, "second"), undefined);
  assert.equal(lobby.snapshotFor(ben.accountId).myGame?.dungeonId, "second");
  assert.equal(lobby.snapshotFor(cat.accountId).openGames[0]?.dungeonId, "second");
  assert.equal(lobby.dungeonOfGame(gameId), DUNGEONS.second);
  assert.equal(lobby.chooseDungeon(ann.accountId, "first"), undefined);
  assert.equal(lobby.dungeonOfGame(gameId), DUNGEONS.first);
});

test("only the creator chooses the dungeon, and only before the start", () => {
  const lobby = setup();
  assert.match(lobby.chooseDungeon(ann.accountId, "second")!, /not in a game/);
  lobby.create(ann);
  lobby.join(ben, lobby.gameIdOf(ann.accountId)!);
  assert.match(lobby.chooseDungeon(ben.accountId, "second")!, /Only the player who created/);
  lobby.start(ann.accountId);
  assert.match(lobby.chooseDungeon(ann.accountId, "second")!, /already started/);
});

test("a dungeon the party is too big for can't be chosen", () => {
  const lobby = smallSecondDungeon();
  lobby.create(ann);
  const gameId = lobby.gameIdOf(ann.accountId)!;
  lobby.join(ben, gameId);
  // Exactly at the limit is fine.
  assert.equal(lobby.chooseDungeon(ann.accountId, "second"), undefined);
  assert.equal(lobby.chooseDungeon(ann.accountId, "first"), undefined);
  lobby.join(cat, gameId);
  assert.match(lobby.chooseDungeon(ann.accountId, "second")!, /at most 2 characters, and the party has 3/);
  assert.equal(lobby.dungeonOfGame(gameId), DUNGEONS.first);
});

test("nobody can join when that would go over the chosen dungeon's limit", () => {
  const lobby = smallSecondDungeon();
  lobby.create(ann);
  const gameId = lobby.gameIdOf(ann.accountId)!;
  lobby.chooseDungeon(ann.accountId, "second");
  assert.equal(lobby.join(ben, gameId), undefined);
  assert.match(lobby.join(cat, gameId)!, /full: its dungeon allows at most 2/);
  // Back to a bigger dungeon: there is room again.
  lobby.chooseDungeon(ann.accountId, "first");
  assert.equal(lobby.join(cat, gameId), undefined);
});
