import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ARCHERS_GALLERY_MAP,
  FIRST_DUNGEON_MAP,
  GUARD_POST_MAP,
  HALLWAY_MAP,
  RAT_WARREN_MAP,
  isOnMap,
  isStartHex,
} from "./dungeon-map.ts";
import { applyEvent, applyEvents } from "./events.ts";
import { isClosedDoor, isFree, type CharacterId, type GameState } from "./game-state.ts";
import { areNeighbours, distance, fromOffset, hexKey, neighbours, stepsFrom, toOffset, type Hex } from "./hex.ts";
import { inLineOfSight } from "./line-of-sight.ts";
import { baseStats, MONSTER_TYPES } from "./stats.ts";
import { createTrack } from "./track.ts";
import { followUpPlan, gameResult, newGameState, resolveTurn, type Plan, type PlannedAction } from "./turn.ts";

const A = 1;
const B = 2;
/** Where monster 0 of the first dungeon stands at the start. */
const M0 = fromOffset(5, 1);

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

/**
 * Resolves one turn, with the given actions as the character's plan, and
 * also checks that replaying the events gives the same state.
 */
function turn(state: GameState, characterId: CharacterId, ...plan: Plan) {
  const plans = new Map<CharacterId, Plan>(plan.length > 0 ? [[characterId, plan]] : []);
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
  const plan: PlannedAction = { type: "place", hex: fromOffset(0, 1) };
  const afterA = turn(firstGame(), A, plan).newState;
  assert.deepEqual(position(afterA, A), fromOffset(0, 1));

  // B's plan is cancelled, which leaves B without a plan: automatic placement.
  const { newState, events } = turn(afterA, B, plan);
  assert.deepEqual(events, [
    { type: "planCancelled", characterId: B, action: 0, reason: "hex taken" },
    { type: "placed", characterId: B, position: fromOffset(0, 0) },
  ]);
  assert.deepEqual(position(newState, B), fromOffset(0, 0));
});

test("a placement on a hex that isn't a start hex is cancelled", () => {
  const { events } = turn(firstGame(), A, { type: "place", hex: fromOffset(1, 0) });
  assert.deepEqual(events, [
    { type: "planCancelled", characterId: A, action: 0, reason: "not a start hex" },
    { type: "placed", characterId: A, position: fromOffset(0, 0) },
  ]);
});

test("a character that isn't placed yet can't move or attack: it is placed instead", () => {
  const { events } = turn(firstGame(), A, { type: "move", to: fromOffset(1, 0) });
  assert.deepEqual(events, [
    { type: "planCancelled", characterId: A, action: 0, reason: "not placed" },
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
    { type: "planCancelled", characterId: B, action: 0, reason: "hex taken" },
    { type: "notPlaced", characterId: B },
  ]);
  assert.equal(position(newState, B), null);

  // A moves away; on B's next turn the start hex is free again.
  const afterMove = turn(newState, A, { type: "move", to: fromOffset(1, 0) }).newState;
  assert.deepEqual(position(turn(afterMove, B).newState, B), fromOffset(0, 0));
});

// --- The hallway (few start hexes, walls) ---

const C = 3;

/**
 * The hallway with characters A, B and C. Monsters 0 and 1 stand in the
 * front room, monsters 2 and 3 asleep in the back room. By default monster 0
 * and 3 follow A, monster 1 follows B and monster 2 follows C.
 */
function hallwayGame(
  assignment: [number, CharacterId][] = [
    [0, A],
    [1, B],
    [2, C],
    [3, A],
  ],
): GameState {
  return newGameState(
    HALLWAY_MAP,
    [A, B, C].map((id) => ({ id, stats: baseStats() })),
    createTrack([A, B, C], new Map(assignment)),
  );
}

test("in the hallway, a third character waits until a start hex is free", () => {
  let state = hallwayGame();
  state = turn(state, A).newState;
  state = turn(state, B).newState;
  const { newState, events } = turn(state, C);
  assert.deepEqual(events.filter((e) => "characterId" in e && e.characterId === C), [{ type: "notPlaced", characterId: C }]);
  assert.equal(position(newState, C), null);

  // A walks up the hallway; on C's next turn, A's start hex is free again.
  const afterMove = turn(newState, A, { type: "move", to: fromOffset(2, 14) }).newState;
  assert.deepEqual(position(turn(afterMove, C).newState, C), fromOffset(2, 15));
});

/**
 * A simple player for the tests that play a dungeon to the end: attack an
 * adjacent monster, otherwise take a step along the shortest way to the
 * nearest awake monster. When every monster left is asleep, it goes to a
 * closed door instead and opens it, or, without closed doors, to the
 * nearest sleeping monster (a guard). Before entering the room it plans
 * nothing, so it is placed automatically.
 */
function simplePlan(state: GameState, characterId: CharacterId): Plan {
  const at = position(state, characterId);
  if (at === null) return [];
  const alive = state.monsters.filter((m) => m.hp > 0);
  const adjacent = alive.find((m) => areNeighbours(at, m.position));
  if (adjacent) return [{ type: "attack", target: adjacent.position }];

  const awake = alive.filter((m) => !m.asleep);
  const door = state.closedDoors.find((d) => areNeighbours(at, d));
  if (awake.length === 0 && door) return [{ type: "openDoor", door }];

  const canEnter = (h: Hex) => isOnMap(state.map, h) && !isClosedDoor(state, h) && isFree(state, h);
  const goals =
    awake.length > 0
      ? awake.map((m) => m.position)
      : state.closedDoors.length > 0
        ? state.closedDoors
        : alive.map((m) => m.position);
  const fromGoals = goals.map((h) => stepsFrom(h, canEnter));
  const stepsLeft = (h: Hex) =>
    Math.min(...fromGoals.map((steps) => steps.get(hexKey(h)) ?? Infinity));
  const options = neighbours(at).filter(canEnter);
  if (options.length === 0) return [];
  const best = options.reduce((a, b) => (stepsLeft(b) < stepsLeft(a) ? b : a));
  return [{ type: "move", to: best }];
}

