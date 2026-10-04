import { test } from "node:test";
import assert from "node:assert/strict";
import { FIRST_DUNGEON_MAP } from "./dungeon-map.ts";
import { applyEvents } from "./events.ts";
import type { CharacterId, GameState } from "./game-state.ts";
import { fromOffset } from "./hex.ts";
import { baseStats } from "./stats.ts";
import { createTrack } from "./track.ts";
import { gameResult, newGameState, resolveTurn, type Plan } from "./turn.ts";

const A = 1;
const B = 2;

/**
 * The first dungeon with characters A and B. Monster 0 stands at column 5,
 * row 1; monster 1 at column 5, row 2. The start hexes are column 0, rows 0
 * to 3.
 *
 * With `monstersAct`, monster 0 follows A and monster 1 follows B on the
 * track. Without it the monsters are on the map but not on the track, so
 * they never act: that keeps the tests of the characters' own actions short.
 */
function firstGame(monstersAct = false): GameState {
  return newGameState(
    FIRST_DUNGEON_MAP,
    [
      { id: A, stats: baseStats() },
      { id: B, stats: baseStats() },
    ],
    createTrack([A, B], monstersAct ? new Map([[0, A], [1, B]]) : new Map()),
  );
}

/** Resolves one turn and also checks that replaying the events gives the same state. */
function turn(state: GameState, characterId: CharacterId, plan?: Plan) {
  const plans = new Map<CharacterId, Plan>(plan ? [[characterId, plan]] : []);
  const result = resolveTurn(state, characterId, plans);
  assert.deepEqual(applyEvents(state, result.events), result.newState, "replaying the events");
  return result;
}

function position(state: GameState, characterId: CharacterId) {
  return state.characters.find((c) => c.id === characterId)!.position;
}

/** A game in which A has already entered the room, and stands at the given column and row. */
function withAAt(col: number, row: number, monstersAct = false): GameState {
  const state = firstGame(monstersAct);
  return {
    ...state,
    characters: state.characters.map((c) => (c.id === A ? { ...c, position: fromOffset(col, row) } : c)),
  };
}

test("a new game: characters off the map at full hit points, monsters in their places", () => {
  const state = firstGame();
  assert.deepEqual(
    state.characters.map((c) => ({ id: c.id, hp: c.hp, position: c.position })),
    [
      { id: A, hp: 10, position: null },
      { id: B, hp: 10, position: null },
    ],
  );
  assert.deepEqual(
    state.monsters.map((m) => ({ id: m.id, hp: m.hp, position: m.position })),
    [
      { id: 0, hp: 3, position: fromOffset(5, 1) },
      { id: 1, hp: 3, position: fromOffset(5, 2) },
    ],
  );
  assert.equal(gameResult(state), null);
});

// --- Entering the room ---

test("a character is placed on its planned start hex", () => {
  const { newState, events } = turn(firstGame(), A, { type: "place", hex: fromOffset(0, 2) });
  assert.deepEqual(events, [{ type: "placed", characterId: A, position: fromOffset(0, 2) }]);
  assert.deepEqual(position(newState, A), fromOffset(0, 2));
});

test("a character without a placement plan goes on the first free start hex from the top", () => {
  const { newState, events } = turn(firstGame(), A);
  assert.deepEqual(events, [{ type: "placed", characterId: A, position: fromOffset(0, 0) }]);
  assert.deepEqual(position(newState, A), fromOffset(0, 0));
});

test("automatic placement skips start hexes that are taken", () => {
  const afterA = turn(firstGame(), A).newState; // A on row 0
  const { events } = turn(afterA, B);
  assert.deepEqual(events, [{ type: "placed", characterId: B, position: fromOffset(0, 1) }]);
});

test("two players plan the same start hex: the one who acts first gets it", () => {
  const plan: Plan = { type: "place", hex: fromOffset(0, 1) };
  const afterA = turn(firstGame(), A, plan).newState;
  assert.deepEqual(position(afterA, A), fromOffset(0, 1));

  // B's plan is cancelled, which leaves B without a plan: automatic placement.
  const { newState, events } = turn(afterA, B, plan);
  assert.deepEqual(events, [
    { type: "planCancelled", characterId: B, reason: "hex taken" },
    { type: "placed", characterId: B, position: fromOffset(0, 0) },
  ]);
  assert.deepEqual(position(newState, B), fromOffset(0, 0));
});

