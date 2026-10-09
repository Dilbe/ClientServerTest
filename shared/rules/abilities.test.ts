import { test } from "node:test";
import assert from "node:assert/strict";
import {
  abilitiesOf,
  abilityCooldown,
  abilityProblem,
  abilityStats,
  planAbilityProblem,
  type AbilityUpgradeCounts,
} from "./abilities.ts";
import { FIRST_DUNGEON_MAP } from "./dungeon-map.ts";
import { applyEvents } from "./events.ts";
import type { CharacterId, GameState } from "./game-state.ts";
import { fromOffset } from "./hex.ts";
import { previewCycle } from "./preview.ts";
import { baseStats } from "./stats.ts";
import { createTrack } from "./track.ts";
import { followUpPlan, newGameState, resolveTurn, type Plan, type PlannedAction } from "./turn.ts";

const A = 1;
const B = 2;

/** Where monster 0 stands, next to A. */
const M0 = fromOffset(5, 1);
const heavy0: PlannedAction = { type: "heavyStrike", target: M0 };
const attack0: PlannedAction = { type: "attack", target: M0 };

/**
 * The first dungeon with A next to monster 0 (column 5, row 1), and B off
 * the map. A has heavy strike unless `abilities` says otherwise. Monster 0
 * has `monsterHp` hit points, so it survives a few heavy strikes. The
 * monsters aren't on the track, so they never act.
 */
function game({
  abilities = ["heavyStrike"] as const,
  attackDamage = 1,
  actions = 1,
  monsterHp = 100,
  abilityUpgrades = {},
}: {
  abilities?: readonly "heavyStrike"[];
  attackDamage?: number;
  actions?: number;
  monsterHp?: number;
  abilityUpgrades?: AbilityUpgradeCounts;
} = {}): GameState {
  const state = newGameState(
    FIRST_DUNGEON_MAP,
    [
      { id: A, stats: { ...baseStats(), attackDamage, actions }, abilities, abilityUpgrades },
      { id: B, stats: baseStats() },
    ],
    createTrack([A, B], new Map()),
  );
  return {
    ...state,
    characters: state.characters.map((c) => (c.id === A ? { ...c, position: fromOffset(4, 1) } : c)),
    monsters: state.monsters.map((m) => (m.id === 0 ? { ...m, hp: monsterHp } : m)),
  };
}

/** Resolves one turn of A with the given plan, and checks that replaying the events gives the same state. */
function turn(state: GameState, ...plan: Plan) {
  const plans = new Map<CharacterId, Plan>(plan.length > 0 ? [[A, plan]] : []);
  const result = resolveTurn(state, A, plans);
  assert.deepEqual(applyEvents(state, result.events), result.newState, "replaying the events");
  return result;
}

function hpOf0(state: GameState): number {
  return state.monsters[0]!.hp;
}

function a(state: GameState) {
  return state.characters.find((c) => c.id === A)!;
}

// --- Who has it ---

test("adventurers get heavy strike from rank 2", () => {
  assert.deepEqual(abilitiesOf("adventurer", 1), []);
  assert.deepEqual(abilitiesOf("adventurer", 2), ["heavyStrike"]);
  assert.ok(abilitiesOf("adventurer", 5).includes("heavyStrike"));
});

test("the character page shows heavy strike's damage with the character's attack damage", () => {
  assert.deepEqual(abilityStats("heavyStrike", baseStats()), [
    { name: "Damage", value: "2" },
    { name: "Cooldown", value: "4 turns", upgrade: "cooldown" },
  ]);
  assert.equal(abilityStats("heavyStrike", { ...baseStats(), attackDamage: 3 })[0]!.value, "6");
  // With cooldown upgrades: the shorter cooldown.
  assert.deepEqual(abilityStats("heavyStrike", baseStats(), { heavyStrike: { cooldown: 3 } })[1], {
    name: "Cooldown",
    value: "1 turn",
    upgrade: "cooldown",
  });
});

test("every game starts with no cooldowns", () => {
  assert.deepEqual(a(game()).cooldowns, {});
});

// --- Damage ---

test("a heavy strike does double the attack damage", () => {
  const state = game();
  const { newState, events } = turn(state, heavy0);
  assert.equal(hpOf0(state) - hpOf0(newState), 2);
  assert.deepEqual(events[0], {
    type: "attacked",
    attacker: { kind: "character", id: A },
    target: { kind: "monster", id: 0 },
    damage: 2,
    ability: "heavyStrike",
  });
});

