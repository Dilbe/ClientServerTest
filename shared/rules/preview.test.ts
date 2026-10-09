import { test } from "node:test";
import assert from "node:assert/strict";
import { ARCHERS_GALLERY_MAP, FIRST_DUNGEON_MAP, HALLWAY_MAP, RAT_WARREN_MAP } from "./dungeon-map.ts";
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
  const plans = new Map<CharacterId, Plan>([[A, [{ type: "attack", target: state.monsters[0]!.position }]]]);
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

test("the preview shows a rat stepping next to a character and attacking it in the same turn", () => {
  // The Rat Warren: rat 0 stands at column 3, row 2, two hexes from A at column 1, row 1.
  const state = newGameState(RAT_WARREN_MAP, [{ id: A, stats: baseStats() }], createTrack([A], new Map([[0, A]])));
  const placed: GameState = {
    ...state,
    characters: state.characters.map((c) => ({ ...c, position: fromOffset(1, 1) })),
  };
  assert.deepEqual(previewCycle(placed, [A], new Map()).monsters.get(0), {
    type: "acts",
    after: A,
    steps: [
      { type: "move", from: fromOffset(3, 2), to: fromOffset(2, 2), target: A },
      { type: "attack", target: A, targetAt: fromOffset(1, 1), damage: 1, kills: false },
    ],
  });
});

test("a sleeping monster is asleep in the preview, until a planned door opens", () => {
  // The hallway: A stands next to the door, monster 2 sleeps behind it and follows A.
  const state = newGameState(HALLWAY_MAP, [{ id: A, stats: baseStats() }], createTrack([A], new Map([[2, A]])));
  const placed: GameState = {
    ...state,
    characters: state.characters.map((c) => ({ ...c, position: fromOffset(0, 7) })),
  };
  assert.deepEqual(previewCycle(placed, [A], new Map()).monsters.get(2), { type: "asleep" });
  assert.deepEqual(previewCycle(placed, [A], new Map()).monsters.get(0), { type: "stays" });

  const plans = new Map<CharacterId, Plan>([[A, [{ type: "openDoor", door: fromOffset(1, 6) }]]]);
  const { monsters } = previewCycle(placed, [A], plans);
  // Woken up, monster 2 acts at once: it follows A.
  assert.equal(monsters.get(2)?.type, "acts");
  // Monster 3 wakes too, but isn't on the track here, so it doesn't act.
  assert.deepEqual(monsters.get(3), { type: "stays" });
});

test("the preview shows an archer shooting from a distance, and the turn does what the preview shows", () => {
  // The Archers' Gallery: archer 1 stands at column 3, row 0, 3 hexes from
  // A at column 4, row 3. Only the archer is alive, so nothing else moves.
  const state = newGameState(ARCHERS_GALLERY_MAP, [{ id: A, stats: baseStats() }], createTrack([A], new Map([[1, A]])));
  const placed: GameState = {
    ...state,
    characters: state.characters.map((c) => ({ ...c, position: fromOffset(4, 3) })),
    monsters: state.monsters.map((m) => (m.id === 1 ? m : { ...m, hp: 0 })),
  };
  const preview = previewCycle(placed, [A], new Map());
  assert.deepEqual(preview.monsters.get(1), {
    type: "acts",
    after: A,
    steps: [{ type: "attack", target: A, targetAt: fromOffset(4, 3), damage: 1, kills: false }],
  });
  assert.deepEqual(preview.turns[0]!.events, resolveTurn(placed, A, new Map()).events);

  // With a planned step behind the pillar at column 3, row 2, A is out of sight: the archer moves instead.
  const plans = new Map<CharacterId, Plan>([[A, [{ type: "move", to: fromOffset(3, 3) }]]]);
  const hidden = previewCycle(placed, [A], plans);
  const archer = hidden.monsters.get(1);
  assert.ok(archer?.type === "acts");
  assert.deepEqual(
    archer.steps.map((step) => step.type),
    ["move"],
  );
  assert.deepEqual(hidden.turns[0]!.events, resolveTurn(placed, A, plans).events);
});
