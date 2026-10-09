import { test } from "node:test";
import assert from "node:assert/strict";
import type { TurnMessage } from "../shared/protocol.ts";
import { DUNGEONS, FIRST_DUNGEON, FIRST_DUNGEON_MAP } from "../shared/rules/dungeon-map.ts";
import { neighbour } from "../shared/rules/hex.ts";
import { baseStats } from "../shared/rules/stats.ts";
import type { Plan } from "../shared/rules/turn.ts";
import { dealMonsters, GameManager, shuffle, type GameCharacter } from "./game-manager.ts";

const CYCLE = 10_000;
// Database ids, which must never show up in what players receive.
const ann = { recordId: 701, accountId: 501, stats: baseStats(), displayName: "Ann", characterName: "Adventurer 1", class: "adventurer" as const, rank: 1, maxXpGain: 450, wonDungeonBefore: false, earlierKills: [] };
const ben = { recordId: 702, accountId: 502, stats: baseStats(), displayName: "Ben", characterName: "Adventurer 1", class: "adventurer" as const, rank: 1, maxXpGain: 450, wonDungeonBefore: false, earlierKills: [] };

/** A "random" that never swaps anything, so the track is in the given order. */
const noShuffle = () => 0.999;
/** Their numbers in the game: in track order, which `noShuffle` leaves as given. */
const ANN = 1;
const BEN = 2;

function setup(characters: GameCharacter[] = [ann, ben]) {
  const turns: TurnMessage[] = [];
  const games = new GameManager({ cycleMs: CYCLE, onTurn: (t) => turns.push(t), random: noShuffle });
  games.start("g", characters);
  return { games, turns };
}

/** Advances in 1-second steps, like the real timer, and notes when each turn fired. */
function run(games: GameManager, turns: TurnMessage[], seconds: number, startAt = 0) {
  const fired: { second: number; characterId: number }[] = [];
  for (let s = startAt + 1; s <= startAt + seconds; s++) {
    const before = turns.length;
    games.advance(1000);
    for (const t of turns.slice(before)) fired.push({ second: s, characterId: t.characterId });
  }
  return fired;
}

test("the first turn fires after one full cycle", () => {
  const { games, turns } = setup();
  games.advance(CYCLE - 1);
  assert.equal(turns.length, 0);
  games.advance(1);
  assert.equal(turns.length, 1);
  const turn = turns[0]!;
  assert.equal(turn.characterId, ANN);
  assert.equal(turn.sequence, 1);
  // No plans yet: the character is placed on the first free start hex.
  assert.deepEqual(turn.events[0], { type: "placed", characterId: ANN, position: { q: 0, r: 0 } });
  assert.deepEqual(turn.nextTurns, [
    { characterId: BEN, inSeconds: 5 },
    { characterId: ANN, inSeconds: 10 },
  ]);
});

test("without a test cycle, each game uses the turn duration it was created with", () => {
  const games = new GameManager({ onTurn: () => {}, random: noShuffle });
  games.start("quick", [ann], FIRST_DUNGEON, "quick");
  games.start("crawl", [ben], FIRST_DUNGEON, "crawl");
  games.start("default", [{ ...ann, accountId: 503 }]);
  const firstTurnIn = (gameId: string) => games.snapshot(gameId, 0)!.nextTurns[0]!.inSeconds;
  assert.equal(firstTurnIn("quick"), 10);
  assert.equal(firstTurnIn("crawl"), 300);
  assert.equal(firstTurnIn("default"), 30);
  // After its turn, a character is due again one cycle of its own game later.
  games.advance(10_000);
  assert.equal(firstTurnIn("quick"), 10);
  assert.equal(firstTurnIn("crawl"), 290);
});

test("player turns are spread evenly over the cycle", () => {
  const { games, turns } = setup();
  assert.deepEqual(run(games, turns, 30), [
    { second: 10, characterId: ANN },
    { second: 15, characterId: BEN },
    { second: 20, characterId: ANN },
    { second: 25, characterId: BEN },
    { second: 30, characterId: ANN },
  ]);
  assert.deepEqual(
    turns.map((t) => t.sequence),
    [1, 2, 3, 4, 5],
  );
});

test("a late tick fires every turn that became due, in order", () => {
  const { games, turns } = setup();
  games.advance(25_000);
  assert.deepEqual(
    turns.map((t) => [t.sequence, t.characterId]),
    [
      [1, ANN],
      [2, BEN],
      [3, ANN],
      [4, BEN],
    ],
  );
});

test("each game keeps its own game time", () => {
  const turns: TurnMessage[] = [];
  const games = new GameManager({ cycleMs: CYCLE, onTurn: (t) => turns.push(t), random: noShuffle });
  games.start("early", [ann]);
  games.advance(6000);
  games.start("late", [ben]);
  games.advance(4000);
  assert.deepEqual(
    turns.map((t) => t.gameId),
    ["early"],
  );
  games.advance(6000);
  assert.deepEqual(
    turns.map((t) => t.gameId),
    ["early", "late"],
  );
});

