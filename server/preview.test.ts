// The preview must match what really happens (issue #24). These tests play
// whole games on the game manager. At the start of every cycle they run the
// client's preview on the snapshot a player would get, then let the server
// play that cycle, and compare the two turn by turn.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { TurnMessage } from "../shared/protocol.ts";
import { isOnMap } from "../shared/rules/dungeon-map.ts";
import { isFree, type CharacterId, type GameState } from "../shared/rules/game-state.ts";
import { areNeighbours, distance, neighbours } from "../shared/rules/hex.ts";
import { previewCycle } from "../shared/rules/preview.ts";
import { baseStats } from "../shared/rules/stats.ts";
import type { Plan } from "../shared/rules/turn.ts";
import { GameManager } from "./game-manager.ts";

const CYCLE = 10_000;
const players = [501, 502, 503].map((accountId, i) => ({
  recordId: 700 + i,
  accountId,
  stats: baseStats(),
  displayName: `Player ${i + 1}`,
  characterName: "Adventurer 1",
  maxXpGain: 450,
  wonDungeonBefore: false,
  earlierKills: [],
}));

/** A small seeded random (a linear congruential generator), so every run deals the same tracks. */
function seeded(seed: number): () => number {
  let x = seed;
  return () => {
    x = (x * 1103515245 + 12345) % 2 ** 31;
    return x / 2 ** 31;
  };
}

/**
 * What a simple player plans: attack a monster next to the character, or
 * else step towards the nearest monster. Before placement: no plan, so the
 * character enters on the first free start hex. Some plans will be cancelled
 * (two characters heading for the same hex), which the preview must get
 * right too.
 */
function simplePlan(state: GameState, characterId: CharacterId): Plan | null {
  const character = state.characters.find((c) => c.id === characterId)!;
  if (character.position === null) return null;
  const alive = state.monsters.filter((m) => m.hp > 0);
  const adjacent = alive.find((m) => areNeighbours(m.position, character.position!));
  if (adjacent) return [{ type: "attack", monsterId: adjacent.id }];
  const nearest = (h: typeof character.position) => Math.min(...alive.map((m) => distance(m.position, h!)));
  const steps = neighbours(character.position).filter((h) => isOnMap(state.map, h) && isFree(state, h));
  const best = steps.sort((a, b) => nearest(a) - nearest(b))[0];
  return best ? [{ type: "move", to: best }] : null;
}

/** A player who never plans: their character enters the room and then waits to be killed. */
function idle(): Plan | null {
  return null;
}

type Planner = (state: GameState, characterId: CharacterId) => Plan | null;

function playAndCompare(seed: number, playerCount: number, planner: Planner): "won" | "lost" {
  const turns: TurnMessage[] = [];
  const games = new GameManager({ cycleMs: CYCLE, onTurn: (t) => turns.push(t), random: seeded(seed) });
  const party = players.slice(0, playerCount);
  games.start("g", party);
  // Which account each character belongs to, from each player's own snapshot.
  const owners = new Map<CharacterId, number>();
  for (const p of party) for (const id of games.snapshot("g", p.accountId)!.yourCharacters) owners.set(id, p.accountId);

  let cycles = 0;
  for (; cycles < 100; cycles++) {
    const before = games.snapshot("g", party[0]!.accountId)!;
    if (before.result !== null) break;
    for (const slot of before.state.track) {
      games.setPlan("g", owners.get(slot.characterId)!, slot.characterId, planner(before.state, slot.characterId));
    }

    // The preview, exactly as the client runs it: on the snapshot, with the
    // plans and the order of the next turns as the server sends them.
    const snapshot = games.snapshot("g", party[0]!.accountId)!;
    const preview = previewCycle(
      snapshot.state,
      snapshot.nextTurns.map((t) => t.characterId),
      new Map(snapshot.plans.map((p) => [p.characterId, p.plan])),
    );

    // Let the server play up to the last of those turns.
    const firstNew = turns.length;
    const seconds = Math.ceil(Math.max(...snapshot.nextTurns.map((t) => t.inSeconds)));
    for (let s = 0; s < seconds; s++) games.advance(1000);
    const actual = turns.slice(firstNew).map((t) => ({ characterId: t.characterId, events: t.events }));

    assert.deepEqual(preview.turns, actual, `seed ${seed}, cycle ${cycles + 1}`);
  }
  // Every game must reach the end, or the comparison never saw a win or loss.
  const result = games.snapshot("g", party[0]!.accountId)!.result;
  assert.notEqual(result, null, `seed ${seed}: the game didn't end`);
  return result!;
}

test("the preview matches what the server does, cycle after cycle, until the game ends", () => {
  const results = new Set<string>();
  for (let seed = 1; seed <= 10; seed++) {
    for (const playerCount of [1, 2, 3]) {
      results.add(playAndCompare(seed, playerCount, simplePlan));
      results.add(playAndCompare(seed, playerCount, idle));
    }
  }
  // Both endings came up, so the comparison covered characters dying (and
  // their monsters moving on the track) as well as monsters dying.
  assert.deepEqual([...results].sort(), ["lost", "won"]);
});

test("the preview matches when no one plans anything", () => {
  const turns: TurnMessage[] = [];
  const games = new GameManager({ cycleMs: CYCLE, onTurn: (t) => turns.push(t), random: seeded(7) });
  games.start("g", players.slice(0, 2));
  // A few cycles: the characters enter the room on their own, and the
  // monsters come to them.
  for (let cycle = 0; cycle < 3; cycle++) {
    const snapshot = games.snapshot("g", players[0]!.accountId)!;
    const preview = previewCycle(snapshot.state, snapshot.nextTurns.map((t) => t.characterId), new Map());
    const firstNew = turns.length;
    const seconds = Math.ceil(Math.max(...snapshot.nextTurns.map((t) => t.inSeconds)));
    for (let s = 0; s < seconds; s++) games.advance(1000);
    assert.deepEqual(
      preview.turns,
      turns.slice(firstNew).map((t) => ({ characterId: t.characterId, events: t.events })),
    );
  }
});