test("a placement on a hex that isn't a start hex is cancelled", () => {
  const { events } = turn(firstGame(), A, { type: "place", hex: fromOffset(1, 0) });
  assert.deepEqual(events, [
    { type: "planCancelled", characterId: A, reason: "not a start hex" },
    { type: "placed", characterId: A, position: fromOffset(0, 0) },
  ]);
});

test("a character that isn't placed yet can't move or attack: it is placed instead", () => {
  const { events } = turn(firstGame(), A, { type: "move", to: fromOffset(1, 0) });
  assert.deepEqual(events, [
    { type: "planCancelled", characterId: A, reason: "not placed" },
    { type: "placed", characterId: A, position: fromOffset(0, 0) },
  ]);
});

test("when no start hex is free, the character stays off the map and tries again next turn", () => {
  const full: GameState = {
    ...firstGame(),
    map: { ...FIRST_DUNGEON_MAP, startHexes: [fromOffset(0, 0)] },
  };
  const afterA = turn(full, A).newState;
  const { newState, events } = turn(afterA, B, { type: "place", hex: fromOffset(0, 0) });
  assert.deepEqual(events, [
    { type: "planCancelled", characterId: B, reason: "hex taken" },
    { type: "notPlaced", characterId: B },
  ]);
  assert.equal(position(newState, B), null);

  // A moves away; on B's next turn the start hex is free again.
  const afterMove = turn(newState, A, { type: "move", to: fromOffset(1, 0) }).newState;
  assert.deepEqual(position(turn(afterMove, B).newState, B), fromOffset(0, 0));
});

test("a placed character can't be placed again", () => {
  const afterA = turn(firstGame(), A).newState;
  const { newState, events } = turn(afterA, A, { type: "place", hex: fromOffset(0, 3) });
  assert.deepEqual(events, [{ type: "planCancelled", characterId: A, reason: "already placed" }]);
  assert.deepEqual(position(newState, A), fromOffset(0, 0));
});

// --- Moving ---

test("a character moves 1 hex", () => {
  const state = withAAt(0, 0);
  const { newState, events } = turn(state, A, { type: "move", to: fromOffset(1, 0) });
  assert.deepEqual(events, [
    { type: "moved", actor: { kind: "character", id: A }, from: fromOffset(0, 0), to: fromOffset(1, 0) },
  ]);
  assert.deepEqual(position(newState, A), fromOffset(1, 0));
});

test("no plan means doing nothing", () => {
  const state = withAAt(0, 0);
  const { newState, events } = turn(state, A);
  assert.deepEqual(events, []);
  assert.deepEqual(newState, state);
});

test("a move that can no longer be carried out is cancelled", () => {
  const state = withAAt(4, 1); // next to monster 0 at 5,1
  const cancelled = (to: ReturnType<typeof fromOffset>) => turn(state, A, { type: "move", to }).events;
  assert.deepEqual(cancelled(fromOffset(5, 1)), [{ type: "planCancelled", characterId: A, reason: "hex taken" }]);
  assert.deepEqual(cancelled(fromOffset(2, 1)), [{ type: "planCancelled", characterId: A, reason: "not a neighbour" }]);
  const atEdge = withAAt(0, 0);
  assert.deepEqual(turn(atEdge, A, { type: "move", to: fromOffset(0, -1) }).events, [
    { type: "planCancelled", characterId: A, reason: "not on the map" },
  ]);
});

// --- Attacking ---

test("a character attacks an adjacent monster for 1", () => {
  const state = withAAt(4, 1);
  const { newState, events } = turn(state, A, { type: "attack", monsterId: 0 });
  assert.deepEqual(events, [
    { type: "attacked", attacker: { kind: "character", id: A }, target: { kind: "monster", id: 0 }, damage: 1 },
  ]);
    assert.equal(newState.monsters[0]!.hp, state.monsters[0]!.hp - 1);
});

test("an attack on a monster that isn't adjacent is cancelled", () => {
  const state = withAAt(3, 1);
  const { newState, events } = turn(state, A, { type: "attack", monsterId: 0 });
  assert.deepEqual(events, [{ type: "planCancelled", characterId: A, reason: "target gone" }]);
  assert.equal(newState.monsters[0]!.hp, state.monsters[0]!.hp);
});

