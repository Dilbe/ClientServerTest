import { test } from "node:test";
import assert from "node:assert/strict";
import { DIFFICULTY_IDS, type DungeonWin } from "../shared/rules/difficulties.ts";
import { DUNGEON_IDS, DUNGEONS, type DungeonId } from "../shared/rules/dungeon-map.ts";
import { Lobby } from "./lobby.ts";

const ann = { accountId: 1, displayName: "Ann" };
const ben = { accountId: 2, displayName: "Ben" };
const cat = { accountId: 3, displayName: "Cat" };

/** Choices of one, two and three characters. */
const one = [{ number: 1, name: "Adventurer 1" }];
const two = [...one, { number: 2, name: "Runner" }];
const three = [...two, { number: 3, name: "Adventurer 3" }];

/** A dungeon on Normal. */
function normal(dungeonId: DungeonId) {
  return { dungeonId, difficulty: "normal" as const };
}

/**
 * The wins of the players in most tests: everyone has won the first dungeon
 * on Normal, so each can play the first and the second, and anyone can join
 * anyone's game. Tests about unlocking pass their own.
 */
function winsOf(): DungeonWin[] {
  return [normal("first")];
}

function setup(wins: (accountId: number) => readonly DungeonWin[] = winsOf) {
  return new Lobby((id) => id !== 3, wins); // Cat is offline
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
    // Everyone's wins, because it is Ben's own game (and it hasn't started).
    players: [
      { displayName: "Ann", online: true, characters: one, dungeonWins: [normal("first")] },
      { displayName: "Ben", online: true, characters: one, dungeonWins: [normal("first")] },
      { displayName: "Cat", online: false, characters: one, dungeonWins: [normal("first")] },
    ],
    // In the order they joined.
    turnOrder: [
      { player: 0, number: 1 },
      { player: 1, number: 1 },
      { player: 2, number: 1 },
    ],
    // Ann's next dungeon to clear.
    dungeonId: "second",
    difficulty: "normal",
    turnDuration: "normal",
    private: false,
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
  return new Lobby(() => true, winsOf, { ...DUNGEONS, second: { ...DUNGEONS.second, maxCharacters: 2 } });
}

test("the creator chooses the dungeon, and everyone sees it", () => {
  const lobby = setup();
  lobby.create(ann, one);
  const gameId = lobby.gameIdOf(ann.accountId)!;
  lobby.join(ben, gameId, one);
  assert.equal(lobby.chooseDungeon(ann.accountId, normal("second")), undefined);
  assert.equal(lobby.snapshotFor(ben.accountId).myGame?.dungeonId, "second");
  assert.equal(lobby.snapshotFor(cat.accountId).openGames[0]?.dungeonId, "second");
  assert.equal(lobby.dungeonOfGame(gameId), DUNGEONS.second);
  assert.equal(lobby.chooseDungeon(ann.accountId, normal("first")), undefined);
  assert.equal(lobby.dungeonOfGame(gameId), DUNGEONS.first);
});

test("only the creator chooses the dungeon, and only before the start", () => {
  const lobby = setup();
  assert.match(lobby.chooseDungeon(ann.accountId, normal("second"))!, /not in a game/);
  lobby.create(ann, one);
  lobby.join(ben, lobby.gameIdOf(ann.accountId)!, one);
  assert.match(lobby.chooseDungeon(ben.accountId, normal("second"))!, /Only the player who created/);
  lobby.start(ann.accountId);
  assert.match(lobby.chooseDungeon(ann.accountId, normal("second"))!, /already started/);
});

test("a dungeon the party is too big for can't be chosen", () => {
  const lobby = smallSecondDungeon();
  lobby.create(ann, one);
  const gameId = lobby.gameIdOf(ann.accountId)!;
  lobby.join(ben, gameId, one);
  // Exactly at the limit is fine.
  assert.equal(lobby.chooseDungeon(ann.accountId, normal("second")), undefined);
  assert.equal(lobby.chooseDungeon(ann.accountId, normal("first")), undefined);
  lobby.join(cat, gameId, one);
  assert.match(lobby.chooseDungeon(ann.accountId, normal("second"))!, /at most 2 characters, and the party has 3/);
  assert.equal(lobby.dungeonOfGame(gameId), DUNGEONS.first);
});

