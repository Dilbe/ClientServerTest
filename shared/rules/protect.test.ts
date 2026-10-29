import { test } from "node:test";
import assert from "node:assert/strict";
import { abilitiesOf, abilityStats, planAbilityProblem, type AbilityId } from "./abilities.ts";
import { baseStats } from "./classes.ts";
import type { DungeonMap } from "./dungeon-map.ts";
import { applyEvents, type GameEvent } from "./events.ts";
import type { CharacterId, CharacterState, GameState, MonsterId } from "./game-state.ts";
import { areNeighbours, distance, fromOffset, hexEquals, neighbours, rectangle, type Hex } from "./hex.ts";
import { previewCycle } from "./preview.ts";
import { followUpPlan, newGameState, resolveTurn, type Plan, type PlannedAction } from "./turn.ts";

/** The tank. */
const T = 1;
/** Its ally: an adventurer next to it, with fewer hit points, so the monsters' target. */
const A = 2;
/** A second tank, off the map unless a test places it. */
const U = 3;

const CENTRE = fromOffset(4, 4);
const A_AT = neighbours(CENTRE)[0]!;
/** Next to A, not next to the tank. */
const M0 = neighbours(A_AT).find((h) => !hexEquals(h, CENTRE) && !areNeighbours(h, CENTRE))!;
/** Next to the tank and A, for the second tank. */
const U_AT = neighbours(CENTRE).find((h) => areNeighbours(h, A_AT))!;
/** Next to the tank, away from A: where it steps out of reach. */
const AWAY = neighbours(CENTRE).find((h) => distance(h, A_AT) === 2 && !hexEquals(h, U_AT))!;

/**
 * One room of 9 by 9 hexes. Monster 0 is a basic monster next to A, not
 * next to the tank; monster 1 an archer that can shoot A from below.
 */
const MAP: DungeonMap = {
  hexes: rectangle(9, 9),
  startHexes: [fromOffset(8, 8)],
  doors: [],
  monsters: [
    { type: "basic", position: M0 },
    { type: "archer", position: fromOffset(1, 3) },
  ],
};

const protectA: PlannedAction = { type: "protect", target: A_AT };

function game({
  abilities = abilitiesOf("tank", 4),
  actions = 1,
  monsters = {},
  placed = { [T]: CENTRE, [A]: A_AT },
}: {
  abilities?: readonly AbilityId[];
  actions?: number;
  monsters?: Partial<Record<CharacterId, MonsterId[]>>;
  placed?: Partial<Record<CharacterId, Hex>>;
} = {}): GameState {
  const state = newGameState(
    MAP,
    [
      { id: T, stats: { ...baseStats("tank"), actions }, abilities },
      { id: A, stats: baseStats("adventurer") },
      { id: U, stats: baseStats("tank"), abilities: abilitiesOf("tank", 4) },
    ],
    [T, A, U].map((characterId) => ({ characterId, monsterIds: monsters[characterId] ?? [] })),
  );
  return { ...state, characters: state.characters.map((c) => ({ ...c, position: placed[c.id] ?? null })) };
}

function turn(state: GameState, characterId: CharacterId, ...plan: Plan) {
  const plans = new Map<CharacterId, Plan>(plan.length > 0 ? [[characterId, plan]] : []);
  const result = resolveTurn(state, characterId, plans);
  assert.deepEqual(applyEvents(state, result.events), result.newState, "replaying the events");
  return result;
}

function character(state: GameState, id: CharacterId): CharacterState {
  return state.characters.find((c) => c.id === id)!;
}

/** The attacks of monsters in these events: whom they hit, and whom they aimed at when someone else took it. */
function hits(events: readonly GameEvent[]) {
  return events.flatMap((e) =>
    e.type === "attacked" && e.attacker.kind === "monster"
      ? [{ hit: e.target.id, ...(e.protecting !== undefined && { aimedAt: e.protecting }) }]
      : [],
  );
}

// --- Who has it ---

test("a tank gets protect at rank 4", () => {
  assert.ok(!abilitiesOf("tank", 3).includes("protect"));
  assert.deepEqual(abilitiesOf("tank", 4), ["block", "taunt", "regen", "protect"]);
  assert.deepEqual(abilityStats("protect", baseStats("tank")).at(-1), { name: "Cooldown", value: "4 turns", upgrade: "cooldown" });
  const rank3 = game({ abilities: abilitiesOf("tank", 3) });
  assert.equal(planAbilityProblem(rank3, T, [protectA]), "Protect can't be planned: needs a higher rank.");
});

// --- What it does ---

test("an attack on the protected ally hits the tank instead; block and regen work on it", () => {
  const state = game({ monsters: { [T]: [0] } });
  // Without protect, the monster hits A.
  assert.deepEqual(hits(turn(state, T).events), [{ hit: A }]);

  const { newState, events } = turn(state, T, protectA);
  assert.deepEqual(events.slice(0, 2), [
    { type: "protected", characterId: T, allyId: A },
    { type: "cooldownStarted", characterId: T, ability: "protect", turns: 4 },
  ]);
  assert.deepEqual(events.slice(2), [
    {
      type: "attacked",
      attacker: { kind: "monster", id: 0 },
      target: { kind: "character", id: T },
      damage: 0,
      blocked: 1,
      protecting: A,
    },
    { type: "regenStarted", characterId: T, turns: 5 },
  ]);
  assert.equal(character(newState, A).hp, 10);
  assert.equal(character(newState, A).protectedBy, T);
});