test("the snapshot holds the state, the names and the turn times", () => {
  const { games } = setup();
  games.advance(2500);
  const snapshot = games.snapshot("g", ann.accountId)!;
  assert.equal(snapshot.sequence, 0);
  assert.equal(snapshot.result, null);
  assert.deepEqual(snapshot.players, [
    { characterId: ANN, displayName: "Ann", characterName: "Adventurer 1", class: "adventurer", rank: 1 },
    { characterId: BEN, displayName: "Ben", characterName: "Adventurer 1", class: "adventurer", rank: 1 },
  ]);
  assert.deepEqual(snapshot.nextTurns, [
    { characterId: ANN, inSeconds: 7.5 },
    { characterId: BEN, inSeconds: 12.5 },
  ]);
  // Monster 0 follows Ann and monster 1 follows Ben (nothing was shuffled).
  assert.deepEqual(snapshot.state.track, [
    { characterId: ANN, monsterIds: [0] },
    { characterId: BEN, monsterIds: [1] },
  ]);
  // Only the game's own numbers: no record or account ids, no names in the rules' state.
  assert.deepEqual(Object.keys(snapshot.state.characters[0]!).sort(), [
    "abilities",
    "abilityUpgrades",
    "cooldowns",
    "earlierKills",
    "hp",
    "id",
    "maxXpGain",
    "position",
    "stats",
    "xpGained",
  ]);
  const text = JSON.stringify(snapshot);
  for (const id of [ann.recordId, ann.accountId, ben.recordId, ben.accountId]) assert.ok(!text.includes(String(id)));
  assert.equal(games.snapshot("other", ann.accountId), undefined);
});

test("each player is told which characters are theirs", () => {
  const { games } = setup();
  assert.deepEqual(games.snapshot("g", ann.accountId)!.yourCharacters, [ANN]);
  assert.deepEqual(games.snapshot("g", ben.accountId)!.yourCharacters, [BEN]);
  assert.deepEqual(games.snapshot("g", 999)!.yourCharacters, []);
});

test("characters are numbered in the shuffled track order", () => {
  const turns: TurnMessage[] = [];
  // 0 always swaps with the first item: [Ann, Ben] becomes [Ben, Ann].
  const games = new GameManager({ cycleMs: CYCLE, onTurn: (t) => turns.push(t), random: () => 0 });
  games.start("g", [ann, ben]);
  const snapshot = games.snapshot("g", ann.accountId)!;
  assert.deepEqual(
    snapshot.state.track.map((s) => s.characterId),
    [1, 2],
  );
  assert.deepEqual(snapshot.players, [
    { characterId: 1, displayName: "Ben", characterName: "Adventurer 1", class: "adventurer", rank: 1 },
    { characterId: 2, displayName: "Ann", characterName: "Adventurer 1", class: "adventurer", rank: 1 },
  ]);
  assert.deepEqual(snapshot.yourCharacters, [2]);
});

test("nobody acts more often after a death, and the clock stops when the game is over", () => {
  // Without plans the characters stand still and the monsters attack them,
  // so both characters eventually die and the game is lost.
  const { games, turns } = setup();
  const fired = run(games, turns, 600);
  assert.ok(turns.some((t) => t.events.some((e) => e.type === "died" && e.who.kind === "character")));
  assert.equal(games.snapshot("g", ann.accountId)!.result, "lost");

  for (const id of [ANN, BEN]) {
    const seconds = fired.filter((f) => f.characterId === id).map((f) => f.second);
    for (let i = 1; i < seconds.length; i++) assert.equal(seconds[i]! - seconds[i - 1]!, CYCLE / 1000);
  }

  const turnsAtEnd = turns.length;
  games.advance(CYCLE * 10);
  assert.equal(turns.length, turnsAtEnd);
  assert.deepEqual(games.snapshot("g", ann.accountId)!.nextTurns, []);
});

test("a plan is carried out when the character's turn fires, and is then used up", () => {
  const { games, turns } = setup();
  const start = FIRST_DUNGEON_MAP.startHexes[2]!;
  assert.equal(games.setPlan("g", ann.accountId, ANN, [{ type: "place", hex: start }]), undefined);
  assert.deepEqual(games.snapshot("g", ben.accountId)!.plans, [{ characterId: ANN, plan: [{ type: "place", hex: start }] }]);

  games.advance(CYCLE);
  assert.deepEqual(turns[0]!.events[0], { type: "placed", characterId: ANN, position: start });
  assert.deepEqual(games.snapshot("g", ann.accountId)!.plans, []);

  // Next turn: a move to the hex below.
  const below = neighbour(start, "down");
  games.setPlan("g", ann.accountId, ANN, [{ type: "move", to: below }]);
  games.advance(CYCLE);
  const annsSecondTurn = turns.filter((t) => t.characterId === ANN)[1]!;
  assert.deepEqual(annsSecondTurn.events[0], { type: "moved", actor: { kind: "character", id: ANN }, from: start, to: below });
});