test("nobody can join when that would go over the chosen dungeon's limit", () => {
  const lobby = smallSecondDungeon();
  lobby.create(ann, one);
  const gameId = lobby.gameIdOf(ann.accountId)!;
  lobby.chooseDungeon(ann.accountId, normal("second"));
  assert.equal(lobby.join(ben, gameId, one), undefined);
  assert.match(lobby.join(cat, gameId, one)!, /the dungeon allows at most 2, and the others bring 2/);
  // Back to a bigger dungeon: there is room again.
  lobby.chooseDungeon(ann.accountId, normal("first"));
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
  assert.equal(lobby.chooseDungeon(ann.accountId, normal("second")), undefined);
  assert.match(lobby.chooseCharacters(ann.accountId, three)!, /at most 2, and the others bring 0/);
  lobby.chooseDungeon(ann.accountId, normal("first"));
  lobby.chooseCharacters(ann.accountId, three);
  assert.match(lobby.chooseDungeon(ann.accountId, normal("second"))!, /at most 2 characters, and the party has 3/);
});

// ---- Difficulties and unlocking dungeons: everyone in the party must be able to play ----

/** Every dungeon won on these difficulties. */
function allWon(...difficulties: (typeof DIFFICULTY_IDS)[number][]): DungeonWin[] {
  return difficulties.flatMap((difficulty) => DUNGEON_IDS.map((dungeonId) => ({ dungeonId, difficulty })));
}

test("a new game starts on the host's next dungeon, on the hardest difficulty they have unlocked", () => {
  const wins: Record<number, DungeonWin[]> = {
    [ann.accountId]: [],
    [ben.accountId]: [...allWon("normal"), { dungeonId: "first", difficulty: "hard" }],
    [cat.accountId]: allWon("normal", "hard", "heroic"),
  };
  const lobby = setup((id) => wins[id] ?? []);
  for (const player of [ann, ben, cat]) lobby.create(player, one);
  const choice = (accountId: number) => {
    const game = lobby.snapshotFor(accountId).myGame!;
    return { dungeonId: game.dungeonId, difficulty: game.difficulty };
  };
  assert.deepEqual(choice(ann.accountId), normal("first"));
  assert.deepEqual(choice(ben.accountId), { dungeonId: "second", difficulty: "hard" });
  // Everything cleared everywhere: the last dungeon on the hardest difficulty.
  assert.deepEqual(choice(cat.accountId), { dungeonId: DUNGEON_IDS.at(-1), difficulty: "heroic" });
});

