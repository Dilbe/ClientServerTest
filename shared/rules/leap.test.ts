import { test } from "node:test";
import assert from "node:assert/strict";
import { abilitiesOf, abilityStats, planAbilityProblem, type AbilityUpgradeCounts } from "./abilities.ts";
import { baseStats } from "./classes.ts";
import type { DungeonMap } from "./dungeon-map.ts";
import { applyEvents } from "./events.ts";
import type { CharacterId, GameState } from "./game-state.ts";
import { fromOffset, hex, hexKey, rectangle, type Hex } from "./hex.ts";
import { leapMaxDistance } from "./leap.ts";
import { positionAfter } from "./planning.ts";
import { previewCycle } from "./preview.ts";
import { followUpPlan, newGameState, resolveTurn, type Plan, type PlannedAction } from "./turn.ts";
import { abilityUpgradeCost, nextAbilityUpgradeCost, type Upgrade } from "./upgrades.ts";

const T = 1;
const A = 2;

/** Where the tank stands: the middle of a 13 by 13 room. */
const CENTRE = fromOffset(6, 6);
/** `steps` hexes from the tank in a straight line, straight up, down or down-right. */
const up = (steps: number): Hex => hex(CENTRE.q, CENTRE.r - steps);
const down = (steps: number): Hex => hex(CENTRE.q, CENTRE.r + steps);
const downRight = (steps: number): Hex => hex(CENTRE.q + steps, CENTRE.r);

/**
 * One room of 13 by 13 hexes with a pillar 2 hexes below the tank. A monster
 * stands right above the tank (monster 0), and one 4 hexes down-right (monster 1).
 */
const PILLAR = down(2);
const MAP: DungeonMap = {
  hexes: rectangle(13, 13).filter((h) => hexKey(h) !== hexKey(PILLAR)),
  startHexes: [fromOffset(12, 12)],
  doors: [],
  monsters: [
    { type: "basic", position: up(1) },
    { type: "basic", position: downRight(4) },
  ],
};

const leap = (target: Hex): PlannedAction => ({ type: "leap", target });

