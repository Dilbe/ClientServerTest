import { test } from "node:test";
import assert from "node:assert/strict";
import { abilitiesOf, abilityCooldown, abilityStats, planAbilityProblem, type AbilityUpgradeCounts } from "./abilities.ts";
import { baseStats } from "./classes.ts";
import type { DungeonMap } from "./dungeon-map.ts";
import { applyEvents, type GameEvent } from "./events.ts";
import type { CharacterId, GameState } from "./game-state.ts";
import { fromOffset, hex, hexKey, rectangle, type Hex } from "./hex.ts";
import { piercingShotHexes, piercingShotLength } from "./piercing-shot.ts";
import { previewCycle } from "./preview.ts";
import { followUpPlan, newGameState, resolveTurn, type Plan, type PlannedAction } from "./turn.ts";
import { abilityUpgradeCost, nextAbilityUpgradeCost, type Upgrade } from "./upgrades.ts";

const R = 1;
const A = 2;

/** Where the ranger stands: low in a 13 by 13 room, with room for a long shot up. */
const START = fromOffset(6, 10);
const up = (steps: number): Hex => hex(START.q, START.r - steps);
const down = (steps: number): Hex => hex(START.q, START.r + steps);
const downRight = (steps: number): Hex => hex(START.q + steps, START.r);

const pierce = (target: Hex): PlannedAction => ({ type: "piercingShot", target });

/**
 * A ranger of `rank` low in the middle of the room, basic monsters with 3
 * hit points on the given hexes, and pillars on `pillars`; A, an
 * adventurer, at `aAt` (off the map without it). The monsters never act.
 */