test("the hallway can be played to the end, and no monster ever stands on a start hex", () => {
  let state = hallwayGame();
  let doorOpened = false;
  for (let cycle = 0; cycle < 50 && gameResult(state) === null; cycle++) {
    for (const { characterId } of [...state.track]) {
      if (gameResult(state) !== null) break;
      if (!state.track.some((s) => s.characterId === characterId)) continue; // Died this cycle.
      const { newState, events } = turn(state, characterId, ...simplePlan(state, characterId));
      state = newState;
      if (events.some((e) => e.type === "doorOpened")) doorOpened = true;
      for (const m of state.monsters) {
        assert.ok(!isStartHex(state.map, m.position), `monster ${m.id} on a start hex`);
        // The back room's monsters stay put until the door opens.
        if (!doorOpened && m.id >= 2) assert.deepEqual(m.position, HALLWAY_MAP.monsters[m.id]!.position);
      }
    }
  }
  assert.ok(doorOpened);
  assert.equal(gameResult(state), "won");
  // Everybody entered the room, the third character too.
  assert.ok(state.characters.every((c) => c.position !== null));
});

test("a placed character can't be placed again", () => {
  const afterA = turn(firstGame(), A).newState;
  const { newState, events } = turn(afterA, A, { type: "place", hex: fromOffset(0, 3) });
  assert.deepEqual(events, [{ type: "planCancelled", characterId: A, action: 0, reason: "already placed" }]);
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
  assert.deepEqual(cancelled(fromOffset(5, 1)), [{ type: "planCancelled", characterId: A, action: 0, reason: "hex taken" }]);
  assert.deepEqual(cancelled(fromOffset(2, 1)), [{ type: "planCancelled", characterId: A, action: 0, reason: "not a neighbour" }]);
  const atEdge = withAAt(0, 0);
  assert.deepEqual(turn(atEdge, A, { type: "move", to: fromOffset(0, -1) }).events, [
    { type: "planCancelled", characterId: A, action: 0, reason: "not on the map" },
  ]);
});

// --- Attacking ---

test("a character attacks an adjacent monster for 1", () => {
  const state = withAAt(4, 1);
  const { newState, events } = turn(state, A, { type: "attack", target: M0 });
  assert.deepEqual(events, [
    { type: "attacked", attacker: { kind: "character", id: A }, target: { kind: "monster", id: 0 }, damage: 1 },
  ]);
    assert.equal(newState.monsters[0]!.hp, state.monsters[0]!.hp - 1);
});

test("an attack on a hex that isn't adjacent is cancelled", () => {
  const state = withAAt(3, 1);
  const { newState, events } = turn(state, A, { type: "attack", target: M0 });
  assert.deepEqual(events, [{ type: "planCancelled", characterId: A, action: 0, reason: "not a neighbour" }]);
  assert.equal(newState.monsters[0]!.hp, state.monsters[0]!.hp);
});

test("an attack on a hex without a monster is cancelled", () => {
  const { events } = turn(withAAt(4, 1), A, { type: "attack", target: fromOffset(4, 0) });
  assert.deepEqual(events, [{ type: "planCancelled", characterId: A, action: 0, reason: "target gone" }]);
});

test("an attack on a hex with a character is cancelled: characters never hit each other", () => {
  const base = withAAt(4, 1);
  const state: GameState = {
    ...base,
    characters: base.characters.map((c) => (c.id === B ? { ...c, position: fromOffset(4, 0) } : c)),
  };
  const { newState, events } = turn(state, A, { type: "attack", target: fromOffset(4, 0) });
  assert.deepEqual(events, [{ type: "planCancelled", characterId: A, action: 0, reason: "target gone" }]);
  assert.equal(newState.characters.find((c) => c.id === B)!.hp, 10);
});

test("an attack hits whichever monster stands on the hex when it is carried out", () => {
  // Planned on an empty hex; monster 1 steps onto it before the turn fires.
  const base = withAAt(4, 1);
  const state: GameState = {
    ...base,
    monsters: base.monsters.map((m) => (m.id === 1 ? { ...m, position: fromOffset(4, 0) } : m)),
  };
  const { events } = turn(state, A, { type: "attack", target: fromOffset(4, 0) });
  assert.deepEqual(events, [
    { type: "attacked", attacker: { kind: "character", id: A }, target: { kind: "monster", id: 1 }, damage: 1 },
  ]);
});

test("a move onto a hex that was taken when it was planned goes through once the hex is free", () => {
  // B stands on 1,1 when A plans its move there, and steps away on its own turn first.
  const base = withAAt(0, 1);
  const state: GameState = {
    ...base,
    characters: base.characters.map((c) => (c.id === B ? { ...c, position: fromOffset(1, 1) } : c)),
  };
  const plans = new Map<CharacterId, Plan>([
    [A, [{ type: "move", to: fromOffset(1, 1) }]],
    [B, [{ type: "move", to: fromOffset(2, 1) }]],
  ]);
  const afterB = resolveTurn(state, B, plans).newState;
  const { events } = resolveTurn(afterB, A, plans);
  assert.deepEqual(events, [
    { type: "moved", actor: { kind: "character", id: A }, from: fromOffset(0, 1), to: fromOffset(1, 1) },
  ]);
});