test("a cleared plan isn't carried out", () => {
  const { games, turns } = setup();
  games.setPlan("g", ann.accountId, ANN, [{ type: "place", hex: FIRST_DUNGEON_MAP.startHexes[2]! }]);
  assert.equal(games.setPlan("g", ann.accountId, ANN, null), undefined);
  assert.deepEqual(games.snapshot("g", ann.accountId)!.plans, []);
  games.advance(CYCLE);
  // No plan: placed automatically on the first free start hex.
  assert.deepEqual(turns[0]!.events[0], { type: "placed", characterId: ANN, position: FIRST_DUNGEON_MAP.startHexes[0] });
});

test("a player can only plan for their own characters, while they are in the game", () => {
  const { games, turns } = setup();
  const plan: Plan = [{ type: "place", hex: FIRST_DUNGEON_MAP.startHexes[1]! }];
  assert.equal(games.setPlan("g", ben.accountId, ANN, plan), "That is not your character.");
  assert.equal(games.setPlan("g", ben.accountId, 99, plan), "That is not your character.");
  assert.equal(games.setPlan("other", ann.accountId, ANN, plan), "You are not in a running game.");
  assert.deepEqual(games.snapshot("g", ann.accountId)!.plans, []);

  // Without plans the characters stand still until the monsters kill them.
  // The first death leaves the other character, so the game goes on.
  const deadCharacter = () => {
    for (const e of turns.flatMap((t) => t.events)) if (e.type === "died" && e.who.kind === "character") return e.who.id;
    return undefined;
  };
  while (deadCharacter() === undefined) games.advance(1000);
  const dead = deadCharacter()!;
  const account = dead === ANN ? ann.accountId : ben.accountId;
  assert.equal(games.snapshot("g", account)!.result, null);
  assert.equal(games.setPlan("g", account, dead, plan), "That character is dead.");

  while (games.snapshot("g", ann.accountId)!.result === null) games.advance(1000);
  assert.equal(games.setPlan("g", ann.accountId, ANN, null), "The game is over.");
});

