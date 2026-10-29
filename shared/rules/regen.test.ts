import { test } from "node:test";
import assert from "node:assert/strict";
import { abilitiesLine, abilitiesOf, abilityProblem, abilityStats, type AbilityId, type AbilityUpgradeCounts } from "./abilities.ts";
import { baseStats } from "./classes.ts";
import type { DungeonMap } from "./dungeon-map.ts";
import { applyEvents, type GameEvent } from "./events.ts";
import type { CharacterId, CharacterState, GameState } from "./game-state.ts";
import { fromOffset, neighbours, rectangle } from "./hex.ts";
import { newGameState, resolveTurn, type Plan } from "./turn.ts";
import { abilityUpgradeCost, nextAbilityUpgradeCost, type Upgrade } from "./upgrades.ts";

const T = 1;
const B = 2;
const CENTRE = fromOffset(4, 4);

/** One room of 9 by 9 hexes: monster 0 a basic monster (1 damage) next to the tank, monster 1 a brute next to it. */
const MAP: DungeonMap = {
  hexes: rectangle(9, 9),
  startHexes: [fromOffset(8, 8)],
  doors: [],
  monsters: [
    { type: "basic", position: neighbours(CENTRE)[3]! },
    { type: "brute", position: neighbours(CENTRE)[0]! },
  ],
};

/**
 * A rank 3 tank (block, taunt and regen) in the middle of the room, with
 * these monsters following it; B off the map. `tank` changes the tank's state.
 */
function game({
  monsterIds = [],
  abilities = abilitiesOf("tank", 3),
  abilityUpgrades = {},
  tank = {},
}: {
  monsterIds?: number[];
  abilities?: readonly AbilityId[];
  abilityUpgrades?: AbilityUpgradeCounts;
  tank?: Partial<CharacterState>;
} = {}): GameState {
  const state = newGameState(
    MAP,
    [
      { id: T, stats: baseStats("tank"), abilities, abilityUpgrades },
      { id: B, stats: baseStats("adventurer") },
    ],
    [
      { characterId: T, monsterIds },
      { characterId: B, monsterIds: [] },
    ],
  );
  return {
    ...state,
    characters: state.characters.map((c) => (c.id === T ? { ...c, position: CENTRE, ...tank } : c)),
  };
}

function turn(state: GameState, characterId: CharacterId = T, plan: Plan = []) {
  const plans = new Map<CharacterId, Plan>(plan.length > 0 ? [[characterId, plan]] : []);
  const result = resolveTurn(state, characterId, plans);
  assert.deepEqual(applyEvents(state, result.events), result.newState, "replaying the events");
  return result;
}

function tank(state: GameState) {
  return state.characters.find((c) => c.id === T)!;
}

const regenEvents = (events: readonly GameEvent[]) =>
  events.filter((e) => e.type === "regenStarted" || e.type === "regenerated");

// --- Who has it ---

test("a tank gets regen at rank 3; it is passive", () => {
  assert.deepEqual(abilitiesOf("tank", 2), ["block", "taunt"]);
  assert.deepEqual(abilitiesOf("tank", 3), ["block", "taunt", "regen"]);
  assert.equal(abilityProblem(tank(game()), "regen", []), "Works by itself");
  assert.deepEqual(abilityStats("regen", baseStats("tank")), [
    { name: "Healing", value: "1 hit point per turn", upgrade: "healing" },
    { name: "Duration", value: "5 turns", upgrade: "duration" },
  ]);
});

// --- Starting it ---

test("an attack starts regen, also one that was blocked completely", () => {
  const { newState, events } = turn(game({ monsterIds: [0] }));
  assert.deepEqual(events, [
    { type: "attacked", attacker: { kind: "monster", id: 0 }, target: { kind: "character", id: T }, damage: 0, blocked: 1 },
    { type: "regenStarted", characterId: T, turns: 5 },
  ]);
  assert.equal(tank(newState).regenTurns, 5);
});

test("without regen, an attack starts nothing", () => {
  const { events } = turn(game({ monsterIds: [0], abilities: abilitiesOf("tank", 2) }));
  assert.deepEqual(regenEvents(events), []);
});

// --- Healing ---

