import { test } from "node:test";
import assert from "node:assert/strict";
import { abilitiesOf, abilityStats, planAbilityProblem } from "./abilities.ts";
import { baseStats } from "./classes.ts";
import type { DungeonMap } from "./dungeon-map.ts";
import { applyEvents, type GameEvent } from "./events.ts";
import { isFree, type CharacterId, type GameState, type MonsterId } from "./game-state.ts";
import { fromOffset, hex, hexKey, rectangle, type Hex } from "./hex.ts";
import { inLineOfSight } from "./line-of-sight.ts";
import { decideMonsterAction } from "./monsters.ts";
import type { MonsterTypeId } from "./stats.ts";
import { followUpPlan, newGameState, resolveTurn, type Plan, type PlannedAction } from "./turn.ts";
import { abilityUpgradeCost, nextAbilityUpgradeCost, type Upgrade } from "./upgrades.ts";

const C = 1;
const A = 2;

const CENTRE = fromOffset(6, 6);
const up = (steps: number): Hex => hex(CENTRE.q, CENTRE.r - steps);
const down = (steps: number): Hex => hex(CENTRE.q, CENTRE.r + steps);
const downRight = (steps: number): Hex => hex(CENTRE.q + steps, CENTRE.r);

/** A pillar 2 hexes down-right of the caster. */
const PILLAR = downRight(2);

const wall = (towards: Hex): PlannedAction => ({ type: "createWall", target: towards });

/** A guard far away, on guard all the time, so a game without other monsters isn't won. */
const FAR_GUARD: [MonsterTypeId, Hex] = ["guard", fromOffset(12, 0)];

/**
 * A rank 4 caster in the middle of a 13 by 13 room, with `monsters` and a
 * guard far away. The monsters follow the caster on the track when
 * `acting`, otherwise they never act. A stands where `aAt` says, or off the
 * map.
 */
function game({
  monsters = [],
  acting = false,
  rank = 4,
  actions = 1,
  aAt = null,
}: {
  monsters?: [MonsterTypeId, Hex][];
  acting?: boolean;
  rank?: number;
  actions?: number;
  aAt?: Hex | null;
} = {}): GameState {
  const map: DungeonMap = {
    hexes: rectangle(13, 13).filter((h) => hexKey(h) !== hexKey(PILLAR)),
    startHexes: [fromOffset(12, 12)],
    doors: [],
    monsters: [...monsters, FAR_GUARD].map(([type, position]) => ({ type, position })),
  };
  const state = newGameState(
    map,
    [
      { id: C, stats: { ...baseStats("caster"), actions }, abilities: abilitiesOf("caster", rank), classId: "caster" },
      { id: A, stats: baseStats("adventurer") },
    ],
    [
      { characterId: C, monsterIds: acting ? monsters.map((_, id) => id) : [] },
      { characterId: A, monsterIds: [] },
    ],
  );
  const at = new Map<CharacterId, Hex | null>([
    [C, CENTRE],
    [A, aAt],
  ]);
  return { ...state, characters: state.characters.map((c) => ({ ...c, position: at.get(c.id) ?? null })) };
}

function turn(state: GameState, characterId: CharacterId, ...plan: Plan) {
  const plans = new Map<CharacterId, Plan>(plan.length > 0 ? [[characterId, plan]] : []);
  const result = resolveTurn(state, characterId, plans);
  assert.deepEqual(applyEvents(state, result.events), result.newState, "replaying the events");
  return result;
}

const created = (events: GameEvent[]) => events.find((e) => e.type === "wallCreated");

// --- Putting it up ---

test("a rank 4 caster has create wall, with a cooldown of 5, down to 2", () => {
  assert.ok(!abilitiesOf("caster", 3).includes("createWall"));
  assert.ok(abilitiesOf("caster", 4).includes("createWall"));
  assert.deepEqual([1, 2, 3].map((n) => abilityUpgradeCost("createWall", "cooldown", n)), [10, 40, 90]);
  const three: Upgrade[] = [1, 2, 3].map(() => ({ ability: "createWall", upgrade: "cooldown", paid: 1 }));
  assert.equal(nextAbilityUpgradeCost(three, "createWall", "cooldown"), undefined);
  assert.deepEqual(
    abilityStats("createWall", baseStats("caster"), { createWall: { cooldown: 3 } }).map((r) => r.value),
    ["3 hexes, with a gap where someone stands", "3 of the character's turns", "2 turns"],
  );
});