test("a heavy strike follows attack damage upgrades", () => {
  const state = game({ attackDamage: 3 });
  assert.equal(hpOf0(state) - hpOf0(turn(state, heavy0).newState), 6);
});

test("a heavy strike can kill, and then gives XP like any attack", () => {
  const { newState, events } = turn(game({ monsterHp: 2 }), heavy0);
  assert.equal(hpOf0(newState), 0);
  assert.ok(events.some((e) => e.type === "died"));
  assert.ok(events.some((e) => e.type === "xpGained"));
});

// --- Cooldown ---

/** Whether A's heavy strike goes through on each of its turns 1 to `count`, planning one every turn. */
function heavyStrikesOverTurns(count: number, state = game()): boolean[] {
  const results: boolean[] = [];
  for (let i = 0; i < count; i++) {
    const { newState, events } = turn(state, heavy0);
    results.push(events.some((e) => e.type === "attacked" && e.ability === "heavyStrike"));
    state = newState;
  }
  return results;
}

test("used on turn 1, heavy strike can't be used on turns 2 to 5 and is ready on turn 6", () => {
  assert.deepEqual(heavyStrikesOverTurns(7), [true, false, false, false, false, true, false]);
});

test("each cooldown upgrade takes a turn off the cooldown, down to 1 turn", () => {
  assert.equal(abilityCooldown("heavyStrike", {}), 4);
  assert.equal(abilityCooldown("heavyStrike", { heavyStrike: { cooldown: 1 } }), 3);
  assert.equal(abilityCooldown("heavyStrike", { heavyStrike: { cooldown: 3 } }), 1);
  // More upgrades than allowed now (after a balance change) don't count.
  assert.equal(abilityCooldown("heavyStrike", { heavyStrike: { cooldown: 5 } }), 1);
  // Upgrades of another ability don't count.
  assert.equal(abilityCooldown("heavyStrike", { charge: { cooldown: 2 } }), 4);
});

test("with 2 cooldown upgrades, heavy strike used on turn 1 is ready again on turn 4", () => {
  const state = game({ abilityUpgrades: { heavyStrike: { cooldown: 2 } } });
  assert.deepEqual(heavyStrikesOverTurns(5, state), [true, false, false, true, false]);
  const { events } = turn(state, heavy0);
  assert.ok(events.some((e) => e.type === "cooldownStarted" && e.turns === 2));
});

test("with the cooldown fully upgraded, heavy strike can be used every other turn", () => {
  const state = game({ abilityUpgrades: { heavyStrike: { cooldown: 3 } } });
  assert.deepEqual(heavyStrikesOverTurns(4, state), [true, false, true, false]);
});

test("a heavy strike on cooldown is cancelled as not ready", () => {
  const first = turn(game(), heavy0).newState;
  assert.deepEqual(turn(first, heavy0).events, [
    { type: "cooldownsAdvanced", characterId: A },
    { type: "planCancelled", characterId: A, action: 0, reason: "not ready" },
  ]);
});

test("turns without a plan count for the cooldown too", () => {
  let state = turn(game(), heavy0).newState;
  for (let i = 0; i < 4; i++) state = turn(state).newState;
  assert.equal(hpOf0(turn(state, heavy0).newState), hpOf0(state) - 2);
});

test("turns in which the character isn't on the map count for the cooldown", () => {
  let state = turn(game(), heavy0).newState;
  // A is taken off the map, as before it entered the room, and no start hex is free.
  const blocked = {
    ...state,
    characters: state.characters.map((c) => (c.id === A ? { ...c, position: null } : c)),
    map: { ...state.map, startHexes: [] },
  };
  state = blocked;
  for (let i = 0; i < 4; i++) state = turn(state).newState;
  assert.equal(a(state).cooldowns.heavyStrike, 0);
});

