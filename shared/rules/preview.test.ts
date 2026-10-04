import { test } from "node:test";
import assert from "node:assert/strict";
import { FIRST_DUNGEON_MAP } from "./dungeon-map.ts";
import type { CharacterId, GameState, MonsterId } from "./game-state.ts";
import { fromOffset, type Hex } from "./hex.ts";
import { previewCycle } from "./preview.ts";
import { baseStats } from "./stats.ts";
import { createTrack } from "./track.ts";
import { newGameState, resolveTurn, type Plan } from "./turn.ts";

const A = 1;
const B = 2;

/**
 * The first dungeon with characters A and B, in that order on the track.
 * Monster 0 stands at column 5, row 1; monster 1 at column 5, row 2.
 */
function game(monsters: [MonsterId, CharacterId][], positions: { a?: Hex; b?: Hex } = {}): GameState {
  const state = newGameState(
    FIRST_DUNGEON_MAP,
    [
      { id: A, stats: baseStats() },
      { id: B, stats: baseStats() },
    ],
    createTrack([A, B], new Map(monsters)),
  );
  return {
    ...state,
    characters: state.characters.map((c) => ({
      ...c,
      position: (c.id === A ? positions.a : positions.b) ?? null,
    })),
  };
}

function withHp(state: GameState, characterId: CharacterId, hp: number): GameState {
  return { ...state, characters: state.characters.map((c) => (c.id === characterId ? { ...c, hp } : c)) };
}

test("the preview is the turns resolved one after the other", () => {
  const state = game([
    [0, A],
    [1, B],
  ]);
  const plans = new Map<CharacterId, Plan>([[B, { type: "place", hex: fromOffset(0, 3) }]]);
  const preview = previewCycle(state, [A, B], plans);

  const first = resolveTurn(state, A, plans);
  const second = resolveTurn(first.newState, B, plans);
  assert.deepEqual(preview.turns, [
    { characterId: A, events: first.events },
    { characterId: B, events: second.events },
  ]);
});

test("each monster's next action, with whom it goes after", () => {
  const state = game([
    [0, A],
    [1, B],
  ]);
  const plans = new Map<CharacterId, Plan>([[B, { type: "place", hex: fromOffset(0, 3) }]]);
  const { monsters } = previewCycle(state, [A, B], plans);
  // A enters at the top and is the only one on the map when monster 0 acts.
  // By the time monster 1 acts, B is on the bottom start hex, closer to it.
  assert.deepEqual(monsters.get(0), { type: "move", after: A, from: fromOffset(5, 1), to: fromOffset(4, 2), target: A });
  assert.deepEqual(monsters.get(1), { type: "move", after: B, from: fromOffset(5, 2), to: fromOffset(4, 3), target: B });
});

test("the turns are previewed in the order given: the soonest first", () => {
  const state = game([
    [0, A],
    [1, B],
  ]);
  const preview = previewCycle(state, [B, A], new Map());
  assert.deepEqual(
    preview.turns.map((t) => t.characterId),
    [B, A],
  );
  // B acts first now, so it gets the top start hex.
  assert.deepEqual(preview.turns[0]!.events[0], { type: "placed", characterId: B, position: fromOffset(0, 0) });
});

test("a character that dies before its turn is skipped, and so are the monsters that followed it", () => {
  // A stands next to monster 0 with 1 hit point left. Monster 0 follows B,
  // who acts first; monster 1 follows A.
  const state = withHp(
    game(
      [
        [0, B],
        [1, A],
      ],
      { a: fromOffset(4, 1), b: fromOffset(0, 3) },
    ),
    A,
    1,
  );
  const { turns, monsters } = previewCycle(state, [B, A], new Map());
  assert.deepEqual(
    turns.map((t) => t.characterId),
    [B],
  );
  assert.deepEqual(monsters.get(0), { type: "attack", after: B, target: A, targetAt: fromOffset(4, 1), damage: 1, kills: true });
  // Monster 1 now follows B, whose turn has already been previewed.
  assert.deepEqual(monsters.get(1), { type: "stays" });
});

test("the preview stops when the game ends", () => {
  // Monster 1 is already dead; monster 0 has 1 hit point left and stands next to A.
  const start = game([[0, A]], { a: fromOffset(4, 1), b: fromOffset(0, 0) });
  const state: GameState = {
    ...start,
    monsters: start.monsters.map((m) => ({ ...m, hp: m.id === 0 ? 1 : 0 })),
  };
  const plans = new Map<CharacterId, Plan>([[A, { type: "attack", monsterId: 0 }]]);
  const { turns, monsters } = previewCycle(state, [A, B], plans);
  assert.deepEqual(
    turns.map((t) => t.characterId),
    [A],
  );
  assert.equal(turns[0]!.events.at(-1)!.type, "gameEnded");
  assert.deepEqual([...monsters], [[0, { type: "dies", after: A }]]);
});

test("the preview doesn't change the state it is given", () => {
  const state = game([
    [0, A],
    [1, B],
  ]);
  const copy = structuredClone(state);
  previewCycle(state, [A, B], new Map());
  assert.deepEqual(state, copy);
});