test("a wall goes up on the 3 hexes in a line, starting next to the caster", () => {
  const { newState, events } = turn(game(), C, wall(up(1)));
  assert.deepEqual(events, [
    { type: "wallCreated", characterId: C, hexes: [up(1), up(2), up(3)], turns: 3 },
    { type: "cooldownStarted", characterId: C, ability: "createWall", turns: 5 },
  ]);
  assert.deepEqual(newState.createdWalls, [{ characterId: C, hexes: [up(1), up(2), up(3)], turnsLeft: 3 }]);
  assert.equal(followUpPlan(newState, C, events), null);
});

test("someone standing on a hex leaves a gap, and a real wall ends it", () => {
  const gaps = turn(game({ monsters: [["basic", up(2)]], aAt: up(3) }), C, wall(up(1)));
  assert.deepEqual(created(gaps.events), { type: "wallCreated", characterId: C, hexes: [up(1)], turns: 3 });
  const pillar = turn(game(), C, wall(downRight(1)));
  assert.deepEqual(created(pillar.events), { type: "wallCreated", characterId: C, hexes: [downRight(1)], turns: 3 });
});

test("it is cancelled, without the cooldown, when none of the hexes is free", () => {
  const state = game({ monsters: [["basic", up(1)], ["basic", up(2)], ["basic", up(3)]] });
  const { newState, events } = turn(state, C, wall(up(1)));
  assert.deepEqual(events, [{ type: "planCancelled", characterId: C, action: 0, reason: "no free hex" }]);
  assert.deepEqual(newState.characters[0]!.cooldowns, {});
  assert.equal(newState.createdWalls, undefined);
});

// --- What it does ---

test("a created wall blocks movement, leaps, teleports and line of sight", () => {
  const state = turn(game({ aAt: up(4) }), C, wall(up(1))).newState;
  assert.equal(isFree(state, up(2)), false);
  const move = turn(state, C, { type: "move", to: up(1) });
  assert.deepEqual(move.events.at(-1), { type: "planCancelled", characterId: C, action: 0, reason: "created wall" });
  const withLeap = {
    ...state,
    characters: state.characters.map((c) => (c.id === C ? { ...c, abilities: [...c.abilities, "leap" as const] } : c)),
  };
  assert.deepEqual(turn(withLeap, C, { type: "leap", target: up(2) }).events.at(-1), {
    type: "planCancelled",
    characterId: C,
    action: 0,
    reason: "created wall",
  });
  assert.deepEqual(turn(state, C, { type: "teleport", target: up(3) }).events.at(-1), {
    type: "planCancelled",
    characterId: C,
    action: 0,
    reason: "created wall",
  });
  // The line from the caster to A, 4 hexes up, runs through the wall.
  assert.equal(inLineOfSight(state, CENTRE, up(4)), false);
  assert.equal(inLineOfSight(game({ aAt: up(4) }), CENTRE, up(4)), true);
});

test("frost wave stops at a created wall, and a fireball can't be thrown through one", () => {
  const base = game({ monsters: [["brute", up(3)]], rank: 5 });
  const state: GameState = { ...base, createdWalls: [{ characterId: A, hexes: [up(2)], turnsLeft: 3 }] };
  const waveHits = turn(state, C, { type: "frostWave", target: up(1) }).events;
  assert.deepEqual(waveHits[0], { type: "planCancelled", characterId: C, action: 0, reason: "no monster in area" });
  const fireball = turn(state, C, { type: "fireball", target: up(3) }).events;
  assert.deepEqual(fireball[0], { type: "planCancelled", characterId: C, action: 0, reason: "out of sight" });
});