test("the server refuses a dungeon or difficulty the host can't play", () => {
  const lobby = setup();
  lobby.create(ann, one);
  const gameId = lobby.gameIdOf(ann.accountId)!;
  // Ann has only won the first dungeon on Normal: the third is locked, and so is Hard.
  assert.match(lobby.chooseDungeon(ann.accountId, normal("hallway"))!, /can't play The hallway on Normal yet/);
  assert.match(lobby.chooseDungeon(ann.accountId, { dungeonId: "first", difficulty: "hard" })!, /on Hard yet/);
  assert.equal(lobby.dungeonOfGame(gameId), DUNGEONS.second);
  assert.equal(lobby.difficultyOfGame(gameId), "normal");
});

test("Hard can be chosen after clearing every dungeon on Normal", () => {
  const lobby = setup(() => allWon("normal"));
  lobby.create(ann, one);
  const gameId = lobby.gameIdOf(ann.accountId)!;
  assert.equal(lobby.chooseDungeon(ann.accountId, { dungeonId: "first", difficulty: "hard" }), undefined);
  assert.equal(lobby.difficultyOfGame(gameId), "hard");
  // Only the first on Hard so far, and Heroic is still locked.
  assert.match(lobby.chooseDungeon(ann.accountId, { dungeonId: "second", difficulty: "hard" })!, /yet/);
  assert.match(lobby.chooseDungeon(ann.accountId, { dungeonId: "first", difficulty: "heroic" })!, /yet/);
  // Every cleared dungeon on Normal can still be replayed.
  assert.equal(lobby.chooseDungeon(ann.accountId, normal("warren")), undefined);
});

test("nobody can join a game whose dungeon they can't play", () => {
  const wins: Record<number, DungeonWin[]> = {
    [ann.accountId]: allWon("normal"),
    [ben.accountId]: [],
    [cat.accountId]: allWon("normal"),
  };
  const lobby = setup((id) => wins[id] ?? []);
  lobby.create(ann, one);
  const gameId = lobby.gameIdOf(ann.accountId)!;
  assert.equal(lobby.difficultyOfGame(gameId), "hard");
  // Ben has won nothing, so Hard is locked for him.
  assert.match(lobby.join(ben, gameId, one)!, /can't play The first dungeon on Hard yet, so you can't join/);
  assert.equal(lobby.join(cat, gameId, one), undefined);
  // On the first dungeon on Normal, Ben can join.
  lobby.chooseDungeon(ann.accountId, normal("first"));
  assert.equal(lobby.join(ben, gameId, one), undefined);
});

test("someone who can't play the dungeon gets that answer, not a wrong password", () => {
  const lobby = setup((id) => (id === ann.accountId ? allWon("normal") : []));
  lobby.create(ann, one, "normal", "secret");
  const gameId = lobby.gameIdOf(ann.accountId)!;
  for (let i = 0; i < 10; i++) assert.match(lobby.join(ben, gameId, one, "guess")!, /can't play/);
});

test("the host can only choose a dungeon and difficulty everyone in the party can play", () => {
  const wins: Record<number, DungeonWin[]> = {
    [ann.accountId]: allWon("normal"),
    [ben.accountId]: [normal("first")],
  };
  const lobby = setup((id) => wins[id] ?? []);
  lobby.create(ann, one);
  const gameId = lobby.gameIdOf(ann.accountId)!;
  lobby.chooseDungeon(ann.accountId, normal("first"));
  lobby.join(ben, gameId, one);
  // Ann could play these, but Ben can't.
  assert.match(lobby.chooseDungeon(ann.accountId, normal("hallway"))!, /^Ben can't play The hallway on Normal yet/);
  assert.match(lobby.chooseDungeon(ann.accountId, { dungeonId: "first", difficulty: "hard" })!, /^Ben can't play/);
  // Ben can play the second: it is his next to clear.
  assert.equal(lobby.chooseDungeon(ann.accountId, normal("second")), undefined);
  // Once Ben leaves, Ann alone can choose Hard again.
  lobby.leave(ben.accountId);
  assert.equal(lobby.chooseDungeon(ann.accountId, { dungeonId: "first", difficulty: "hard" }), undefined);
});

test("the party screen has everyone's wins; the open games list has nobody's", () => {
  const lobby = setup();
  lobby.create(ann, one);
  const gameId = lobby.gameIdOf(ann.accountId)!;
  lobby.join(ben, gameId, one);
  assert.deepEqual(
    lobby.snapshotFor(ann.accountId).myGame!.players.map((p) => p.dungeonWins),
    [[normal("first")], [normal("first")]],
  );
  const listed = lobby.snapshotFor(cat.accountId).openGames[0]!;
  assert.deepEqual(listed.players.map((p) => p.dungeonWins), [undefined, undefined]);
});

test("when the host leaves, the choice stays: everyone could play it, so the new host can too", () => {
  const wins: Record<number, DungeonWin[]> = {
    [ann.accountId]: [normal("first"), normal("second")],
    [ben.accountId]: [normal("first"), normal("second"), normal("hallway")],
  };
  const lobby = setup((id) => wins[id] ?? []);
  lobby.create(ann, one);
  const gameId = lobby.gameIdOf(ann.accountId)!;
  lobby.chooseDungeon(ann.accountId, normal("second"));
  lobby.join(ben, gameId, one);
  lobby.leave(ann.accountId);
  assert.equal(lobby.snapshotFor(ben.accountId).myGame!.creator, "Ben");
  assert.equal(lobby.dungeonOfGame(gameId), DUNGEONS.second);
});

/** A game's turn order as "player index:character number", for short asserts. */
function orderOf(lobby: Lobby, accountId: number): string[] {
  return lobby.snapshotFor(accountId).myGame!.turnOrder.map((o) => `${o.player}:${o.number}`);
}

test("new characters go to the end of the turn order; kept ones stay where they are", () => {
  const lobby = setup();
  lobby.create(ann, two);
  const gameId = lobby.gameIdOf(ann.accountId)!;
  lobby.join(ben, gameId, one);
  assert.deepEqual(orderOf(lobby, ann.accountId), ["0:1", "0:2", "1:1"]);

  // Ann swaps her character 1 for character 3: 2 stays, 3 goes last.
  lobby.chooseCharacters(ann.accountId, [two[1]!, { number: 3, name: "Tank" }]);
  assert.deepEqual(orderOf(lobby, ann.accountId), ["0:2", "1:1", "0:3"]);

  // Leaving takes the player's characters out.
  lobby.leave(ben.accountId);
  assert.deepEqual(orderOf(lobby, ann.accountId), ["0:2", "0:3"]);
});

test("only the host sets the turn order, before the start", () => {
  const lobby = setup();
  lobby.create(ann, one);
  const gameId = lobby.gameIdOf(ann.accountId)!;
  lobby.join(ben, gameId, two);
  const reversed = [
    { player: 1, number: 2 },
    { player: 1, number: 1 },
    { player: 0, number: 1 },
  ];
  assert.match(lobby.setTurnOrder(ben.accountId, reversed)!, /Only the player who created/);
  assert.equal(lobby.setTurnOrder(ann.accountId, reversed), undefined);
  // Everyone sees it.
  assert.deepEqual(orderOf(lobby, ben.accountId), ["1:2", "1:1", "0:1"]);
  assert.deepEqual(lobby.turnOrderOf(gameId), [
    { accountId: ben.accountId, number: 2 },
    { accountId: ben.accountId, number: 1 },
    { accountId: ann.accountId, number: 1 },
  ]);

  lobby.start(ann.accountId);
  assert.match(lobby.setTurnOrder(ann.accountId, reversed.slice().reverse())!, /already started/);
});

test("a turn order that isn't exactly the party's characters is refused", () => {
  const lobby = setup();
  lobby.create(ann, one);
  lobby.join(ben, lobby.gameIdOf(ann.accountId)!, one);
  for (const order of [
    [{ player: 0, number: 1 }], // one missing
    [{ player: 0, number: 1 }, { player: 0, number: 1 }], // twice
    [{ player: 0, number: 1 }, { player: 1, number: 2 }], // not chosen
    [{ player: 0, number: 1 }, { player: 2, number: 1 }], // no such player
  ]) {
    assert.match(lobby.setTurnOrder(ann.accountId, order)!, /party changed/);
  }
  assert.deepEqual(orderOf(lobby, ann.accountId), ["0:1", "1:1"]);
});

test("a private game can only be joined with its password, which is never shown", () => {
  const lobby = setup();
  lobby.create(ann, one, "normal", "secret");
  const listed = lobby.snapshotFor(ben.accountId).openGames[0]!;
  assert.equal(listed.private, true);
  assert.doesNotMatch(JSON.stringify(lobby.snapshotFor(ann.accountId)), /secret/);
  assert.match(lobby.join(ben, listed.id, one)!, /private/);
  assert.match(lobby.join(ben, listed.id, one, "Secret")!, /Wrong password/);
  assert.equal(lobby.join(ben, listed.id, one, "secret"), undefined);
  assert.equal(lobby.snapshotFor(ben.accountId).myGame?.players.length, 2);
});

test("a game without a password ignores one given when joining", () => {
  const lobby = setup();
  lobby.create(ann, one);
  const gameId = lobby.snapshotFor(ben.accountId).openGames[0]!.id;
  assert.equal(lobby.snapshotFor(ben.accountId).openGames[0]!.private, false);
  assert.equal(lobby.join(ben, gameId, one, "anything"), undefined);
});

test("after 5 wrong passwords in a minute, even the right one is refused for a while", () => {
  const lobby = setup();
  lobby.create(ann, one, "normal", "secret");
  const gameId = lobby.snapshotFor(ben.accountId).openGames[0]!.id;
  for (let i = 0; i < 5; i++) assert.match(lobby.join(ben, gameId, one, `guess ${i}`)!, /Wrong password/);
  assert.match(lobby.join(ben, gameId, one, "secret")!, /Too many wrong passwords/);
  // Counted per account: Cat can still join.
  assert.equal(lobby.join(cat, gameId, one, "secret"), undefined);
});

test("the host removes another player, who can join again", () => {
  const lobby = setup();
  lobby.create(ann, one);
  const gameId = lobby.snapshotFor(ann.accountId).myGame!.id;
  lobby.join(ben, gameId, one);
  lobby.join(cat, gameId, one);
  assert.match(lobby.kick(ben.accountId, 2, "Cat")!, /Only the player who created/);
  assert.match(lobby.kick(ann.accountId, 0, "Ann")!, /can't remove yourself/);
  // The index and the name must match: the party may have changed meanwhile.
  assert.match(lobby.kick(ann.accountId, 1, "Cat")!, /changed in the meantime/);
  assert.match(lobby.kick(ann.accountId, 5, "Cat")!, /changed in the meantime/);

  assert.equal(lobby.kick(ann.accountId, 1, "Ben"), undefined);
  assert.equal(lobby.snapshotFor(ben.accountId).myGame, null);
  const game = lobby.snapshotFor(ann.accountId).myGame!;
  assert.deepEqual(game.players.map((p) => p.displayName), ["Ann", "Cat"]);
  assert.deepEqual(game.turnOrder, [
    { player: 0, number: 1 },
    { player: 1, number: 1 },
  ]);
  // No other penalty.
  assert.equal(lobby.join(ben, gameId, one), undefined);
});

test("nobody can be removed after the start", () => {
  const lobby = setup();
  lobby.create(ann, one);
  const gameId = lobby.snapshotFor(ann.accountId).myGame!.id;
  lobby.join(ben, gameId, one);
  lobby.start(ann.accountId);
  assert.match(lobby.kick(ann.accountId, 1, "Ben")!, /already started/);
});

test("the party's choice follows the character page: new names, used-up characters drop out (issue #153)", () => {
  const lobby = setup();
  lobby.create(ann, two);
  const gameId = lobby.gameIdOf(ann.accountId)!;
  lobby.join(ben, gameId, one);

  // Ann renamed character 1 and used up character 2 in a rank-up, which made character 4.
  lobby.updateCharacters(ann.accountId, [
    { number: 1, name: "Scout" },
    { number: 3, name: "Adventurer 3" },
    { number: 4, name: "Adventurer 4" },
  ]);
  const game = lobby.snapshotFor(ann.accountId).myGame!;
  assert.deepEqual(game.players[0]!.characters, [{ number: 1, name: "Scout" }]);
  assert.deepEqual(game.turnOrder, [
    { player: 0, number: 1 },
    { player: 1, number: 1 },
  ]);

  // With nothing left to bring, the game can't start until Ann chooses again.
  lobby.updateCharacters(ann.accountId, [{ number: 4, name: "Adventurer 4" }]);
  assert.equal(lobby.start(ann.accountId), "Ann has no characters chosen.");
  assert.equal(lobby.chooseCharacters(ann.accountId, [{ number: 4, name: "Adventurer 4" }]), undefined);
  assert.equal(lobby.start(ann.accountId), undefined);

  // A started game is left alone.
  lobby.updateCharacters(ann.accountId, []);
  assert.deepEqual(lobby.playersOf(gameId)[0]!.characters, [{ number: 4, name: "Adventurer 4" }]);
});
