// The preview must match what really happens (issue #24). These tests play
// whole games on the game manager. At the start of every cycle they run the
// client's preview on the snapshot a player would get, then let the server
// play that cycle, and compare the two turn by turn.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { TurnMessage } from "../shared/protocol.ts";
import { DUNGEONS, isOnMap, type Dungeon } from "../shared/rules/dungeon-map.ts";
import { isFree, type CharacterId, type GameState } from "../shared/rules/game-state.ts";
import { areNeighbours, distance, neighbours } from "../shared/rules/hex.ts";
import { previewCycle } from "../shared/rules/preview.ts";

import type { Plan } from "../shared/rules/turn.ts";
import { GameManager } from "./game-manager.ts";
import { baseStats } from "../shared/rules/classes.ts";

const CYCLE = 10_000;
const players = [501, 502, 503, 504, 505, 506].map((accountId, i) => ({
  recordId: 700 + i,
  accountId,
  stats: baseStats("adventurer"),
  displayName: `Player ${i + 1}`,
  characterName: "Adventurer 1",
  class: "adventurer" as const,
  rank: 1,
  maxXpGain: 450,
  wonDungeonBefore: false,
  earlierKills: [],
}));

/**
 * What a simple player plans: attack a monster next to the character, else
 * open a closed door next to it, or else step towards the nearest monster. Before placement: no plan, so the
 * character enters on the first free start hex. Some plans will be cancelled
 * (two characters heading for the same hex), which the preview must get
 * right too.
 */
function simplePlan(state: GameState, characterId: CharacterId): Plan | null {
  const character = state.characters.find((c) => c.id === characterId)!;
  if (character.position === null) return null;
  const alive = state.monsters.filter((m) => m.hp > 0);
  const adjacent = alive.find((m) => areNeighbours(m.position, character.position!));
  if (adjacent) return [{ type: "attack", target: adjacent.position }];
  const door = state.closedDoors.find((d) => areNeighbours(d, character.position!));
  if (door) return [{ type: "openDoor", door }];
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

function playAndCompare(dungeon: Dungeon, playerCount: number, planner: Planner): "won" | "lost" {
  const turns: TurnMessage[] = [];
  const games = new GameManager({ cycleMs: CYCLE, onTurn: (t) => turns.push(t) });
  const party = players.slice(0, playerCount);
  games.start("g", party, dungeon);
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

    assert.deepEqual(preview.turns, actual, `${dungeon.id}, ${playerCount} players, cycle ${cycles + 1}`);
  }
  // Every game must reach the end, or the comparison never saw a win or loss.
  const result = games.snapshot("g", party[0]!.accountId)!.result;
  assert.notEqual(result, null, `${dungeon.id}, ${playerCount} players: the game didn't end`);
  return result!;
}

test("the preview matches what the server does, cycle after cycle, until the game ends", () => {
  const results = new Set<string>();
  // Nothing in a game is random, so variety comes from the dungeons and
  // the party sizes. Not every dungeon: in the hallway and the warren these
  // simple players can end up waiting forever, and the game never ends.
  const dungeons = [
    DUNGEONS.first,
    DUNGEONS.second,
    DUNGEONS.guardPost,
    DUNGEONS.archersGallery,
    DUNGEONS.tessasLair,
    DUNGEONS.kennels,
    DUNGEONS.barracks,
    DUNGEONS.crypt,
    DUNGEONS.gauntlet,
    DUNGEONS.lottesHall,
  ];
  for (const dungeon of dungeons) {
    // Up to as many characters as the dungeon allows: 6 in the 6-character dungeons.
    for (const playerCount of [1, 2, 3, 6].filter((n) => n <= dungeon.maxCharacters)) {
      results.add(playAndCompare(dungeon, playerCount, simplePlan));
      // In the Kennels and Lotte's Hall every hallway hex is a start hex, so
      // monsters can't reach a character waiting at the back of it, and an
      // idle party never loses. In the Crypt nothing is awake until the
      // party opens a door, so an idle party waits forever.
      const idleNeverEnds = [DUNGEONS.kennels, DUNGEONS.crypt, DUNGEONS.lottesHall];
      if (!idleNeverEnds.includes(dungeon)) results.add(playAndCompare(dungeon, playerCount, idle));
    }
  }
  // Both endings came up, so the comparison covered characters dying (and
  // their monsters moving on the track) as well as monsters dying.
  assert.deepEqual([...results].sort(), ["lost", "won"]);
});

test("the preview matches when no one plans anything", () => {
  const turns: TurnMessage[] = [];
  const games = new GameManager({ cycleMs: CYCLE, onTurn: (t) => turns.push(t) });
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
