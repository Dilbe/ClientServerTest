import { test } from "node:test";
import assert from "node:assert/strict";
import type { TurnMessage } from "../shared/protocol.ts";
import { baseStats } from "../shared/rules/stats.ts";
import { dealMonsters, GameManager, shuffle } from "./game-manager.ts";

const CYCLE = 10_000;
const ann = { id: 1, accountId: 11, stats: baseStats(), displayName: "Ann" };
const ben = { id: 2, accountId: 12, stats: baseStats(), displayName: "Ben" };

/** A "random" that never swaps anything, so the track is in the given order. */
const noShuffle = () => 0.999;

function setup(characters = [ann, ben]) {
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
  assert.equal(turn.characterId, ann.id);
  assert.equal(turn.sequence, 1);
  // No plans yet: the character is placed on the first free start hex.
  assert.deepEqual(turn.events[0], { type: "placed", characterId: ann.id, position: { q: 0, r: 0 } });
  assert.deepEqual(turn.nextTurns, [
    { characterId: ben.id, inSeconds: 5 },
    { characterId: ann.id, inSeconds: 10 },
  ]);
});

test("player turns are spread evenly over the cycle", () => {
  const { games, turns } = setup();
  assert.deepEqual(run(games, turns, 30), [
    { second: 10, characterId: ann.id },
    { second: 15, characterId: ben.id },
    { second: 20, characterId: ann.id },
    { second: 25, characterId: ben.id },
    { second: 30, characterId: ann.id },
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
      [1, ann.id],
      [2, ben.id],
      [3, ann.id],
      [4, ben.id],
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
  const snapshot = games.snapshot("g")!;
  assert.equal(snapshot.sequence, 0);
  assert.equal(snapshot.result, null);
  assert.deepEqual(snapshot.players, [
    { characterId: ann.id, displayName: "Ann" },
    { characterId: ben.id, displayName: "Ben" },
  ]);
  assert.deepEqual(snapshot.nextTurns, [
    { characterId: ann.id, inSeconds: 7.5 },
    { characterId: ben.id, inSeconds: 12.5 },
  ]);
  // Monster 0 follows Ann and monster 1 follows Ben (nothing was shuffled).
  assert.deepEqual(snapshot.state.track, [
    { characterId: ann.id, monsterIds: [0] },
    { characterId: ben.id, monsterIds: [1] },
  ]);
  // The display names stay out of the rules' state.
  assert.deepEqual(Object.keys(snapshot.state.characters[0]!).sort(), ["accountId", "hp", "id", "position", "stats"]);
  assert.equal(games.snapshot("other"), undefined);
});

test("nobody acts more often after a death, and the clock stops when the game is over", () => {
  // Without plans the characters stand still and the monsters attack them,
  // so both characters eventually die and the game is lost.
  const { games, turns } = setup();
  const fired = run(games, turns, 600);
  assert.ok(turns.some((t) => t.events.some((e) => e.type === "died" && e.who.kind === "character")));
  assert.equal(games.snapshot("g")!.result, "lost");

  for (const id of [ann.id, ben.id]) {
    const seconds = fired.filter((f) => f.characterId === id).map((f) => f.second);
    for (let i = 1; i < seconds.length; i++) assert.equal(seconds[i]! - seconds[i - 1]!, CYCLE / 1000);
  }

  const turnsAtEnd = turns.length;
  games.advance(CYCLE * 10);
  assert.equal(turns.length, turnsAtEnd);
  assert.deepEqual(games.snapshot("g")!.nextTurns, []);
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
