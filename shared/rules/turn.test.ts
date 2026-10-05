import { test } from "node:test";
import assert from "node:assert/strict";
import { FIRST_DUNGEON_MAP, HALLWAY_MAP, isOnMap, isStartHex } from "./dungeon-map.ts";
import { applyEvents } from "./events.ts";
import { isFree, type CharacterId, type GameState } from "./game-state.ts";
import { areNeighbours, fromOffset, hexKey, neighbours, stepsFrom, type Hex } from "./hex.ts";
import { baseStats, MONSTER_TYPES } from "./stats.ts";
import { createTrack } from "./track.ts";
import { followUpPlan, gameResult, newGameState, resolveTurn, type Plan, type PlannedAction } from "./turn.ts";

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

/** The hallway with characters A, B and C; monster 0 follows A, monster 1 follows B. */
function hallwayGame(): GameState {
  return newGameState(
    HALLWAY_MAP,
    [A, B, C].map((id) => ({ id, stats: baseStats() })),
    createTrack([A, B, C], new Map([[0, A], [1, B]])),
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
  const afterMove = turn(newState, A, { type: "move", to: fromOffset(2, 7) }).newState;
  assert.deepEqual(position(turn(afterMove, C).newState, C), fromOffset(2, 8));
});

/**
 * A simple player for the test below: attack an adjacent monster, otherwise
 * take a step along the shortest way to the nearest monster. Before entering
 * the room it plans nothing, so it is placed automatically.
 */
function simplePlan(state: GameState, characterId: CharacterId): Plan {
  const at = position(state, characterId);
  if (at === null) return [];
  const alive = state.monsters.filter((m) => m.hp > 0);
  const adjacent = alive.find((m) => areNeighbours(at, m.position));
  if (adjacent) return [{ type: "attack", monsterId: adjacent.id }];

  const canEnter = (h: Hex) => isOnMap(state.map, h) && isFree(state, h);
  const fromMonsters = alive.map((m) => stepsFrom(m.position, canEnter));
  const stepsLeft = (h: Hex) =>
    Math.min(...fromMonsters.map((steps) => steps.get(hexKey(h)) ?? Infinity));
  const options = neighbours(at).filter(canEnter);
  if (options.length === 0) return [];
  const best = options.reduce((a, b) => (stepsLeft(b) < stepsLeft(a) ? b : a));
  return [{ type: "move", to: best }];
}

test("the hallway can be played to the end, and no monster ever stands on a start hex", () => {
  let state = hallwayGame();
  for (let cycle = 0; cycle < 50 && gameResult(state) === null; cycle++) {
    for (const { characterId } of [...state.track]) {
      if (gameResult(state) !== null) break;
      if (!state.track.some((s) => s.characterId === characterId)) continue; // Died this cycle.
      state = turn(state, characterId, ...simplePlan(state, characterId)).newState;
      for (const m of state.monsters) assert.ok(!isStartHex(state.map, m.position), `monster ${m.id} on a start hex`);
    }
  }
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
  const { newState, events } = turn(state, A, { type: "attack", monsterId: 0 });
  assert.deepEqual(events, [
    { type: "attacked", attacker: { kind: "character", id: A }, target: { kind: "monster", id: 0 }, damage: 1 },
  ]);
    assert.equal(newState.monsters[0]!.hp, state.monsters[0]!.hp - 1);
});

test("an attack on a monster that isn't adjacent is cancelled", () => {
  const state = withAAt(3, 1);
  const { newState, events } = turn(state, A, { type: "attack", monsterId: 0 });
  assert.deepEqual(events, [{ type: "planCancelled", characterId: A, action: 0, reason: "target gone" }]);
  assert.equal(newState.monsters[0]!.hp, state.monsters[0]!.hp);
});

