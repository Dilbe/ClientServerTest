import { test } from "node:test";
import assert from "node:assert/strict";
import { DUNGEONS } from "../shared/rules/dungeon-map.ts";
import { Lobby } from "./lobby.ts";

const ann = { accountId: 1, displayName: "Ann" };
const ben = { accountId: 2, displayName: "Ben" };
const cat = { accountId: 3, displayName: "Cat" };

/** Choices of one, two and three characters. */
const one = [{ number: 1, name: "Adventurer 1" }];
const two = [...one, { number: 2, name: "Runner" }];
const three = [...two, { number: 3, name: "Adventurer 3" }];

function setup() {
  return new Lobby((id) => id !== 3); // Cat is offline
}

test("create, join and see the game", () => {
  const lobby = setup();
  assert.equal(lobby.create(ann, one), undefined);
  const gameId = lobby.snapshotFor(ben.accountId).openGames[0]!.id;
  assert.equal(lobby.join(ben, gameId, one), undefined);
  assert.equal(lobby.join(cat, gameId, one), undefined);

  const forBen = lobby.snapshotFor(ben.accountId);
  assert.deepEqual(forBen.myGame, {
    id: gameId,
    creator: "Ann",
    players: [
      { displayName: "Ann", online: true, characters: one },
      { displayName: "Ben", online: true, characters: one },
      { displayName: "Cat", online: false, characters: one },
    ],
    dungeonId: "first",
    turnDuration: "normal",
    started: false,
  });
});

test("the creator chooses the turn duration when creating the game", () => {
  const lobby = setup();
  lobby.create(ann, one, "crawl");
  const gameId = lobby.snapshotFor(ann.accountId).myGame!.id;
  assert.equal(lobby.snapshotFor(ben.accountId).openGames[0]!.turnDuration, "crawl");
  assert.equal(lobby.turnDurationOfGame(gameId), "crawl");
});

test("an account is in at most one game", () => {
  const lobby = setup();
  lobby.create(ann, one);
  lobby.create(ben, one);
  const annGame = lobby.snapshotFor(ann.accountId).myGame!.id;
  assert.match(lobby.create(ann, one)!, /already in a game/);
  assert.match(lobby.join(ben, annGame, one)!, /already in a game/);
  assert.match(lobby.join(ann, annGame, one)!, /already in a game/);
});

test("only the creator can start, and nobody can join after the start", () => {
  const lobby = setup();
  lobby.create(ann, one);
  const gameId = lobby.snapshotFor(ann.accountId).myGame!.id;
  lobby.join(ben, gameId, one);
  assert.match(lobby.start(ben.accountId)!, /Only the player who created/);
  assert.equal(lobby.start(ann.accountId), undefined);
  assert.match(lobby.join(cat, gameId, one)!, /already started/);
  assert.match(lobby.start(ann.accountId)!, /already started/);

  // A started game is no longer listed, but its players still see it.
  assert.deepEqual(lobby.snapshotFor(cat.accountId).openGames, []);
  assert.equal(lobby.snapshotFor(ben.accountId).myGame?.started, true);
});

test("a game can be started solo", () => {
  const lobby = setup();
  lobby.create(ann, one);
  assert.equal(lobby.start(ann.accountId), undefined);
});

test("when the creator leaves, the next player becomes creator; the last one removes the game", () => {
  const lobby = setup();
  lobby.create(ann, one);
  const gameId = lobby.snapshotFor(ann.accountId).myGame!.id;
  lobby.join(ben, gameId, one);
  assert.equal(lobby.leave(ann.accountId), undefined);
  assert.equal(lobby.snapshotFor(ben.accountId).myGame?.creator, "Ben");
  assert.equal(lobby.start(ben.accountId), undefined);
  assert.equal(lobby.leave(ben.accountId), undefined);
  assert.equal(lobby.snapshotFor(ben.accountId).myGame, null);
  assert.match(lobby.join(cat, gameId, one)!, /no longer exists/);
  assert.match(lobby.leave(ben.accountId)!, /not in a game/);
});

test("unknown games are refused", () => {
  assert.match(setup().join(ann, "made-up", one)!, /no longer exists/);
});

test("open games are listed oldest first", () => {
  const lobby = setup();
  lobby.create(ann, one);
  lobby.create(ben, one);
  assert.deepEqual(
    lobby.snapshotFor(cat.accountId).openGames.map((g) => g.creator),
    ["Ann", "Ben"],
  );
});

test("a game takes at most as many characters as its dungeon allows", () => {
  const lobby = setup();
  lobby.create(ann, one);
  const gameId = lobby.gameIdOf(ann.accountId)!;
  const max = DUNGEONS.first.maxCharacters;
  for (let id = 2; id <= max; id++) assert.equal(lobby.join({ accountId: id, displayName: `P${id}` }, gameId, one), undefined);
  assert.match(lobby.join({ accountId: 99, displayName: "Fifth" }, gameId, one)!, /Too many characters: the dungeon allows at most 4, and the others bring 4/);
  assert.equal(lobby.playersOf(gameId).length, max);
});

/** A lobby whose second dungeon allows only 2 characters: the real ones all allow 4. */
function smallSecondDungeon() {
  return new Lobby(() => true, { ...DUNGEONS, second: { ...DUNGEONS.second, maxCharacters: 2 } });
}