test("a monster at 0 hit points dies and leaves the track; its hex is free again", () => {
  const base = withAAt(4, 1, true);
  const state: GameState = { ...base, monsters: base.monsters.map((m) => (m.id === 0 ? { ...m, hp: 1 } : m)) };
  const { newState, events } = turn(state, A, { type: "attack", target: M0 });
  assert.deepEqual(events.slice(1), [
    { type: "died", who: { kind: "monster", id: 0 } },
    {
      type: "xpGained",
      gains: [
        { characterId: A, xp: 10 },
        { characterId: B, xp: 10 },
      ],
    },
  ]);
  assert.deepEqual(newState.track, [
    { characterId: A, monsterIds: [] },
    { characterId: B, monsterIds: [1] },
  ]);
  assert.equal(gameResult(newState), null);

  // A dead monster can't be attacked, and doesn't block its hex.
  assert.deepEqual(turn(newState, A, { type: "attack", target: M0 }).events, [
    { type: "planCancelled", characterId: A, action: 0, reason: "target gone" },
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

// --- Several actions per turn ---

/** The state with A's actions stat set to `actions`. */
function withActions(state: GameState, actions: number): GameState {
  return {
    ...state,
    characters: state.characters.map((c) => (c.id === A ? { ...c, stats: { ...c.stats, actions } } : c)),
  };
}

test("a character with 2 actions carries out both, in order", () => {
  const { newState, events } = turn(
    withActions(firstGame(), 2),
    A,
    { type: "place", hex: fromOffset(0, 1) },
    { type: "move", to: fromOffset(1, 1) },
  );
  assert.deepEqual(events, [
    { type: "placed", characterId: A, position: fromOffset(0, 1) },
    { type: "moved", actor: { kind: "character", id: A }, from: fromOffset(0, 1), to: fromOffset(1, 1) },
  ]);
  assert.deepEqual(position(newState, A), fromOffset(1, 1));
});

test("an action that can't be carried out is cancelled, and the next one is still tried", () => {
  const { events } = turn(
    withActions(withAAt(3, 1), 2),
    A,
    { type: "attack", target: M0 }, // not adjacent yet
    { type: "move", to: fromOffset(4, 1) },
  );
  assert.deepEqual(events, [
    { type: "planCancelled", characterId: A, action: 0, reason: "not a neighbour" },
    { type: "moved", actor: { kind: "character", id: A }, from: fromOffset(3, 1), to: fromOffset(4, 1) },
  ]);
});

test("the second action is cancelled with its own number", () => {
  const { events } = turn(
    withActions(withAAt(3, 1), 2),
    A,
    { type: "move", to: fromOffset(4, 1) },
    { type: "move", to: fromOffset(5, 1) }, // monster 0 stands there
  );
  assert.deepEqual(events.at(-1), { type: "planCancelled", characterId: A, action: 1, reason: "hex taken" });
});

test("a character does no more actions than its actions stat", () => {
  const { events } = turn(
    withAAt(3, 1),
    A,
    { type: "move", to: fromOffset(4, 1) },
    { type: "attack", target: M0 },
  );
  assert.deepEqual(events, [
    { type: "moved", actor: { kind: "character", id: A }, from: fromOffset(3, 1), to: fromOffset(4, 1) },
  ]);
});

test("placement uses one action; without a plan for the rest the character waits", () => {
  const { events } = turn(withActions(firstGame(), 2), A);
  assert.deepEqual(events, [{ type: "placed", characterId: A, position: fromOffset(0, 0) }]);
});

test("a character that can't enter the room does nothing else that turn", () => {
  const full: GameState = withActions(
    { ...firstGame(), map: { ...FIRST_DUNGEON_MAP, startHexes: [fromOffset(0, 0)] } },
    2,
  );
  const afterB = turn(full, B).newState; // B takes the only start hex
  const { events } = turn(afterB, A, { type: "place", hex: fromOffset(0, 0) }, { type: "move", to: fromOffset(1, 0) });
  assert.deepEqual(events, [
    { type: "planCancelled", characterId: A, action: 0, reason: "hex taken" },
    { type: "notPlaced", characterId: A },
  ]);
});

test("a character stops acting once the game is won", () => {
  const base = withActions(withAAt(4, 1), 2);
  const state: GameState = {
    ...base,
    monsters: base.monsters.map((m) => (m.id === 0 ? { ...m, hp: 1 } : { ...m, hp: 0 })),
  };
  const { events } = turn(state, A, { type: "attack", target: M0 }, { type: "move", to: fromOffset(3, 1) });
  assert.deepEqual(
    events.map((e) => e.type),
    ["attacked", "died", "xpGained", "gameEnded"],
  );
});

test("a monster with 2 actions decides again for its second action", (t) => {
  t.mock.property(MONSTER_TYPES.basic, "stats", { ...MONSTER_TYPES.basic.stats, actions: 2 });
  // A stands two hexes from monster 0: it steps next to A, then attacks.
  const { events } = turn(withAAt(3, 1, true), A);
  assert.deepEqual(events, [
    { type: "moved", actor: { kind: "monster", id: 0 }, from: fromOffset(5, 1), to: fromOffset(4, 2) },
    { type: "attacked", attacker: { kind: "monster", id: 0 }, target: { kind: "character", id: A }, damage: 1 },
  ]);
});

test("a monster with 3 actions moves up to 3 hexes towards its target", (t) => {
  t.mock.property(MONSTER_TYPES.basic, "stats", { ...MONSTER_TYPES.basic.stats, actions: 3 });
  // B enters on the top start hex; monster 1 then walks towards it.
  assert.deepEqual(turn(firstGame(true), B).events, [
    { type: "placed", characterId: B, position: fromOffset(0, 0) },
    { type: "moved", actor: { kind: "monster", id: 1 }, from: fromOffset(5, 2), to: fromOffset(4, 2) },
    { type: "moved", actor: { kind: "monster", id: 1 }, from: fromOffset(4, 2), to: fromOffset(3, 1) },
    { type: "moved", actor: { kind: "monster", id: 1 }, from: fromOffset(3, 1), to: fromOffset(2, 1) },
  ]);
});

test("a rat steps next to a character and attacks it in the same turn", () => {
  // The Rat Warren: rat 0 stands at column 3, row 2, two hexes from A at column 1, row 1.
  const state = newGameState(RAT_WARREN_MAP, [{ id: A, stats: baseStats() }], createTrack([A], new Map([[0, A]])));
  const placed: GameState = {
    ...state,
    characters: state.characters.map((c) => ({ ...c, position: fromOffset(1, 1) })),
  };
  const { newState, events } = turn(placed, A);
  assert.deepEqual(events, [
    { type: "moved", actor: { kind: "monster", id: 0 }, from: fromOffset(3, 2), to: fromOffset(2, 2) },
    { type: "attacked", attacker: { kind: "monster", id: 0 }, target: { kind: "character", id: A }, damage: 1 },
  ]);
  assert.equal(newState.characters[0]!.hp, 9);
});

// --- XP ---

test("when a monster dies, every character gains its XP: alive or dead, placed or not", () => {
  const base = withAAt(4, 1);
  // B never entered the room and is dead: it still gets the XP.
  const state: GameState = {
    ...base,
    characters: base.characters.map((c) => (c.id === B ? { ...c, hp: 0 } : c)),
    monsters: base.monsters.map((m) => (m.id === 0 ? { ...m, hp: 1 } : m)),
  };
  const { newState, events } = turn(state, A, { type: "attack", target: M0 });
  assert.deepEqual(events.at(-1), {
    type: "xpGained",
    gains: [
      { characterId: A, xp: MONSTER_TYPES.basic.xp },
      { characterId: B, xp: MONSTER_TYPES.basic.xp },
    ],
  });
  assert.deepEqual(
    newState.characters.map((c) => c.xpGained),
    [10, 10],
  );
});

test("a character gains no more XP than its max level needs", () => {
  const base = withAAt(4, 1);
  // A had 447 of the 450 XP its max level needs: it can gain only 3 more.
  // B is at its max level already and gains nothing, so it isn't listed.
  const state: GameState = {
    ...base,
    characters: base.characters.map((c) => ({ ...c, maxXpGain: c.id === A ? 3 : 0 })),
    monsters: base.monsters.map((m) => (m.id === 0 ? { ...m, hp: 1 } : m)),
  };
  const { newState, events } = turn(state, A, { type: "attack", target: M0 });
  assert.deepEqual(events.at(-1), { type: "xpGained", gains: [{ characterId: A, xp: 3 }] });
  assert.equal(newState.characters.find((c) => c.id === A)!.xpGained, 3);
});

test("at its max level, no xpGained event at all", () => {
  const base = withAAt(4, 1);
  const state: GameState = {
    ...base,
    characters: base.characters.map((c) => ({ ...c, maxXpGain: 5, xpGained: 5 })),
    monsters: base.monsters.map((m) => (m.id === 0 ? { ...m, hp: 1 } : m)),
  };
  const { events } = turn(state, A, { type: "attack", target: M0 });
  assert.ok(!events.some((e) => e.type === "xpGained"));
});

test("each character gains less for a monster it killed before, by its own kill count (diminishing returns)", () => {
  const base = withAAt(4, 1);
  // A killed monster 0 three times before, B killed only monster 1 before:
  // the count of another monster doesn't matter.
  const state: GameState = {
    ...base,
    characters: base.characters.map((c) => ({ ...c, earlierKills: c.id === A ? [3] : [0, 9] })),
    monsters: base.monsters.map((m) => (m.id === 0 ? { ...m, hp: 1 } : m)),
  };
  const { newState, events } = turn(state, A, { type: "attack", target: M0 });
  // 70% of 10 is 7.
  assert.deepEqual(events.at(-1), {
    type: "xpGained",
    gains: [
      { characterId: A, xp: 7 },
      { characterId: B, xp: 10 },
    ],
  });
  assert.deepEqual(
    newState.characters.map((c) => c.xpGained),
    [7, 10],
  );
});

test("after 10 kills a monster gives a character nothing", () => {
  const base = withAAt(4, 1);
  const state: GameState = {
    ...base,
    characters: base.characters.map((c) => ({ ...c, earlierKills: c.id === A ? [10] : [9] })),
    monsters: base.monsters.map((m) => (m.id === 0 ? { ...m, hp: 1 } : m)),
  };
  const { events } = turn(state, A, { type: "attack", target: M0 });
  assert.deepEqual(events.at(-1), { type: "xpGained", gains: [{ characterId: B, xp: 1 }] });
});

// --- Winning and losing ---

test("killing the last monster wins the game", () => {
  const base = withAAt(4, 1);
  const state: GameState = {
    ...base,
    monsters: base.monsters.map((m) => (m.id === 0 ? { ...m, hp: 1 } : { ...m, hp: 0 })),
  };
  const { newState, events } = turn(state, A, { type: "attack", target: M0 });
  assert.deepEqual(
    events.slice(1).map((e) => e.type),
    ["died", "xpGained", "gameEnded"],
  );
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

// --- Doors and sleeping rooms ---

/** The hallway's door, in the wall between the front and the back room. */
const DOOR = fromOffset(1, 6);

/** The hallway with A already in the front room, at the given column and row. */
function hallwayWithAAt(col: number, row: number, assignment?: [number, CharacterId][]): GameState {
  const state = hallwayGame(assignment);
  return {
    ...state,
    characters: state.characters.map((c) => (c.id === A ? { ...c, position: fromOffset(col, row) } : c)),
  };
}

test("a new game: the door is closed and the monsters behind it are asleep", () => {
  const state = hallwayGame();
  assert.deepEqual(state.closedDoors, [DOOR]);
  assert.deepEqual(
    state.monsters.map((m) => m.asleep),
    [false, false, true, true],
  );
});

test("a closed door blocks a move", () => {
  const { newState, events } = turn(hallwayWithAAt(0, 7, [[0, B]]), A, { type: "move", to: DOOR });
  assert.deepEqual(events, [{ type: "planCancelled", characterId: A, action: 0, reason: "door closed" }]);
  assert.deepEqual(position(newState, A), fromOffset(0, 7));
});

test("opening a door wakes the monsters behind it, and then it is a normal hex", () => {
  // Only monster 0 is on the track (it follows B), so A's turn is only A's own action.
  const state = hallwayWithAAt(0, 7, [[0, B]]);
  const { newState, events } = turn(state, A, { type: "openDoor", door: DOOR });
  assert.deepEqual(events, [
    { type: "doorOpened", characterId: A, position: DOOR },
    { type: "monstersWoke", monsterIds: [2, 3] },
  ]);
  assert.deepEqual(newState.closedDoors, []);
  assert.deepEqual(
    newState.monsters.map((m) => m.asleep),
    [false, false, false, false],
  );
  assert.deepEqual(position(turn(newState, A, { type: "move", to: DOOR }).newState, A), DOOR);
});

test("a door can only be opened from next to it, and only once", () => {
  const far = turn(hallwayWithAAt(0, 9, [[0, B]]), A, { type: "openDoor", door: DOOR });
  assert.deepEqual(far.events, [{ type: "planCancelled", characterId: A, action: 0, reason: "not a neighbour" }]);
  assert.deepEqual(far.newState.closedDoors, [DOOR]);

  const opened = turn(hallwayWithAAt(0, 7, [[0, B]]), A, { type: "openDoor", door: DOOR }).newState;
  const again = turn(opened, A, { type: "openDoor", door: DOOR });
  assert.deepEqual(again.events, [{ type: "planCancelled", characterId: A, action: 0, reason: "no closed door" }]);

  // A hex that isn't a door at all.
  const notADoor = turn(hallwayWithAAt(0, 7, [[0, B]]), A, { type: "openDoor", door: fromOffset(0, 8) });
  assert.deepEqual(notADoor.events, [{ type: "planCancelled", characterId: A, action: 0, reason: "no closed door" }]);
});

test("sleeping monsters skip their turns", () => {
  // Monster 2 follows A. Awake, it would come for A, even without a way to
  // it; asleep it does nothing at all.
  const state = hallwayWithAAt(0, 7, [[2, A]]);
  const { newState, events } = turn(state, A);
  assert.deepEqual(events, []);
  assert.deepEqual(newState.monsters, state.monsters);
});

test("a monster woken by the character it follows acts in the same turn", () => {
  const state = hallwayWithAAt(0, 7, [[2, A]]);
  const { newState, events } = turn(state, A, { type: "openDoor", door: DOOR });
  assert.deepEqual(
    events.map((e) => e.type),
    ["doorOpened", "monstersWoke", "moved"],
  );
  assert.notDeepEqual(newState.monsters[2]!.position, state.monsters[2]!.position);
});

test("monsters never walk through a closed door", () => {
  // Monster 2 is awake (as if woken), but the door is still closed: no way
  // to A, so it moves towards A in a straight line, and stops at the wall.
  let state = hallwayWithAAt(0, 7, [[2, A]]);
  state = { ...state, monsters: state.monsters.map((m) => ({ ...m, asleep: false })) };
  for (let i = 0; i < 10; i++) state = turn(state, A).newState;
  assert.deepEqual(state.closedDoors, [DOOR]);
  assert.ok(toOffset(state.monsters[2]!.position).row <= 5, "monster 2 is still in the back room");
});

test("the game isn't won while monsters sleep behind a closed door", () => {
  const base = hallwayWithAAt(2, 8, [[0, B]]);
  // Monster 0 has 1 hit point left and stands next to A; monster 1 is dead.
  const state: GameState = {
    ...base,
    monsters: base.monsters.map((m) => (m.id === 0 ? { ...m, hp: 1 } : m.id === 1 ? { ...m, hp: 0 } : m)),
  };
  assert.ok(areNeighbours(fromOffset(2, 8), state.monsters[0]!.position));
  const { newState, events } = turn(state, A, { type: "attack", target: state.monsters[0]!.position });
  assert.ok(!events.some((e) => e.type === "gameEnded"));
  assert.equal(gameResult(newState), null);
  // Killing the sleeping monsters too wins it.
  const allDead: GameState = { ...newState, monsters: newState.monsters.map((m) => ({ ...m, hp: 0 })) };
  assert.equal(gameResult(allDead), "won");
});

// --- Guards and alert range ---

/** The Guard Post's guards: 0 at column 4, row 1; 2 at column 6, row 5; 5 at column 9, row 1. */
const GUARD = 0;

/**
 * The Guard Post with characters A and B, and only the given monsters alive
 * (the rest dead, so they don't get in the way), on the track as given. A
 * stands at the given column and row.
 */
function guardPostWithAAt(col: number, row: number, alive: number[], assignment: [number, CharacterId][]): GameState {
  const state = newGameState(
    GUARD_POST_MAP,
    [A, B].map((id) => ({ id, stats: baseStats() })),
    createTrack([A, B], new Map(assignment)),
  );
  return {
    ...state,
    characters: state.characters.map((c) => (c.id === A ? { ...c, position: fromOffset(col, row) } : c)),
    monsters: state.monsters.map((m) => (alive.includes(m.id) ? m : { ...m, hp: 0 })),
  };
}

test("a new game in the Guard Post: the guards are on guard, the rats awake", () => {
  const state = newGameState(GUARD_POST_MAP, [{ id: A, stats: baseStats() }], createTrack([A], new Map()));
  assert.deepEqual(
    state.monsters.map((m) => [m.type, m.asleep]),
    [
      ["guard", true],
      ["rat", false],
      ["guard", true],
      ["rat", false],
      ["rat", false],
      ["guard", true],
      ["rat", false],
      ["rat", false],
    ],
  );
});

test("a guard stays put while no character is within 3 hexes", () => {
  // A at column 0, row 1 is 4 hexes from the guard at column 4, row 1.
  const state = guardPostWithAAt(0, 1, [GUARD], [[GUARD, A]]);
  assert.equal(distance(position(state, A)!, state.monsters[GUARD]!.position), 4);
  let current = state;
  for (let i = 0; i < 5; i++) {
    const { newState, events } = turn(current, A);
    assert.deepEqual(events, []);
    current = newState;
  }
  assert.deepEqual(current.monsters, state.monsters);
});

test("a character within 3 hexes alerts the guard at the start of its turn, and it stays awake", () => {
  // A at column 1, row 1 is 3 hexes from the guard: on the guard's turn it
  // wakes up and comes for A at once.
  const state = guardPostWithAAt(1, 1, [GUARD], [[GUARD, A]]);
  assert.equal(distance(position(state, A)!, state.monsters[GUARD]!.position), 3);
  const { newState, events } = turn(state, A);
  assert.deepEqual(
    events.map((e) => e.type),
    ["monstersWoke", "moved"],
  );
  assert.deepEqual(events[0], { type: "monstersWoke", monsterIds: [GUARD] });
  assert.equal(newState.monsters[GUARD]!.asleep, false);

  // With A far out of range (as if it had walked away), the guard keeps coming.
  const far: GameState = {
    ...newState,
    characters: newState.characters.map((c) => (c.id === A ? { ...c, position: fromOffset(9, 5) } : c)),
  };
  assert.ok(distance(position(far, A)!, far.monsters[GUARD]!.position) > 3);
  const later = turn(far, A);
  assert.deepEqual(later.events.map((e) => e.type), ["moved"]);
  assert.equal(later.newState.monsters[GUARD]!.asleep, false);
});

test("the alert range is only checked on the guard's own turn", () => {
  // The guard follows B. A walks within range on its own turn: the guard
  // doesn't notice until B's turn, when it is the guard's turn.
  const state = guardPostWithAAt(0, 1, [GUARD], [[GUARD, B]]);
  const afterA = turn(state, A, { type: "move", to: fromOffset(1, 1) });
  assert.deepEqual(afterA.events.map((e) => e.type), ["moved"]);
  assert.equal(afterA.newState.monsters[GUARD]!.asleep, true);
  const afterB = turn(afterA.newState, B);
  assert.deepEqual(afterB.events.map((e) => e.type), ["placed", "monstersWoke", "moved"]);
});

test("an attack wakes a guard right away", () => {
  // A stands next to the guard, which follows B: the attack wakes it, before its own turn.
  const state = guardPostWithAAt(3, 1, [GUARD], [[GUARD, B]]);
  assert.ok(areNeighbours(position(state, A)!, state.monsters[GUARD]!.position));
  const { newState, events } = turn(state, A, { type: "attack", target: state.monsters[GUARD]!.position });
  assert.deepEqual(events, [
    { type: "attacked", attacker: { kind: "character", id: A }, target: { kind: "monster", id: GUARD }, damage: 1 },
    { type: "monstersWoke", monsterIds: [GUARD] },
  ]);
  assert.equal(newState.monsters[GUARD]!.asleep, false);
  // Attacking it again doesn't wake it again.
  const again = turn(newState, A, { type: "attack", target: newState.monsters[GUARD]!.position });
  assert.deepEqual(again.events.map((e) => e.type), ["attacked"]);
});

test("a guard behind a door ignores the door: only a character close by or an attack wakes it", () => {
  // The hallway with a guard instead of monster 2 in the back room.
  const map = {
    ...HALLWAY_MAP,
    monsters: HALLWAY_MAP.monsters.map((m, id) => (id === 2 ? { ...m, type: "guard" as const } : m)),
  };
  const base = newGameState(map, [{ id: A, stats: baseStats() }], createTrack([A], new Map()));
  const state: GameState = {
    ...base,
    characters: base.characters.map((c) => ({ ...c, position: fromOffset(0, 7) })),
  };
  const { events } = turn(state, A, { type: "openDoor", door: DOOR });
  assert.deepEqual(events, [
    { type: "doorOpened", characterId: A, position: DOOR },
    { type: "monstersWoke", monsterIds: [3] },
  ]);
});

test("a monster walks around a pillar instead of getting stuck", () => {
  // Rat 6 stands right above the pillar of column 7, rows 2 and 3, and A right
  // below it. The way round takes 3 steps: the rat's 2 actions this turn,
  // and next turn 1 step and an attack.
  const base = guardPostWithAAt(7, 4, [6], [[6, A]]);
  const state: GameState = {
    ...base,
    monsters: base.monsters.map((m) => (m.id === 6 ? { ...m, position: fromOffset(7, 1) } : m)),
  };
  const first = turn(state, A);
  assert.deepEqual(first.events.map((e) => e.type), ["moved", "moved"]);
  const second = turn(first.newState, A);
  assert.deepEqual(second.events.map((e) => e.type), ["moved", "attacked"]);
  for (const e of [...first.events, ...second.events]) {
    if (e.type === "moved") assert.ok(isOnMap(GUARD_POST_MAP, e.to), `the rat stepped on ${hexKey(e.to)}`);
  }
});

test("the Guard Post can be played to a win", () => {
  // Four characters with a few upgrades: more hit points and attack damage.
  const stats = { ...baseStats(), attackDamage: 3, hitPoints: 25 };
  const ids = [A, B, C, 4];
  const monsters = GUARD_POST_MAP.monsters.map((_, id): [number, CharacterId] => [id, ids[id % ids.length]!]);
  let state = newGameState(
    GUARD_POST_MAP,
    ids.map((id) => ({ id, stats })),
    createTrack(ids, new Map(monsters)),
  );
  const woken: number[] = [];
  for (let cycle = 0; cycle < 100 && gameResult(state) === null; cycle++) {
    for (const { characterId } of [...state.track]) {
      if (gameResult(state) !== null) break;
      if (!state.track.some((s) => s.characterId === characterId)) continue; // Died this cycle.
      const { newState, events } = turn(state, characterId, ...simplePlan(state, characterId));
      for (const e of events) if (e.type === "monstersWoke") woken.push(...e.monsterIds);
      state = newState;
      for (const m of state.monsters) {
        // A guard never moves while it is on guard.
        if (m.asleep) assert.deepEqual(m.position, GUARD_POST_MAP.monsters[m.id]!.position);
      }
    }
  }
  assert.equal(gameResult(state), "won");
  // Every guard was woken up, one by one.
  assert.deepEqual([...woken].sort(), [0, 2, 5]);
});

// --- Ranged attacks: the Archers' Gallery ---

/** The Archers' Gallery's monsters: archers 0 to 3, brutes 4 and 5, rats 6 to 8 (asleep in the side room). */
const ARCHER = 1; // At column 3, row 0.

/**
 * The Archers' Gallery with characters A and B, and only the given monsters
 * alive, on the track as given. A and B stand at the given columns and rows.
 */
function galleryWith(
  a: [number, number],
  b: [number, number] | null,
  alive: number[],
  assignment: [number, CharacterId][],
): GameState {
  const state = newGameState(
    ARCHERS_GALLERY_MAP,
    [A, B].map((id) => ({ id, stats: baseStats() })),
    createTrack([A, B], new Map(assignment)),
  );
  const at = (spot: [number, number] | null) => (spot ? fromOffset(...spot) : null);
  return {
    ...state,
    characters: state.characters.map((c) => ({ ...c, position: at(c.id === A ? a : b) })),
    monsters: state.monsters.map((m) => (alive.includes(m.id) ? m : { ...m, hp: 0 })),
  };
}

test("an archer shoots a character within 3 hexes and in sight, without moving", () => {
  // A at column 4, row 3 is 3 hexes from the archer, beside the pillar at column 3, row 2.
  const state = galleryWith([4, 3], null, [ARCHER], [[ARCHER, A]]);
  assert.equal(distance(position(state, A)!, state.monsters[ARCHER]!.position), 3);
  const { events } = turn(state, A);
  assert.deepEqual(events, [
    { type: "attacked", attacker: { kind: "monster", id: ARCHER }, target: { kind: "character", id: A }, damage: 1 },
  ]);
});

test("a character behind a pillar is out of an archer's sight: the archer moves instead", () => {
  // A at column 3, row 3 is 3 hexes from the archer, right behind the pillar at column 3, row 2.
  const state = galleryWith([3, 3], null, [ARCHER], [[ARCHER, A]]);
  assert.equal(distance(position(state, A)!, state.monsters[ARCHER]!.position), 3);
  assert.ok(!inLineOfSight(state, state.monsters[ARCHER]!.position, position(state, A)!));
  const { events } = turn(state, A);
  assert.deepEqual(events.map((e) => e.type), ["moved"]);
});

test("a character blocks an archer's line of sight to the character behind it", () => {
  // B at column 4, row 2 stands on the line from the archer to A at column
  // 5, row 2, both in range. A has fewer hit points, but the archer can't
  // see A: it shoots B.
  const base = galleryWith([5, 2], [4, 2], [ARCHER], [[ARCHER, A]]);
  const state: GameState = {
    ...base,
    characters: base.characters.map((c) => (c.id === A ? { ...c, hp: 2 } : c)),
  };
  const { events } = turn(state, A);
  assert.deepEqual(events, [
    { type: "attacked", attacker: { kind: "monster", id: ARCHER }, target: { kind: "character", id: B }, damage: 1 },
  ]);
  // With B out of the way, it shoots A.
  const alone = galleryWith([5, 2], [9, 5], [ARCHER], [[ARCHER, A]]);
  assert.deepEqual(turn(alone, A).events, [
    { type: "attacked", attacker: { kind: "monster", id: ARCHER }, target: { kind: "character", id: A }, damage: 1 },
  ]);
});

test("the Archers' Gallery can be played to a win", () => {
  // Four characters with plenty of upgrades: the brutes hit hard.
  const stats = { ...baseStats(), attackDamage: 5, hitPoints: 40 };
  const ids = [A, B, C, 4];
  const monsters = ARCHERS_GALLERY_MAP.monsters.map((_, id): [number, CharacterId] => [id, ids[id % ids.length]!]);
  let state = newGameState(
    ARCHERS_GALLERY_MAP,
    ids.map((id) => ({ id, stats })),
    createTrack(ids, new Map(monsters)),
  );
  let shots = 0;
  let doorOpened = false;
  for (let cycle = 0; cycle < 100 && gameResult(state) === null; cycle++) {
    for (const { characterId } of [...state.track]) {
      if (gameResult(state) !== null) break;
      if (!state.track.some((s) => s.characterId === characterId)) continue; // Died this cycle.
      const { newState, events } = turn(state, characterId, ...simplePlan(state, characterId));
      // Step through the events, to check each monster attack in the state it was made in.
      let during = state;
      for (const e of events) {
        if (e.type === "doorOpened") doorOpened = true;
        if (e.type === "attacked" && e.attacker.kind === "monster") {
          const from = during.monsters[e.attacker.id]!;
          const at = position(during, e.target.id)!;
          // Every monster attack is within the monster's range and in sight.
          assert.ok(distance(from.position, at) <= MONSTER_TYPES[from.type].range);
          assert.ok(inLineOfSight(during, from.position, at));
          if (distance(from.position, at) > 1) shots++;
        }
        during = applyEvent(during, e);
      }
      state = newState;
    }
  }
  assert.equal(gameResult(state), "won");
  assert.ok(doorOpened);
  assert.ok(shots > 0, "the archers got to shoot");
});

// --- Purity ---

test("resolving a turn doesn't change the state it was given", () => {
  const state = withAAt(4, 1);
  const copy = structuredClone(state);
  turn(state, A, { type: "attack", target: M0 });
  turn(state, A, { type: "move", to: fromOffset(4, 0) });
  assert.deepEqual(state, copy);
});

test("only characters on the track can take a turn", () => {
  assert.throws(() => resolveTurn(firstGame(), 99, new Map()), /initiative track/);
});

// --- Keeping a monster targeted ---

/** Resolves A's turn with the given plan, and returns A's follow-up plan. */
function followUp(state: GameState, ...plan: Plan) {
  const { newState, events } = turn(state, A, ...plan);
  return followUpPlan(newState, A, events);
}

const attack0: PlannedAction = { type: "attack", target: M0 };

test("after attacking a monster, the next plan attacks it again", () => {
  assert.deepEqual(followUp(withAAt(4, 1), attack0), [attack0]);
});

test("the follow-up plan has as many attacks as it takes to kill the monster", () => {
  // Monster 0 has 3 hit points; A hits it once and has 3 actions.
  assert.deepEqual(followUp(withActions(withAAt(4, 1), 3), attack0), [attack0, attack0]);
});

test("the follow-up plan has no more attacks than the actions stat", () => {
  const state = withActions(withAAt(4, 1), 2);
  const tough = { ...state, monsters: state.monsters.map((m) => (m.id === 0 ? { ...m, hp: 10 } : m)) };
  // 8 hit points left after this turn, but only 2 actions.
  assert.deepEqual(followUp(tough, attack0, attack0), [attack0, attack0]);
});

test("the attacks needed follow from the attack damage, rounded up", () => {
  const state = withActions(withAAt(4, 1), 3);
  const strong = {
    ...state,
    characters: state.characters.map((c) => (c.id === A ? { ...c, stats: { ...c.stats, attackDamage: 2 } } : c)),
  };
  // 3 hit points, 2 damage: one attack leaves 1, which takes one more.
  assert.deepEqual(followUp(strong, attack0), [attack0]);
});

test("no follow-up plan when the monster died", () => {
  const state = withAAt(4, 1);
  const weak = { ...state, monsters: state.monsters.map((m) => (m.id === 0 ? { ...m, hp: 1 } : m)) };
  assert.equal(followUp(weak, attack0), null);
});

test("no follow-up plan when the last action carried out wasn't an attack", () => {
  assert.equal(followUp(withActions(withAAt(4, 1), 2), attack0, { type: "move", to: fromOffset(4, 0) }), null);
  assert.equal(followUp(withAAt(3, 1), { type: "move", to: fromOffset(4, 1) }), null);
  assert.equal(followUp(withAAt(4, 1)), null);
});

test("no follow-up plan when the character opened a door after its attack", () => {
  // A stands next to both monster 0 and the door.
  const state = withActions(hallwayWithAAt(0, 7, [[1, B]]), 2);
  assert.ok(areNeighbours(fromOffset(0, 7), state.monsters[0]!.position));
  const attack: PlannedAction = { type: "attack", target: state.monsters[0]!.position };
  assert.equal(followUp(state, attack, { type: "openDoor", door: DOOR }), null);
});

test("a cancelled action after the attack doesn't count: the attack was the last one carried out", () => {
  const plan = followUp(withActions(withAAt(4, 1), 2), attack0, { type: "move", to: fromOffset(5, 2) }); // monster 1 is there
  assert.deepEqual(plan, [attack0, attack0]);
});

test("the follow-up attacks target the hex the monster stands on at the end of the turn", () => {
  // As if monster 0 had stepped back to 6,1 after A's attack.
  const { newState, events } = turn(withAAt(4, 1), A, attack0);
  const moved = { ...newState, monsters: newState.monsters.map((m) => (m.id === 0 ? { ...m, position: fromOffset(6, 1) } : m)) };
  assert.deepEqual(followUpPlan(moved, A, events), [{ type: "attack", target: fromOffset(6, 1) }]);
});

test("a cancelled attack doesn't count", () => {
  assert.equal(followUp(withAAt(3, 1), attack0), null);
});

test("a character killed by the monsters after its attack gets no follow-up plan", () => {
  const state = withAAt(4, 1, true);
  const dying = { ...state, characters: state.characters.map((c) => (c.id === A ? { ...c, hp: 1 } : c)) };
  assert.equal(followUp(dying, attack0), null);
});