function game({
  monsters,
  pillars = [],
  rank = 3,
  attackDamage = 1,
  abilityUpgrades = {},
  aAt = null,
}: {
  monsters: Hex[];
  pillars?: Hex[];
  rank?: number;
  attackDamage?: number;
  abilityUpgrades?: AbilityUpgradeCounts;
  aAt?: Hex | null;
}): GameState {
  const blocked = new Set(pillars.map(hexKey));
  const map: DungeonMap = {
    hexes: rectangle(13, 13).filter((h) => !blocked.has(hexKey(h))),
    startHexes: [fromOffset(12, 12)],
    doors: [],
    monsters: monsters.map((position) => ({ type: "basic", position })),
  };
  const state = newGameState(
    map,
    [
      {
        id: R,
        stats: { ...baseStats("ranger"), attackDamage },
        abilities: abilitiesOf("ranger", rank),
        abilityUpgrades,
        classId: "ranger",
      },
      { id: A, stats: baseStats("adventurer"), classId: "adventurer" },
    ],
    [
      { characterId: R, monsterIds: [] },
      { characterId: A, monsterIds: [] },
    ],
  );
  const at = new Map<CharacterId, Hex | null>([
    [R, START],
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

const ranger = (state: GameState) => state.characters.find((c) => c.id === R)!;
const hp = (state: GameState) => state.monsters.map((m) => m.hp);
const cancelled = (events: readonly GameEvent[]) => events.flatMap((e) => (e.type === "planCancelled" ? [e.reason] : []));

test("a rank 3 ranger has piercing shot: 1 action, cooldown 4", () => {
  assert.ok(!abilitiesOf("ranger", 2).includes("piercingShot"));
  assert.deepEqual(abilitiesOf("ranger", 3), ["pinningShot", "piercingShot"]);
  assert.equal(abilityCooldown("piercingShot", {}), 4);
});

test("it covers the hexes 2 to 6 hexes away in the hex's direction; the hex next to the ranger isn't hit", () => {
  const state = game({ monsters: [] });
  const line = [up(2), up(3), up(4), up(5), up(6)];
  // Any hex on the line picks the same direction.
  assert.deepEqual(piercingShotHexes(state, START, up(2), 6), line);
  assert.deepEqual(piercingShotHexes(state, START, up(6), 6), line);
  // Not in a straight line, or too close or too far: nothing.
  assert.deepEqual(piercingShotHexes(state, START, hex(START.q + 1, START.r - 3), 6), []);
  assert.deepEqual(piercingShotHexes(state, START, up(1), 6), []);
  assert.deepEqual(piercingShotHexes(state, START, up(7), 6), []);
});

test("every monster on those hexes takes the attack damage at the same time; kills give XP; monsters don't stop it", () => {
  const state = game({ monsters: [up(1), up(2), up(4), up(6), up(7)], attackDamage: 3 });
  const { newState, events } = turn(state, R, pierce(up(3)));
  const hits = events.filter((e) => e.type === "attacked").map((e) => (e.type === "attacked" ? e.target.id : -1));
  assert.deepEqual(hits, [1, 2, 3]);
  // Not the one next to the ranger, nor the one 7 hexes away.
  assert.deepEqual(hp(newState), [3, 0, 0, 0, 3]);
  assert.equal(events.filter((e) => e.type === "died").length, 3);
  assert.ok(events.some((e) => e.type === "xpGained"));
  // No follow-up plan: there is no single monster to keep targeting.
  const hurt = turn(game({ monsters: [up(3)] }), R, pierce(up(3)));
  assert.equal(followUpPlan(hurt.newState, R, hurt.events), null);
});

test("characters on the line take no damage", () => {
  const { newState } = turn(game({ monsters: [up(4)], aAt: up(2) }), R, pierce(up(4)));
  assert.equal(newState.characters[1]!.hp, 10);
  assert.deepEqual(hp(newState), [2]);
});

test("a wall or pillar stops it, also one next to the ranger", () => {
  const behind = turn(game({ monsters: [up(2), up(5)], pillars: [up(3)] }), R, pierce(up(2)));
  assert.deepEqual(hp(behind.newState), [2, 3]);
  const blocked = turn(game({ monsters: [up(2)], pillars: [up(1)] }), R, pierce(up(2)));
  assert.deepEqual(cancelled(blocked.events), ["no monster in area"]);
  // Down: the room ends 2 hexes below the ranger.
  assert.deepEqual(piercingShotHexes(game({ monsters: [] }), START, down(2), 6), [down(2)]);
});

test("a created wall stops it too", () => {
  const state = game({ monsters: [up(4)] });
  const walled: GameState = { ...state, createdWalls: [{ characterId: A, hexes: [up(3)], turnsLeft: 2 }] };
  assert.deepEqual(cancelled(turn(walled, R, pierce(up(4))).events), ["no monster in area"]);
});

test("cancelled without a monster on those hexes, without starting the cooldown", () => {
  const { newState, events } = turn(game({ monsters: [up(1), downRight(3)] }), R, pierce(up(3)));
  assert.deepEqual(cancelled(events), ["no monster in area"]);
  assert.deepEqual(ranger(newState).cooldowns, {});
  // A hex off the line is cancelled too, as the server never accepts one.
  assert.deepEqual(cancelled(turn(game({ monsters: [up(3)] }), R, pierce(hex(START.q + 1, START.r - 3))).events), ["not in line"]);
});

test("the preview shows which monsters it hits", () => {
  const state = game({ monsters: [up(3), up(5)] });
  const preview = previewCycle(state, [R, A], new Map([[R, [pierce(up(2))]]]));
  assert.deepEqual(
    preview.areaHits.get(R)?.piercingShot?.map((hit) => hit.monsterId),
    [0, 1],
  );
});

test("the server checks the rank, the cooldown, at most one per plan and a hex in a straight line within the length", () => {
  const state = { ...game({ monsters: [up(3)] }), characters: game({ monsters: [up(3)] }).characters.map((c) => (c.id === R ? { ...c, stats: { ...c.stats, actions: 2 } } : c)) };
  assert.equal(planAbilityProblem(state, R, [pierce(up(6))]), undefined);
  // Empty now is fine: monsters may walk onto the line before the turn fires.
  assert.equal(planAbilityProblem(state, R, [pierce(downRight(2))]), undefined);
  const notInLine = "Piercing shot can't be planned: the hex isn't in a straight line 2 to 6 hexes away.";
  assert.equal(planAbilityProblem(state, R, [pierce(up(1))]), notInLine);
  assert.equal(planAbilityProblem(state, R, [pierce(up(7))]), notInLine);
  assert.equal(planAbilityProblem(state, R, [pierce(hex(START.q + 1, START.r - 3))]), notInLine);
  assert.equal(planAbilityProblem(state, R, [pierce(up(3)), pierce(up(3))]), "Piercing shot can't be planned: already planned.");
  assert.equal(
    planAbilityProblem(game({ monsters: [], rank: 2 }), R, [pierce(up(3))]),
    "Piercing shot can't be planned: needs a higher rank.",
  );
  const after = turn(game({ monsters: [up(3)] }), R, pierce(up(3))).newState;
  assert.equal(planAbilityProblem(after, R, [pierce(up(3))]), "Piercing shot can't be planned: ready in 5 turns.");
});

test("its upgrades: the cooldown, and +1 length up to 8 hexes away for 5 and 15", () => {
  assert.deepEqual([1, 2, 3].map((n) => abilityUpgradeCost("piercingShot", "cooldown", n)), [10, 40, 90]);
  assert.deepEqual([1, 2].map((n) => abilityUpgradeCost("piercingShot", "length", n)), [5, 15]);
  const two: Upgrade[] = [
    { ability: "piercingShot", upgrade: "length", paid: 5 },
    { ability: "piercingShot", upgrade: "length", paid: 15 },
  ];
  assert.equal(nextAbilityUpgradeCost(two, "piercingShot", "length"), undefined);
  assert.equal(piercingShotLength({ piercingShot: { length: 2 } }), 8);
  // Never more than the limit counts.
  assert.equal(piercingShotLength({ piercingShot: { length: 5 } }), 8);
  const longer = game({ monsters: [up(8)], abilityUpgrades: { piercingShot: { length: 2 } } });
  assert.deepEqual(hp(turn(longer, R, pierce(up(8))).newState), [2]);
  assert.equal(planAbilityProblem(longer, R, [pierce(up(8))]), undefined);
  assert.deepEqual(abilityStats("piercingShot", baseStats("ranger"), { piercingShot: { length: 1 } })[1], {
    name: "Length",
    value: "2 to 7 hexes away",
    upgrade: "length",
  });
});