/** A rank 5 tank in the middle of the room, A off the map unless placed; the monsters never act. */
function game({
  actions = 1,
  abilityUpgrades = {},
  aAt = null,
}: {
  actions?: number;
  abilityUpgrades?: AbilityUpgradeCounts;
  aAt?: Hex | null;
} = {}): GameState {
  const state = newGameState(
    MAP,
    [
      { id: T, stats: { ...baseStats("tank"), actions }, abilities: abilitiesOf("tank", 5), abilityUpgrades },
      { id: A, stats: baseStats("adventurer") },
    ],
    [
      { characterId: T, monsterIds: [] },
      { characterId: A, monsterIds: [] },
    ],
  );
  const at = new Map<CharacterId, Hex | null>([
    [T, CENTRE],
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

const tankAt = (state: GameState) => state.characters.find((c) => c.id === T)!.position;

// --- Who has it ---

test("a tank gets leap at rank 5", () => {
  assert.ok(!abilitiesOf("tank", 4).includes("leap"));
  assert.deepEqual(abilitiesOf("tank", 5), ["block", "taunt", "regen", "protect", "leap"]);
  assert.deepEqual(abilityStats("leap", baseStats("tank")), [
    { name: "Range", value: "1 to 4 hexes, in line of sight", upgrade: "range" },
    { name: "Cooldown", value: "4 turns", upgrade: "cooldown" },
  ]);
});

// --- What it does ---

test("a leap jumps to a free hex up to 4 hexes away, does no damage and starts the cooldown", () => {
  const { newState, events } = turn(game(), T, leap(downRight(3)));
  assert.deepEqual(events, [
    { type: "moved", actor: { kind: "character", id: T }, from: CENTRE, to: downRight(3), ability: "leap" },
    { type: "cooldownStarted", characterId: T, ability: "leap", turns: 4 },
  ]);
  assert.deepEqual(tankAt(newState), downRight(3));
  assert.deepEqual(
    newState.monsters.map((m) => m.hp),
    game().monsters.map((m) => m.hp),
  );
});

test("the tank jumps past monsters: they don't block the line of sight", () => {
  // Monster 0 stands right above the tank.
  const { events } = turn(game(), T, leap(up(3)));
  assert.equal(events[0]!.type, "moved");
});

// --- Range ---

test("the server checks the distance when the plan comes in", () => {
  const state = game();
  assert.equal(planAbilityProblem(state, T, [leap(up(4))]), undefined);
  assert.equal(planAbilityProblem(state, T, [leap(up(5))]), "Leap can't be planned: the hex isn't 1 to 4 hexes away.");
  assert.equal(planAbilityProblem(state, T, [leap(CENTRE)]), "Leap can't be planned: the hex isn't 1 to 4 hexes away.");
  // Taken or out of sight now: that may change before the turn fires.
  assert.equal(planAbilityProblem(state, T, [leap(downRight(4))]), undefined);
  assert.equal(planAbilityProblem(state, T, [leap(down(3))]), undefined);
  // Seen from where the plan leaves the tank.
  assert.equal(planAbilityProblem(game({ actions: 2 }), T, [{ type: "move", to: up(1) }, leap(up(5))]), undefined);
});

test("the range upgrade adds 1 hex, up to 6; it costs like charge range", () => {
  assert.equal(leapMaxDistance({}), 4);
  assert.equal(leapMaxDistance({ leap: { range: 2 } }), 6);
  const upgraded = game({ abilityUpgrades: { leap: { range: 2 } } });
  assert.equal(planAbilityProblem(upgraded, T, [leap(up(6))]), undefined);
  assert.equal(planAbilityProblem(upgraded, T, [leap(up(7))]), "Leap can't be planned: the hex isn't 1 to 6 hexes away.");
  assert.deepEqual(turn(upgraded, T, leap(up(6))).newState.characters[0]!.position, up(6));

  assert.deepEqual([1, 2].map((n) => abilityUpgradeCost("leap", "range", n)), [5, 15]);
  const maxed: Upgrade[] = [
    { ability: "leap", upgrade: "range", paid: 5 },
    { ability: "leap", upgrade: "range", paid: 15 },
  ];
  assert.equal(nextAbilityUpgradeCost(maxed, "leap", "range"), undefined);
  assert.deepEqual([1, 2, 3].map((n) => abilityUpgradeCost("leap", "cooldown", n)), [10, 40, 90]);
});

// --- Cancelling ---

test("a leap is all or nothing: cancelled without a cooldown when it can't land", () => {
  const cases: [Hex, string, GameState?][] = [
    [downRight(4), "hex taken"], // monster 1 stands there
    [down(3), "out of sight"], // behind the pillar
    [PILLAR, "not on the map"],
    [up(5), "out of range"], // sent anyway
    [up(3), "out of sight", game({ aAt: up(2) })], // characters block the line of sight
  ];
  for (const [target, reason, state = game()] of cases) {
    const { newState, events } = turn(state, T, leap(target));
    assert.deepEqual(events, [{ type: "planCancelled", characterId: T, action: 0, reason }], reason);
    assert.deepEqual(tankAt(newState), CENTRE);
    assert.deepEqual(newState.characters[0]!.cooldowns, {});
  }
});

// --- Planning and the preview ---

test("a planned leap leaves the tank on its hex, if it is within range", () => {
  assert.deepEqual(positionAfter(CENTRE, leap(up(3)), {}), up(3));
  assert.deepEqual(positionAfter(CENTRE, leap(up(5)), {}), CENTRE);
  assert.deepEqual(positionAfter(CENTRE, leap(up(5)), { leap: { range: 1 } }), up(5));
});

test("the preview shows whether a leap will go through", () => {
  const state = game();
  const blocked = previewCycle(state, [T, A], new Map([[T, [leap(down(3))]]]));
  assert.deepEqual(blocked.cancellations, [{ type: "planCancelled", characterId: T, action: 0, reason: "out of sight" }]);
  assert.deepEqual(previewCycle(state, [T, A], new Map([[T, [leap(up(3))]]])).cancellations, []);
});

test("at most one leap per plan, no follow-up plan, and the cooldown", () => {
  const state = game({ actions: 2 });
  assert.equal(planAbilityProblem(state, T, [leap(up(2)), leap(up(4))]), "Leap can't be planned: already planned.");
  const { newState, events } = turn(state, T, leap(up(2)));
  assert.equal(followUpPlan(newState, T, events), null);
  assert.equal(planAbilityProblem(newState, T, [leap(up(4))]), "Leap can't be planned: ready in 5 turns.");
});