test("a plan with a heavy strike is refused without the ability, and with two of them", () => {
  const strike: Plan = [{ type: "heavyStrike", monsterId: 0 }];
  // Rank 1: no abilities.
  const rank1 = setup();
  assert.match(rank1.games.setPlan("g", ann.accountId, ANN, strike)!, /^Heavy strike can't be planned/);
  assert.deepEqual(rank1.games.snapshot("g", ann.accountId)!.plans, []);

  // Rank 2 with 2 actions: one heavy strike is fine, two are not.
  const rank2 = setup([{ ...ann, abilities: ["heavyStrike"], stats: { ...baseStats(), actions: 2 } }, ben]);
  assert.equal(rank2.games.setPlan("g", ann.accountId, ANN, strike), undefined);
  assert.equal(
    rank2.games.setPlan("g", ann.accountId, ANN, [...strike, ...strike]),
    "Heavy strike can't be planned: already planned.",
  );
  assert.deepEqual(rank2.games.snapshot("g", ann.accountId)!.plans, [{ characterId: ANN, plan: strike }]);
  assert.deepEqual(rank2.games.snapshot("g", ann.accountId)!.state.characters[0]!.abilities, ["heavyStrike"]);
});

test("a plan with a charge is refused below rank 3, and before the character is on the map", () => {
  const charge: Plan = [{ type: "charge", monsterId: 0 }];
  const rank2 = setup([{ ...ann, abilities: ["heavyStrike"] }, ben]);
  assert.equal(rank2.games.setPlan("g", ann.accountId, ANN, charge), "Charge can't be planned: needs a higher rank.");

  const rank3 = setup([{ ...ann, abilities: ["heavyStrike", "charge"], stats: { ...baseStats(), actions: 2 } }, ben]);
  assert.equal(
    rank3.games.setPlan("g", ann.accountId, ANN, charge),
    "Charge can't be planned: the character isn't on the map yet.",
  );
  // Entering on a start hex first: the monsters are 5 hexes away, too far.
  assert.equal(
    rank3.games.setPlan("g", ann.accountId, ANN, [{ type: "place", hex: FIRST_DUNGEON_MAP.startHexes[1]! }, ...charge]),
    "Charge can't be planned: the monster isn't in a straight line 2 to 4 hexes away.",
  );
  assert.deepEqual(rank3.games.snapshot("g", ann.accountId)!.plans, []);
});

test("a plan with a cleave is refused below rank 4, before the character is on the map, and twice", () => {
  const cleave: Plan = [{ type: "cleave" }];
  const rank3 = setup([{ ...ann, abilities: ["heavyStrike", "charge"] }, ben]);
  assert.equal(rank3.games.setPlan("g", ann.accountId, ANN, cleave), "Cleave can't be planned: needs a higher rank.");

  const rank4 = setup([
    { ...ann, abilities: ["heavyStrike", "charge", "cleave"], stats: { ...baseStats(), actions: 3 } },
    ben,
  ]);
  assert.equal(
    rank4.games.setPlan("g", ann.accountId, ANN, cleave),
    "Cleave can't be planned: the character isn't on the map yet.",
  );
  const enter: Plan = [{ type: "place", hex: FIRST_DUNGEON_MAP.startHexes[1]! }];
  assert.equal(
    rank4.games.setPlan("g", ann.accountId, ANN, [...enter, ...cleave, ...cleave]),
    "Cleave can't be planned: already planned.",
  );
  // No monster is next to the start hex yet, but one may be by the time the turn fires.
  assert.equal(rank4.games.setPlan("g", ann.accountId, ANN, [...enter, ...cleave]), undefined);
  assert.deepEqual(rank4.games.snapshot("g", ann.accountId)!.plans, [{ characterId: ANN, plan: [...enter, ...cleave] }]);
});

test("a removed game stops", () => {
  const { games, turns } = setup();
  games.remove("g");
  games.advance(CYCLE * 2);
  assert.equal(turns.length, 0);
  assert.equal(games.isRunning("g"), false);
});

test("shuffling keeps every item exactly once", () => {
  for (let i = 0; i < 100; i++) {
    assert.deepEqual(shuffle([1, 2, 3, 4], Math.random).sort(), [1, 2, 3, 4]);
  }
});

test("monsters are spread over the characters as evenly as possible", () => {
  for (const [monsters, characters] of [
    [2, 2],
    [3, 2],
    [1, 3],
    [4, 4],
    [5, 3],
  ] as const) {
    for (let i = 0; i < 20; i++) {
      const monsterIds = Array.from({ length: monsters }, (_, id) => id);
      const characterIds = Array.from({ length: characters }, (_, id) => 100 + id);
      const assignment = dealMonsters(monsterIds, characterIds, Math.random);
      assert.equal(assignment.size, monsters);
      const counts = characterIds.map((c) => [...assignment.values()].filter((v) => v === c).length);
      assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, `${monsters} over ${characters}: ${counts}`);
    }
  }
});

test("the 8 rats of the Rat Warren are spread over the characters as evenly as possible", () => {
  const monsterIds = DUNGEONS.warren.map.monsters.map((_, id) => id);
  assert.equal(monsterIds.length, 8);
  const expected: Record<number, number[]> = { 1: [8], 2: [4, 4], 3: [3, 3, 2], 4: [2, 2, 2, 2] };
  for (const [characters, counts] of Object.entries(expected)) {
    for (let i = 0; i < 20; i++) {
      const characterIds = Array.from({ length: Number(characters) }, (_, id) => 100 + id);
      const assignment = dealMonsters(monsterIds, characterIds, Math.random);
      const perCharacter = characterIds.map((c) => [...assignment.values()].filter((v) => v === c).length);
      assert.deepEqual(perCharacter.sort().reverse(), counts);
    }
  }

  // And in a real game: 2 characters get 4 rats each.
  const games = new GameManager({ cycleMs: CYCLE, onTurn: () => {}, random: noShuffle });
  games.start("g", [ann, ben], DUNGEONS.warren);
  const { state } = games.snapshot("g", ann.accountId)!;
  assert.deepEqual(state.track.map((s) => s.monsterIds.length), [4, 4]);
});

test("a game starts in the dungeon it is given, with that dungeon's map and silver", () => {
  const games = new GameManager({ cycleMs: CYCLE, onTurn: () => {}, random: noShuffle });
  games.start("g", [ann, ben], DUNGEONS.second);
  const snapshot = games.snapshot("g", ann.accountId)!;
  assert.deepEqual(snapshot.state.map, DUNGEONS.second.map);
  assert.equal(snapshot.state.monsters.length, 4);
  // 4 monsters over 2 characters: 2 each.
  assert.deepEqual(
    snapshot.state.track.map((s) => s.monsterIds.length),
    [2, 2],
  );
  assert.equal(snapshot.silverReward, 20);
});

test("a game with more characters than its dungeon allows doesn't start", () => {
  const games = new GameManager({ cycleMs: CYCLE, onTurn: () => {} });
  const tiny = { ...DUNGEONS.first, maxCharacters: 1 };
  assert.throws(() => games.start("g", [ann, ben], tiny), /at most 1 characters/);
  assert.equal(games.isRunning("g"), false);
});
