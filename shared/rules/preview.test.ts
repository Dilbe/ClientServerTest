import { test } from "node:test";
import assert from "node:assert/strict";
import { FIRST_DUNGEON_MAP } from "./dungeon-map.ts";
import type { CharacterId, GameState, MonsterId } from "./game-state.ts";
import { fromOffset, type Hex } from "./hex.ts";
import { previewCycle } from "./preview.ts";
import { baseStats, MONSTER_TYPES } from "./stats.ts";
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
  const plans = new Map<CharacterId, Plan>([[B, [{ type: "place", hex: fromOffset(0, 3) }]]]);
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
  const plans = new Map<CharacterId, Plan>([[B, [{ type: "place", hex: fromOffset(0, 3) }]]]);
  const { monsters } = previewCycle(state, [A, B], plans);
  // A enters at the top and is the only one on the map when monster 0 acts.
  // By the time monster 1 acts, B is on the bottom start hex, closer to it.
  assert.deepEqual(monsters.get(0), {
    type: "acts",
    after: A,
    steps: [{ type: "move", from: fromOffset(5, 1), to: fromOffset(4, 2), target: A }],
  });
  assert.deepEqual(monsters.get(1), {
    type: "acts",
    after: B,
    steps: [{ type: "move", from: fromOffset(5, 2), to: fromOffset(4, 3), target: B }],
  });
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
  assert.deepEqual(monsters.get(0), {
    type: "acts",
    after: B,
    steps: [{ type: "attack", target: A, targetAt: fromOffset(4, 1), damage: 1, kills: true }],
  });
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
  const plans = new Map<CharacterId, Plan>([[A, [{ type: "attack", monsterId: 0 }]]]);
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

test("a planned action that another character's plan gets in the way of is shown as cancelled", () => {
  // Both A and B are on the map and plan to step onto the same hex. A acts
  // first, so B's move is cancelled; the preview says so before it happens.
  const state = game([], { a: fromOffset(1, 0), b: fromOffset(1, 2) });
  const to = fromOffset(1, 1);
  const plans = new Map<CharacterId, Plan>([
    [A, [{ type: "move", to }]],
    [B, [{ type: "move", to }]],
  ]);
  assert.deepEqual(previewCycle(state, [A, B], plans).cancellations, [
    { type: "planCancelled", characterId: B, action: 0, reason: "hex taken" },
  ]);
  // In the other order it is A's move that won't go through.
  assert.deepEqual(previewCycle(state, [B, A], plans).cancellations, [
    { type: "planCancelled", characterId: A, action: 0, reason: "hex taken" },
  ]);
});

test("with several actions, a monster's preview lists all of them, in order", (t) => {
  // For this test only, the basic monster has 2 actions.
  t.mock.property(MONSTER_TYPES.basic, "stats", { ...MONSTER_TYPES.basic.stats, actions: 2 });
  // A stands two hexes from monster 0: it steps next to A (down-left comes
  // before up-left, clockwise from straight up) and then attacks.
  const state = game([[0, B]], { a: fromOffset(3, 1), b: fromOffset(0, 3) });
  const { monsters } = previewCycle(state, [A, B], new Map());
  assert.deepEqual(monsters.get(0), {
    type: "acts",
    after: B,
    steps: [
      { type: "move", from: fromOffset(5, 1), to: fromOffset(4, 2), target: A },
      { type: "attack", target: A, targetAt: fromOffset(3, 1), damage: 1, kills: false },
    ],
  });
});