test("a monster at 0 hit points dies and leaves the track; its hex is free again", () => {
  const base = withAAt(4, 1, true);
  const state: GameState = { ...base, monsters: base.monsters.map((m) => (m.id === 0 ? { ...m, hp: 1 } : m)) };
  const { newState, events } = turn(state, A, { type: "attack", monsterId: 0 });
  assert.deepEqual(events.slice(1), [{ type: "died", who: { kind: "monster", id: 0 } }]);
  assert.deepEqual(newState.track, [
    { characterId: A, monsterIds: [] },
    { characterId: B, monsterIds: [1] },
  ]);
  assert.equal(gameResult(newState), null);

  // A dead monster can't be attacked, and doesn't block its hex.
  assert.deepEqual(turn(newState, A, { type: "attack", monsterId: 0 }).events, [
    { type: "planCancelled", characterId: A, reason: "target gone" },
  ]);
  assert.deepEqual(position(turn(newState, A, { type: "move", to: fromOffset(5, 1) }).newState, A), fromOffset(5, 1));
});

// --- Monsters ---

test("a monster acts directly after the character it follows", () => {
  // A is placed on column 0, row 0. Monster 0 (at column 5, row 1) then moves
  // towards A. Down-left and up-left are equally good; down-left comes first
  // clockwise, and straight down is taken by monster 1.
  const { events } = turn(firstGame(true), A);
  assert.deepEqual(events, [
    { type: "placed", characterId: A, position: fromOffset(0, 0) },
    { type: "moved", actor: { kind: "monster", id: 0 }, from: fromOffset(5, 1), to: fromOffset(4, 2) },
  ]);
});

test("a monster attacks an adjacent character; at 0 hit points the character dies", () => {
  const base = withAAt(4, 1, true); // next to monster 0 at 5,1
  const state: GameState = { ...base, characters: base.characters.map((c) => (c.id === A ? { ...c, hp: 1 } : c)) };
  const { newState, events } = turn(state, A);
  assert.deepEqual(events, [
    { type: "attacked", attacker: { kind: "monster", id: 0 }, target: { kind: "character", id: A }, damage: 1 },
    { type: "died", who: { kind: "character", id: A } },
  ]);
  // B is still alive (but not on the map yet), so the game goes on. A's
  // monster now follows B.
  assert.equal(gameResult(newState), null);
  assert.deepEqual(newState.track, [{ characterId: B, monsterIds: [1, 0] }]);
});

test("a monster that kills the last character loses the game", () => {
  const base = withAAt(4, 1, true);
  const state: GameState = {
    ...base,
    characters: base.characters.map((c) => (c.id === A ? { ...c, hp: 1 } : { ...c, hp: 0 })),
  };
  const { newState, events } = turn(state, A);
  assert.deepEqual(events.slice(1), [
    { type: "died", who: { kind: "character", id: A } },
    { type: "gameEnded", result: "lost" },
  ]);
  assert.equal(gameResult(newState), "lost");
});

// --- Winning and losing ---

test("killing the last monster wins the game", () => {
  const base = withAAt(4, 1);
  const state: GameState = {
    ...base,
    monsters: base.monsters.map((m) => (m.id === 0 ? { ...m, hp: 1 } : { ...m, hp: 0 })),
  };
  const { newState, events } = turn(state, A, { type: "attack", monsterId: 0 });
  assert.deepEqual(events.slice(1), [
    { type: "died", who: { kind: "monster", id: 0 } },
    { type: "gameEnded", result: "won" },
  ]);
  assert.equal(gameResult(newState), "won");
  assert.throws(() => resolveTurn(newState, B, new Map()), /over/);
});

test("the game is lost when every character is dead", () => {
  const state = firstGame();
  const oneDead: GameState = { ...state, characters: state.characters.map((c) => (c.id === A ? { ...c, hp: 0 } : c)) };
  assert.equal(gameResult(oneDead), null);
  const allDead: GameState = { ...state, characters: state.characters.map((c) => ({ ...c, hp: 0 })) };
  assert.equal(gameResult(allDead), "lost");
});

// --- Purity ---

test("resolving a turn doesn't change the state it was given", () => {
  const state = withAAt(4, 1);
  const copy = structuredClone(state);
  turn(state, A, { type: "attack", monsterId: 0 });
  turn(state, A, { type: "move", to: fromOffset(4, 0) });
  assert.deepEqual(state, copy);
});

test("only characters on the track can take a turn", () => {
  assert.throws(() => resolveTurn(firstGame(), 99, new Map()), /initiative track/);
});