test("regen heals 1 hit point at the start of each of the tank's next 5 turns", () => {
  let state = game({ tank: { hp: 10, regenTurns: 5 } });
  const healed: number[] = [];
  for (let i = 0; i < 6; i++) {
    const { newState, events } = turn(state);
    healed.push(...events.flatMap((e) => (e.type === "regenerated" ? [e.healed] : [])));
    state = newState;
  }
  assert.deepEqual(healed, [1, 1, 1, 1, 1]);
  assert.equal(tank(state).hp, 15);
  assert.equal(tank(state).regenTurns, 0);
});

test("being attacked again while regen runs doesn't heal more, but resets the count", () => {
  const state = game({ monsterIds: [0], tank: { hp: 10, regenTurns: 2 } });
  const { newState, events } = turn(state);
  assert.deepEqual(regenEvents(events), [
    { type: "regenerated", characterId: T, healed: 1 },
    { type: "regenStarted", characterId: T, turns: 5 },
  ]);
  assert.equal(tank(newState).regenTurns, 5);
  assert.equal(tank(newState).hp, 11);
});

test("regen never heals above the max hit points; a turn at full hit points still counts", () => {
  const full = turn(game({ tank: { regenTurns: 3 } }));
  assert.deepEqual(regenEvents(full.events), [{ type: "regenerated", characterId: T, healed: 0 }]);
  assert.equal(tank(full.newState).hp, 20);
  assert.equal(tank(full.newState).regenTurns, 2);

  // 3 per turn with both upgrades, but 1 short of the max.
  const nearlyFull = turn(game({ abilityUpgrades: { regen: { healing: 2 } }, tank: { hp: 19, regenTurns: 3 } }));
  assert.deepEqual(regenEvents(nearlyFull.events), [{ type: "regenerated", characterId: T, healed: 1 }]);
});

test("dying ends regen, and a dying tank doesn't start it", () => {
  // No block, so the brute's hit kills a tank with 1 hit point.
  const state = game({ monsterIds: [1], abilities: ["regen"], tank: { hp: 1, regenTurns: 3 } });
  const { newState, events } = turn(state);
  assert.ok(events.some((e) => e.type === "died"));
  assert.ok(!events.some((e) => e.type === "regenStarted"));
  assert.equal(tank(newState).regenTurns, 0);
});

// --- Upgrades ---

test("the upgrades heal more per turn and for longer, cost as in design.md and stop at their limits", () => {
  const costs = (upgrade: "healing" | "duration", count: number) =>
    Array.from({ length: count }, (_, i) => abilityUpgradeCost("regen", upgrade, i + 1));
  assert.deepEqual(costs("healing", 2), [50, 400]);
  assert.deepEqual(costs("duration", 5), [10, 29, 52, 80, 112]);
  const maxed: Upgrade[] = [
    ...[50, 400].map((paid) => ({ ability: "regen" as const, upgrade: "healing" as const, paid })),
    ...[10, 29, 52, 80, 112].map((paid) => ({ ability: "regen" as const, upgrade: "duration" as const, paid })),
  ];
  assert.equal(nextAbilityUpgradeCost(maxed, "regen", "healing"), undefined);
  assert.equal(nextAbilityUpgradeCost(maxed, "regen", "duration"), undefined);

  const upgraded = { regen: { healing: 2, duration: 5 } };
  const { newState, events } = turn(game({ monsterIds: [0], abilityUpgrades: upgraded, tank: { hp: 10 } }));
  assert.deepEqual(regenEvents(events), [{ type: "regenStarted", characterId: T, turns: 10 }]);
  const healed = turn({ ...newState, track: newState.track.map((s) => ({ ...s, monsterIds: [] })) });
  assert.deepEqual(regenEvents(healed.events), [{ type: "regenerated", characterId: T, healed: 3 }]);
});

// --- Showing it ---

test("the details card shows regen with the turns left while it runs", () => {
  assert.equal(abilitiesLine(tank(game()), []), "Block 2/2 · Taunt ✓ · Regen");
  assert.equal(abilitiesLine(tank(game({ tank: { regenTurns: 3 } })), []), "Block 2/2 · Taunt ✓ · Regen 3 turns left");
});