test("a monster at 0 hit points dies and leaves the track; its hex is free again", () => {
  const base = withAAt(4, 1, true);
  const state: GameState = { ...base, monsters: base.monsters.map((m) => (m.id === 0 ? { ...m, hp: 1 } : m)) };
  const { newState, events } = turn(state, A, { type: "attack", monsterId: 0 });
  assert.deepEqual(events.slice(1), [
    { type: "died", who: { kind: "monster", id: 0 } },
    {
      type: "xpGained",
      gains: [
        { characterId: A, xp: 5 },
        { characterId: B, xp: 5 },
      ],
    },
  ]);
  assert.deepEqual(newState.track, [
    { characterId: A, monsterIds: [] },
    { characterId: B, monsterIds: [1] },
  ]);
  assert.equal(gameResult(newState), null);

  // A dead monster can't be attacked, and doesn't block its hex.
  assert.deepEqual(turn(newState, A, { type: "attack", monsterId: 0 }).events, [
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
    { type: "attack", monsterId: 0 }, // not adjacent yet
    { type: "move", to: fromOffset(4, 1) },
  );
  assert.deepEqual(events, [
    { type: "planCancelled", characterId: A, action: 0, reason: "target gone" },
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
    { type: "attack", monsterId: 0 },
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
  const { events } = turn(state, A, { type: "attack", monsterId: 0 }, { type: "move", to: fromOffset(3, 1) });
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

// --- XP ---

test("when a monster dies, every character gains its XP: alive or dead, placed or not", () => {
  const base = withAAt(4, 1);
  // B never entered the room and is dead: it still gets the XP.
  const state: GameState = {
    ...base,
    characters: base.characters.map((c) => (c.id === B ? { ...c, hp: 0 } : c)),
    monsters: base.monsters.map((m) => (m.id === 0 ? { ...m, hp: 1 } : m)),
  };
  const { newState, events } = turn(state, A, { type: "attack", monsterId: 0 });
  assert.deepEqual(events.at(-1), {
    type: "xpGained",
    gains: [
      { characterId: A, xp: MONSTER_TYPES.basic.xp },
      { characterId: B, xp: MONSTER_TYPES.basic.xp },
    ],
  });
  assert.deepEqual(
    newState.characters.map((c) => c.xpGained),
    [5, 5],
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
  const { newState, events } = turn(state, A, { type: "attack", monsterId: 0 });
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
  const { events } = turn(state, A, { type: "attack", monsterId: 0 });
  assert.ok(!events.some((e) => e.type === "xpGained"));
});

// --- Winning and losing ---

test("killing the last monster wins the game", () => {
  const base = withAAt(4, 1);
  const state: GameState = {
    ...base,
    monsters: base.monsters.map((m) => (m.id === 0 ? { ...m, hp: 1 } : { ...m, hp: 0 })),
  };
  const { newState, events } = turn(state, A, { type: "attack", monsterId: 0 });
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

// --- Keeping a monster targeted ---

/** Resolves A's turn with the given plan, and returns A's follow-up plan. */
function followUp(state: GameState, ...plan: Plan) {
  const { newState, events } = turn(state, A, ...plan);
  return followUpPlan(newState, A, events);
}

const attack0: PlannedAction = { type: "attack", monsterId: 0 };

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

test("a cancelled action after the attack doesn't count: the attack was the last one carried out", () => {
  const plan = followUp(withActions(withAAt(4, 1), 2), attack0, { type: "move", to: fromOffset(5, 2) }); // monster 1 is there
  assert.deepEqual(plan, [attack0, attack0]);
});

test("a cancelled attack doesn't count", () => {
  assert.equal(followUp(withAAt(3, 1), attack0), null);
});

test("a character killed by the monsters after its attack gets no follow-up plan", () => {
  const state = withAAt(4, 1, true);
  const dying = { ...state, characters: state.characters.map((c) => (c.id === A ? { ...c, hp: 1 } : c)) };
  assert.equal(followUp(dying, attack0), null);
});