test("a cancelled heavy strike doesn't start the cooldown", () => {
  // A stands 2 hexes away from monster 0: the heavy strike is cancelled.
  const away = { ...game(), characters: game().characters.map((c) => (c.id === A ? { ...c, position: fromOffset(3, 1) } : c)) };
  const { newState, events } = turn(away, heavy0);
  assert.deepEqual(events, [{ type: "planCancelled", characterId: A, action: 0, reason: "not a neighbour" }]);
  assert.deepEqual(a(newState).cooldowns, {});
  // Next to the monster now: ready at once.
  const next = { ...newState, characters: newState.characters.map((c) => (c.id === A ? { ...c, position: fromOffset(4, 1) } : c)) };
  assert.equal(hpOf0(turn(next, heavy0).newState), hpOf0(next) - 2);
});

test("a second heavy strike in the same turn is cancelled", () => {
  const { newState, events } = turn(game({ actions: 2 }), heavy0, heavy0);
  assert.equal(hpOf0(game()) - hpOf0(newState), 2);
  assert.deepEqual(events.at(-1), { type: "planCancelled", characterId: A, action: 1, reason: "not ready" });
});

test("a heavy strike without the ability is cancelled", () => {
  const state = game({ abilities: [] });
  assert.deepEqual(turn(state, heavy0).events, [
    { type: "planCancelled", characterId: A, action: 0, reason: "no ability" },
  ]);
});

test("normal attacks still work during the cooldown", () => {
  const state = turn(game(), heavy0).newState;
  assert.equal(hpOf0(turn(state, attack0).newState), hpOf0(state) - 1);
});

// --- Follow-up plans ---

test("after a heavy strike, the follow-up plan has normal attacks only", () => {
  const { newState, events } = turn(game({ actions: 3, monsterHp: 4 }), heavy0);
  // 2 hit points left, 1 damage per normal attack.
  assert.deepEqual(followUpPlan(newState, A, events), [attack0, attack0]);
});

// --- Checking plans (the server and the button) ---

test("a plan with a heavy strike is fine for a rank 2 character that has it ready", () => {
  assert.equal(planAbilityProblem(game(), A, [heavy0]), undefined);
  assert.equal(abilityProblem(a(game()), "heavyStrike", []), undefined);
});

test("a plan with a heavy strike is refused without the ability", () => {
  const state = game({ abilities: [] });
  const character = a(state);
  assert.equal(abilityProblem(character, "heavyStrike", []), "Needs a higher rank");
  assert.ok(planAbilityProblem(state, A, [heavy0]));
});

test("a plan with a heavy strike is refused while it is on cooldown on the next turn", () => {
  let state = turn(game(), heavy0).newState;
  // Before turn 2: turns 2 to 5 to wait, ready on the 5th turn from now.
  assert.equal(abilityProblem(a(state), "heavyStrike", []), "Ready in 5 turns");
  assert.ok(planAbilityProblem(state, A, [heavy0]));
  for (let i = 0; i < 3; i++) state = turn(state).newState;
  // Before turn 5: one turn to wait.
  assert.equal(abilityProblem(a(state), "heavyStrike", []), "Ready in 2 turns");
  state = turn(state).newState;
  // Before turn 6: ready.
  assert.equal(planAbilityProblem(state, A, [heavy0]), undefined);
});

test("a plan with two heavy strikes is refused", () => {
  const state = game({ actions: 2 });
  const character = a(state);
  assert.equal(abilityProblem(character, "heavyStrike", [heavy0]), "Already planned");
  assert.ok(planAbilityProblem(state, A, [heavy0, heavy0]));
  assert.equal(planAbilityProblem(state, A, [attack0, heavy0]), undefined);
});

// --- Preview ---

test("the preview matches what happens when a plan holds a heavy strike", () => {
  const state = game({ actions: 2, monsterHp: 3 });
  const plans = new Map<CharacterId, Plan>([[A, [heavy0, attack0]]]);
  const preview = previewCycle(state, [A, B], plans);
  const { events } = resolveTurn(state, A, plans);
  assert.deepEqual(preview.turns[0], { characterId: A, events });
  assert.deepEqual(preview.cancellations, []);
  assert.deepEqual(preview.monsters.get(0), { type: "dies", after: A });
});

test("the preview shows a heavy strike on cooldown as cancelled", () => {
  const state = turn(game(), heavy0).newState;
  const preview = previewCycle(state, [A, B], new Map([[A, [heavy0]]]));
  assert.deepEqual(preview.cancellations, [{ type: "planCancelled", characterId: A, action: 0, reason: "not ready" }]);
});