test("the creator chooses the dungeon, and everyone sees it", () => {
  const lobby = setup();
  lobby.create(ann, one);
  const gameId = lobby.gameIdOf(ann.accountId)!;
  lobby.join(ben, gameId, one);
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
  lobby.create(ann, one);
  lobby.join(ben, lobby.gameIdOf(ann.accountId)!, one);
  assert.match(lobby.chooseDungeon(ben.accountId, "second")!, /Only the player who created/);
  lobby.start(ann.accountId);
  assert.match(lobby.chooseDungeon(ann.accountId, "second")!, /already started/);
});

test("a dungeon the party is too big for can't be chosen", () => {
  const lobby = smallSecondDungeon();
  lobby.create(ann, one);
  const gameId = lobby.gameIdOf(ann.accountId)!;
  lobby.join(ben, gameId, one);
  // Exactly at the limit is fine.
  assert.equal(lobby.chooseDungeon(ann.accountId, "second"), undefined);
  assert.equal(lobby.chooseDungeon(ann.accountId, "first"), undefined);
  lobby.join(cat, gameId, one);
  assert.match(lobby.chooseDungeon(ann.accountId, "second")!, /at most 2 characters, and the party has 3/);
  assert.equal(lobby.dungeonOfGame(gameId), DUNGEONS.first);
});

test("nobody can join when that would go over the chosen dungeon's limit", () => {
  const lobby = smallSecondDungeon();
  lobby.create(ann, one);
  const gameId = lobby.gameIdOf(ann.accountId)!;
  lobby.chooseDungeon(ann.accountId, "second");
  assert.equal(lobby.join(ben, gameId, one), undefined);
  assert.match(lobby.join(cat, gameId, one)!, /the dungeon allows at most 2, and the others bring 2/);
  // Back to a bigger dungeon: there is room again.
  lobby.chooseDungeon(ann.accountId, "first");
  assert.equal(lobby.join(cat, gameId, one), undefined);
});

test("a player brings 1 to 3 characters, each at most once", () => {
  const lobby = setup();
  assert.match(lobby.create(ann, [])!, /Choose 1 to 3 characters/);
  assert.match(lobby.create(ann, [...three, { number: 4, name: "Adventurer 4" }])!, /Choose 1 to 3 characters/);
  assert.match(lobby.create(ann, [one[0]!, one[0]!])!, /only once/);
  // Nothing was created by the refused attempts.
  assert.equal(lobby.gameIdOf(ann.accountId), undefined);
  assert.equal(lobby.create(ann, three), undefined);
  assert.deepEqual(lobby.playersOf(lobby.gameIdOf(ann.accountId)!)[0]!.characters, three);
});

test("players choose different numbers of characters, up to the dungeon's limit together", () => {
  const lobby = setup();
  lobby.create(ann, three);
  const gameId = lobby.gameIdOf(ann.accountId)!;
  // 3 + 2 would be 5: too many for a dungeon of 4.
  assert.match(lobby.join(ben, gameId, two)!, /at most 4, and the others bring 3/);
  assert.equal(lobby.gameIdOf(ben.accountId), undefined);
  assert.equal(lobby.join(ben, gameId, one), undefined);
  // The game is full now, for anyone.
  assert.match(lobby.join(cat, gameId, one)!, /at most 4, and the others bring 4/);

  // Everyone sees each other's choices.
  assert.deepEqual(
    lobby.snapshotFor(cat.accountId).openGames[0]!.players.map((p) => p.characters.length),
    [3, 1],
  );
});

test("the choice can change until the start, within the limits", () => {
  const lobby = setup();
  assert.match(lobby.chooseCharacters(ann.accountId, two)!, /not in a game/);
  lobby.create(ann, two);
  const gameId = lobby.gameIdOf(ann.accountId)!;
  lobby.join(ben, gameId, two);

  // Ann's own two don't count against her new choice: only Ben's do.
  assert.match(lobby.chooseCharacters(ann.accountId, three)!, /at most 4, and the others bring 2/);
  assert.deepEqual(lobby.snapshotFor(ben.accountId).myGame!.players[0]!.characters, two);
  assert.match(lobby.chooseCharacters(ann.accountId, [])!, /Choose 1 to 3/);
  assert.equal(lobby.chooseCharacters(ben.accountId, one), undefined);
  assert.equal(lobby.chooseCharacters(ann.accountId, three), undefined);
  assert.deepEqual(
    lobby.snapshotFor(ben.accountId).myGame!.players.map((p) => p.characters.map((c) => c.number)),
    [[1, 2, 3], [1]],
  );

  lobby.start(ann.accountId);
  assert.match(lobby.chooseCharacters(ben.accountId, two)!, /already started/);
});

test("the dungeon choice counts characters, not players", () => {
  const lobby = smallSecondDungeon();
  lobby.create(ann, two);
  assert.equal(lobby.chooseDungeon(ann.accountId, "second"), undefined);
  assert.match(lobby.chooseCharacters(ann.accountId, three)!, /at most 2, and the others bring 0/);
  lobby.chooseDungeon(ann.accountId, "first");
  lobby.chooseCharacters(ann.accountId, three);
  assert.match(lobby.chooseDungeon(ann.accountId, "second")!, /at most 2 characters, and the party has 3/);
});