test("monsters walk around a created wall, and archers can't shoot through it", () => {
  // A brute 3 hexes above the caster, with a wall right in between: it steps around it.
  const base = game({ monsters: [["brute", up(3)], ["archer", down(3)]] });
  const state: GameState = {
    ...base,
    createdWalls: [{ characterId: C, hexes: [up(2), down(2)], turnsLeft: 3 }],
  };
  const step = decideMonsterAction(state, 0 as MonsterId);
  assert.equal(step.type, "move");
  assert.ok(step.type === "move" && hexKey(step.to) !== hexKey(up(2)));
  // The archer 3 hexes below would shoot the caster, but the wall is in the way: it moves instead.
  assert.equal(decideMonsterAction(base, 1).type, "attack");
  assert.equal(decideMonsterAction(state, 1).type, "move");
});

test("a monster that can't reach anyone because of a wall uses the rule for that", () => {
  // A brute in a corner, walled in: no path to the caster, so it gets closer in a straight line if it can.
  const corner = fromOffset(0, 0);
  const base = game({ monsters: [["brute", corner]] });
  const around = rectangle(13, 13).filter((h) => {
    const dq = h.q - corner.q;
    const dr = h.r - corner.r;
    return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2 === 2;
  });
  const state: GameState = { ...base, createdWalls: [{ characterId: C, hexes: around, turnsLeft: 3 }] };
  const action = decideMonsterAction(state, 0);
  // It can still step to a free hex next to it that is closer in a straight line.
  assert.equal(action.type, "move");
});

// --- How long it stands ---

test("the wall goes at the start of the caster's third own turn after it was created", () => {
  let state = turn(game(), C, wall(up(1))).newState;
  const left: (number | undefined)[] = [];
  const types: string[] = [];
  for (let i = 0; i < 3; i++) {
    const { newState, events } = turn(state, C);
    types.push(...events.filter((e) => e.type.startsWith("wall")).map((e) => e.type));
    state = newState;
    left.push(state.createdWalls?.[0]?.turnsLeft);
  }
  assert.deepEqual(types, ["wallCountedDown", "wallCountedDown", "wallRemoved"]);
  assert.deepEqual(left, [2, 1, undefined]);
  assert.equal(state.createdWalls, undefined);
  assert.equal(isFree(state, up(1)), true);
});

test("the caster's turns count also while it is off the map; a dead caster's wall goes with it", () => {
  const withWall = turn(game(), C, wall(up(1))).newState;
  const offMap: GameState = {
    ...withWall,
    map: { ...withWall.map, startHexes: [up(1)] }, // the only start hex is under the wall
    characters: withWall.characters.map((c) => (c.id === C ? { ...c, position: null } : c)),
  };
  const counted = turn(offMap, C);
  assert.ok(counted.events.some((e) => e.type === "wallCountedDown"));
  // A brute next to the caster kills it: the wall goes too.
  const base = game({ monsters: [["brute", down(1)]], acting: true });
  const fragile: GameState = {
    ...base,
    characters: base.characters.map((c) => (c.id === C ? { ...c, hp: 1 } : c)),
  };
  const { newState, events } = turn(fragile, C, wall(up(1)));
  const died = events.findIndex((e) => e.type === "died" && e.who.kind === "character");
  assert.deepEqual(events[died + 1], { type: "wallRemoved", characterId: C });
  assert.equal(newState.createdWalls, undefined);
});

// --- The server's checks ---

test("the server checks the rank, the cooldown, one per plan and a hex next to the caster", () => {
  const state = game({ actions: 2 });
  assert.equal(planAbilityProblem(state, C, [wall(up(1))]), undefined);
  assert.equal(planAbilityProblem(state, C, [wall(up(2))]), "Create wall can't be planned: the hex isn't next to the character.");
  assert.equal(planAbilityProblem(state, C, [wall(up(1)), wall(down(1))]), "Create wall can't be planned: already planned.");
  assert.equal(planAbilityProblem(game({ rank: 3 }), C, [wall(up(1))]), "Create wall can't be planned: needs a higher rank.");
  const after = turn(state, C, wall(up(1))).newState;
  assert.equal(planAbilityProblem(after, C, [wall(down(1))]), "Create wall can't be planned: ready in 6 turns.");
});