test("a ranged attack on the protected ally hits the tank too", () => {
  const state = game({ monsters: { [T]: [1] } });
  assert.deepEqual(hits(turn(state, T).events), [{ hit: A }], "the archer shoots A");
  assert.deepEqual(hits(turn(state, T, protectA).events), [{ hit: T, aimedAt: A }]);
});

test("once the tank has moved away from the ally, the attacks hit the ally again", () => {
  const state = game({ actions: 2, monsters: { [T]: [0] } });
  const { events } = turn(state, T, protectA, { type: "move", to: AWAY });
  assert.deepEqual(hits(events), [{ hit: A }]);
});

test("protect lasts until the start of the tank's next turn", () => {
  const protectedA = turn(game({ monsters: { [A]: [0] } }), T, protectA).newState;
  // In A's turn, the monster following A still hits the tank.
  const later = turn(protectedA, A);
  assert.deepEqual(hits(later.events), [{ hit: T, aimedAt: A }]);
  const { newState, events } = turn(later.newState, T);
  assert.deepEqual(events.slice(0, 2), [
    { type: "cooldownsAdvanced", characterId: T },
    { type: "protectEnded", characterId: A },
  ]);
  assert.equal(character(newState, A).protectedBy, undefined);
});

test("two tanks on one ally: the latest protect counts", () => {
  let state = game({ monsters: { [A]: [0] }, placed: { [T]: CENTRE, [A]: A_AT, [U]: U_AT } });
  state = turn(state, T, protectA).newState;
  state = turn(state, U, protectA).newState;
  assert.equal(character(state, A).protectedBy, U);
  // T's next turn doesn't end U's protect.
  const tNext = turn(state, T);
  assert.ok(!tNext.events.some((e) => e.type === "protectEnded"));
  assert.deepEqual(hits(turn(tNext.newState, A).events), [{ hit: U, aimedAt: A }]);
});

test("a tank protects one ally at a time", () => {
  let state = game({ placed: { [T]: CENTRE, [A]: A_AT, [U]: U_AT } });
  state = turn(state, T, protectA).newState;
  // As if the cooldown were over: T protects U now.
  state = { ...state, characters: state.characters.map((c) => (c.id === T ? { ...c, cooldowns: {} } : c)) };
  state = turn(state, T, { type: "protect", target: U_AT }).newState;
  assert.equal(character(state, A).protectedBy, undefined);
  assert.equal(character(state, U).protectedBy, T);
});

test("a dead tank protects no one", () => {
  const state = turn(game(), T, protectA).newState;
  const dead = applyEvents(state, [{ type: "died", who: { kind: "character", id: T } }]);
  assert.equal(character(dead, A).protectedBy, undefined);
});

test("a protect without a living ally on the hex, or not next to the tank, is cancelled without a cooldown", () => {
  const alone = game({ placed: { [T]: CENTRE } });
  const cancelled = turn(alone, T, protectA);
  assert.deepEqual(cancelled.events, [{ type: "planCancelled", characterId: T, action: 0, reason: "no ally" }]);
  assert.deepEqual(character(cancelled.newState, T).cooldowns, {});
  // Not on a monster either.
  assert.deepEqual(turn(game(), T, { type: "protect", target: neighbours(CENTRE)[3]! }).events, [
    { type: "planCancelled", characterId: T, action: 0, reason: "no ally" },
  ]);
  assert.deepEqual(turn(game(), T, { type: "protect", target: fromOffset(8, 0) }).events, [
    { type: "planCancelled", characterId: T, action: 0, reason: "not a neighbour" },
  ]);
});

// --- Planning ---

test("the server checks at most one protect per plan and the cooldown; no follow-up plan after it", () => {
  const state = game({ actions: 2 });
  assert.equal(planAbilityProblem(state, T, [protectA, protectA]), "Protect can't be planned: already planned.");
  const { newState, events } = turn(state, T, protectA);
  assert.equal(planAbilityProblem(newState, T, [protectA]), "Protect can't be planned: ready in 5 turns.");
  assert.equal(followUpPlan(newState, T, events), null);
});

// --- Preview ---

test("the preview shows the attack on the ally going to the tank, and matches what happens", () => {
  const state = game({ monsters: { [A]: [0] } });
  const plans = new Map<CharacterId, Plan>([[T, [protectA]]]);
  const preview = previewCycle(state, [T, A, U], plans);
  assert.deepEqual(preview.turns[0], { characterId: T, events: resolveTurn(state, T, plans).events });
  const step = preview.monsters.get(0);
  assert.equal(step?.type, "acts");
  assert.deepEqual(step?.type === "acts" && step.steps[0], {
    type: "attack",
    target: T,
    targetAt: CENTRE,
    damage: 0,
    blocked: 1,
    protecting: A,
    kills: false,
  });
});
