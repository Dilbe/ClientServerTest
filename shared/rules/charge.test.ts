import { test } from "node:test";
import assert from "node:assert/strict";
import {
  abilitiesOf,
  abilityProblem,
  abilityStats,
  planAbilityProblem,
  type AbilityId,
  type AbilityUpgradeCounts,
} from "./abilities.ts";
import { chargeMaxDistance, chargePath, chargeProblem } from "./charge.ts";
import type { DungeonMap } from "./dungeon-map.ts";
import { applyEvents } from "./events.ts";
import type { CharacterId, GameState } from "./game-state.ts";
import { fromOffset, hexKey, rectangle, type Hex } from "./hex.ts";
import { previewCycle } from "./preview.ts";
import { baseStats } from "./stats.ts";
import { createTrack } from "./track.ts";
import { followUpPlan, newGameState, resolveTurn, type Plan, type PlannedAction } from "./turn.ts";

const A = 1;
const B = 2;


/**
 * One room of 6 columns by 8 rows. Monster 0 is a guard (on guard at the
 * start) at column 3, row 1; monster 1 is far away in the bottom-right
 * corner. Hexes in the same column are in a straight line ("up"), so
 * `below(k)` is k hexes straight below monster 0.
 */
const MAP: DungeonMap = {
  hexes: rectangle(6, 8),
  startHexes: [fromOffset(0, 7)],
  doors: [],
  monsters: [
    { type: "guard", position: fromOffset(3, 1) },
    { type: "basic", position: fromOffset(5, 7) },
  ],
};

/** The hex `k` hexes straight below monster 0. */
function below(k: number): Hex {
  return fromOffset(3, 1 + k);
}

/** The hex a charge at monster 0 from straight below stops on. */
const STOP = below(1);

/** Where monster 0 stands. */
const M0 = fromOffset(3, 1);
const charge0: PlannedAction = { type: "charge", target: M0 };
const heavy0: PlannedAction = { type: "heavyStrike", target: M0 };
const attack0: PlannedAction = { type: "attack", target: M0 };

/**
 * A on `at` (3 hexes below monster 0 unless given), B off the map. A has
 * heavy strike and charge unless `abilities` says otherwise. Monster 0 has
 * 100 hit points, so it survives a few charges. The monsters aren't on the
 * track, so they never act.
 */
function game({
  at = below(3),
  abilities = ["heavyStrike", "charge"],
  attackDamage = 1,
  actions = 1,
  abilityUpgrades = {},
}: {
  at?: Hex;
  abilities?: readonly AbilityId[];
  attackDamage?: number;
  actions?: number;
  abilityUpgrades?: AbilityUpgradeCounts;
} = {}): GameState {
  const state = newGameState(
    MAP,
    [
      { id: A, stats: { ...baseStats(), attackDamage, actions }, abilities, abilityUpgrades },
      { id: B, stats: baseStats() },
    ],
    createTrack([A, B], new Map()),
  );
  return {
    ...state,
    characters: state.characters.map((c) => (c.id === A ? { ...c, position: at } : c)),
    monsters: state.monsters.map((m) => (m.id === 0 ? { ...m, hp: 100 } : m)),
  };
}

/** Resolves one turn of A with the given plan, and checks that replaying the events gives the same state. */
function turn(state: GameState, ...plan: Plan) {
  const plans = new Map<CharacterId, Plan>(plan.length > 0 ? [[A, plan]] : []);
  const result = resolveTurn(state, A, plans);
  assert.deepEqual(applyEvents(state, result.events), result.newState, "replaying the events");
  return result;
}

function a(state: GameState) {
  return state.characters.find((c) => c.id === A)!;
}

function withA(state: GameState, position: Hex): GameState {
  return { ...state, characters: state.characters.map((c) => (c.id === A ? { ...c, position } : c)) };
}

function withB(state: GameState, position: Hex): GameState {
  return { ...state, characters: state.characters.map((c) => (c.id === B ? { ...c, position } : c)) };
}

function withMonster(state: GameState, id: number, position: Hex): GameState {
  return { ...state, monsters: state.monsters.map((m) => (m.id === id ? { ...m, position } : m)) };
}

// --- Who has it ---

test("adventurers get charge from rank 3", () => {
  assert.deepEqual(abilitiesOf("adventurer", 2), ["heavyStrike"]);
  assert.deepEqual(abilitiesOf("adventurer", 3), ["heavyStrike", "charge"]);
  assert.ok(abilitiesOf("adventurer", 5).includes("charge"));
});

test("the character page shows charge's damage and range", () => {
  assert.deepEqual(abilityStats("charge", { ...baseStats(), attackDamage: 3 }), [
    { name: "Damage", value: "3" },
    { name: "Range", value: "2 to 4 hexes", upgrade: "range" },
    { name: "Cooldown", value: "4 turns", upgrade: "cooldown" },
  ]);
});

test("the character page shows charge's range and cooldown with its upgrades", () => {
  assert.deepEqual(abilityStats("charge", baseStats(), { charge: { range: 2, cooldown: 1 } }).slice(1), [
    { name: "Range", value: "2 to 6 hexes", upgrade: "range" },
    { name: "Cooldown", value: "3 turns", upgrade: "cooldown" },
  ]);
});

test("each range upgrade adds 1 to the longest charge, up to 6 hexes", () => {
  assert.equal(chargeMaxDistance({}), 4);
  assert.equal(chargeMaxDistance({ charge: { range: 1 } }), 5);
  assert.equal(chargeMaxDistance({ charge: { range: 2 } }), 6);
  // More upgrades than allowed now (after a balance change) don't count.
  assert.equal(chargeMaxDistance({ charge: { range: 3 } }), 6);
});

test("with range upgrades a charge reaches further, and is refused beyond that", () => {
  const upgraded = (at: Hex) => game({ at, abilityUpgrades: { charge: { range: 1 } } });
  assert.equal(planAbilityProblem(upgraded(below(5)), A, [charge0]), undefined);
  assert.equal(
    planAbilityProblem(upgraded(below(6)), A, [charge0]),
    "Charge can't be planned: the hex isn't in a straight line 2 to 5 hexes away.",
  );
  // Carried out: the run ends next to the monster, and the attack follows.
  const { newState, events } = turn(upgraded(below(5)), charge0);
  assert.deepEqual(a(newState).position, STOP);
  assert.ok(events.some((e) => e.type === "attacked" && e.ability === "charge"));
  // Without the upgrade, the same charge is cancelled when the turn fires.
  assert.deepEqual(turn(game({ at: below(5) }), charge0).events, [
    { type: "planCancelled", characterId: A, action: 0, reason: "not in line" },
  ]);
});

test("a charge with cooldown upgrades starts the shorter cooldown", () => {
  const { events } = turn(game({ abilityUpgrades: { charge: { cooldown: 1 } } }), charge0);
  assert.ok(events.some((e) => e.type === "cooldownStarted" && e.ability === "charge" && e.turns === 3));
});

test("a rank 2 character can't charge", () => {
  const state = game({ abilities: ["heavyStrike"] });
  assert.equal(abilityProblem(a(state), "charge", []), "Needs a higher rank");
  assert.match(planAbilityProblem(state, A, [charge0])!, /^Charge can't be planned: needs a higher rank/);
  // A client that sends it anyway: the rules cancel it too.
  assert.deepEqual(turn(state, charge0).events, [
    { type: "planCancelled", characterId: A, action: 0, reason: "no ability" },
  ]);
});

// --- The run and the attack ---

test("a charge runs to the hex next to the monster and attacks it for the attack damage", () => {
  const state = game({ attackDamage: 3 });
  const { newState, events } = turn(state, charge0);
  assert.deepEqual(events, [
    { type: "moved", actor: { kind: "character", id: A }, from: below(3), to: STOP, ability: "charge" },
    {
      type: "attacked",
      attacker: { kind: "character", id: A },
      target: { kind: "monster", id: 0 },
      damage: 3,
      ability: "charge",
    },
    { type: "cooldownStarted", characterId: A, ability: "charge", turns: 4 },
    // The guard was on guard: being charged wakes it, like any attack.
    { type: "monstersWoke", monsterIds: [0] },
  ]);
  assert.deepEqual(a(newState).position, STOP);
  assert.equal(newState.monsters[0]!.hp, 97);
});

test("a charge works from 2, 3 and 4 hexes away, in every direction", () => {
  const monster = fromOffset(3, 4);
  // From each of the 6 directions, 2 to 4 hexes out: the run stops next to the monster.
  for (const [dq, dr] of [[0, -1], [1, -1], [1, 0], [0, 1], [-1, 1], [-1, 0]] as const) {
    for (let k = 2; k <= 4; k++) {
      const from = { q: monster.q + dq * k, r: monster.r + dr * k };
      const path = chargePath(from, monster)!;
      assert.equal(path.length, k - 1);
      assert.deepEqual(path.at(-1), { q: monster.q + dq, r: monster.r + dr });
    }
  }
});

test("a charge can kill, and then gives XP like any attack", () => {
  const state = { ...game(), monsters: game().monsters.map((m) => (m.id === 0 ? { ...m, hp: 1 } : m)) };
  const { newState, events } = turn(state, charge0);
  assert.equal(newState.monsters[0]!.hp, 0);
  assert.ok(events.some((e) => e.type === "died"));
  assert.ok(events.some((e) => e.type === "xpGained"));
});

// --- What can be charged ---

test("a charge is refused for a monster 1 or 5 hexes away, or off a straight line", () => {
  assert.equal(chargePath(below(1), fromOffset(3, 1)), undefined);
  assert.equal(chargePath(below(5), fromOffset(3, 1)), undefined);
  // 3 hexes away, but not along a hex direction.
  const offLine = fromOffset(1, 3);
  assert.equal(chargePath(offLine, fromOffset(3, 1)), undefined);

  for (const at of [below(1), below(5), offLine]) {
    const state = game({ at });
    assert.equal(chargeProblem(state, at, M0, 4), "not in line");
    assert.equal(
      planAbilityProblem(state, A, [charge0]),
      "Charge can't be planned: the hex isn't in a straight line 2 to 4 hexes away.",
    );
  }
  for (const k of [2, 3, 4]) assert.equal(planAbilityProblem(game({ at: below(k) }), A, [charge0]), undefined);
});

test("a charge is cancelled when something is in the way, also on the hex it stops on", () => {
  const blocked = (state: GameState) => {
    assert.equal(chargeProblem(state, below(3), M0, 4), "path blocked");
    // It can still be planned: the way may be free by the time the turn fires.
    assert.equal(planAbilityProblem(state, A, [charge0]), undefined);
    assert.deepEqual(turn(state, charge0).events, [
      { type: "planCancelled", characterId: A, action: 0, reason: "path blocked" },
    ]);
  };
  // A character, on the way or on the hex it would stop on.
  blocked(withB(game(), below(2)));
  blocked(withB(game(), STOP));
  // A monster.
  blocked(withMonster(game(), 1, below(2)));
  // A wall or pillar: a hex that isn't on the map.
  const pillar = game();
  blocked({ ...pillar, map: { ...pillar.map, hexes: pillar.map.hexes.filter((h) => hexKey(h) !== hexKey(below(2))) } });
  // A closed door.
  blocked({ ...game(), closedDoors: [below(2)] });
  // A dead character doesn't take up room.
  const dead = withB(game(), below(2));
  const deadB = { ...dead, characters: dead.characters.map((c) => (c.id === B ? { ...c, hp: 0 } : c)) };
  assert.equal(chargeProblem(deadB, below(3), M0, 4), undefined);
});

test("a charge planned while the way is blocked goes through when it is free by the time the turn fires", () => {
  // B stands in the way when A plans the charge, and has stepped aside when it fires.
  const state = withB(game(), below(2));
  assert.equal(planAbilityProblem(state, A, [charge0]), undefined);
  const { events } = turn(withB(state, fromOffset(0, 7)), charge0);
  assert.ok(events.some((e) => e.type === "attacked" && e.ability === "charge"));
});

test("a charge can be planned at a hex without a monster, and hits the one that stands there by then", () => {
  // Monster 0 has stepped out of the way; monster 1 steps onto its hex before the turn fires.
  const empty = withMonster(game(), 0, fromOffset(5, 1));
  assert.equal(planAbilityProblem(empty, A, [charge0]), undefined);
  assert.deepEqual(turn(empty, charge0).events, [
    { type: "planCancelled", characterId: A, action: 0, reason: "target gone" },
  ]);
  const { events } = turn(withMonster(empty, 1, M0), charge0);
  const hit = events.find((e) => e.type === "attacked");
  assert.deepEqual(hit?.type === "attacked" && hit.target, { kind: "monster", id: 1 });
});

test("a charge is checked from where the plan places the character", () => {
  // 5 hexes away: too far, but one move up brings it to 4.
  const state = game({ at: below(5), actions: 2 });
  assert.ok(planAbilityProblem(state, A, [charge0]));
  assert.equal(planAbilityProblem(state, A, [{ type: "move", to: below(4) }, charge0]), undefined);
  // The hex it leaves is free for the run: move down, then charge back over it.
  const back = game({ at: below(3), actions: 2 });
  assert.equal(planAbilityProblem(back, A, [{ type: "move", to: below(4) }, charge0]), undefined);
  const { newState } = turn(back, { type: "move", to: below(4) }, charge0);
  assert.deepEqual(a(newState).position, STOP);
});

test("a plan holds at most one charge, but can hold a charge and a heavy strike", () => {
  const state = game({ actions: 2 });
  assert.equal(abilityProblem(a(state), "charge", [charge0]), "Already planned");
  assert.equal(planAbilityProblem(state, A, [charge0, charge0]), "Charge can't be planned: already planned.");
  assert.equal(planAbilityProblem(state, A, [charge0, heavy0]), undefined);
  // Carried out: 1 for the charge, 2 for the heavy strike.
  const { newState } = turn(state, charge0, heavy0);
  assert.equal(newState.monsters[0]!.hp, 97);
  assert.deepEqual(a(newState).cooldowns, { charge: 4, heavyStrike: 4 });
});

// --- All or nothing ---

test("a charge at a hex the monster left is cancelled completely, without a cooldown", () => {
  // Planned while the monster stood there; by the time the turn fires it stepped aside.
  const state = game();
  assert.equal(planAbilityProblem(state, A, [charge0]), undefined);
  const moved = withMonster(state, 0, fromOffset(4, 1));
  const { newState, events } = turn(moved, charge0);
  assert.deepEqual(events, [{ type: "planCancelled", characterId: A, action: 0, reason: "target gone" }]);
  assert.deepEqual(a(newState).position, below(3));
  assert.deepEqual(a(newState).cooldowns, {});
  // Back in line: ready at once.
  assert.ok(turn(state, charge0).events.some((e) => e.type === "attacked"));
});

test("a charge whose path filled up first is cancelled completely, without a cooldown", () => {
  const { newState, events } = turn(withB(game(), below(2)), charge0);
  assert.deepEqual(events, [{ type: "planCancelled", characterId: A, action: 0, reason: "path blocked" }]);
  assert.deepEqual(a(newState).position, below(3));
  assert.deepEqual(a(newState).cooldowns, {});
});

test("a charge at a dead monster is cancelled", () => {
  const state = { ...game(), monsters: game().monsters.map((m) => (m.id === 0 ? { ...m, hp: 0 } : m)) };
  assert.deepEqual(turn(state, charge0).events, [
    { type: "planCancelled", characterId: A, action: 0, reason: "target gone" },
  ]);
});

// --- Cooldown ---

test("used on turn 1, charge can't be used on turns 2 to 5 and is ready on turn 6", () => {
  let state = game();
  const results: boolean[] = [];
  for (let i = 0; i < 7; i++) {
    // Back to 3 hexes away every turn, so only the cooldown decides.
    const { newState, events } = turn(withA(state, below(3)), charge0);
    results.push(events.some((e) => e.type === "attacked" && e.ability === "charge"));
    if (!results.at(-1)) {
      assert.deepEqual(events.at(-1), { type: "planCancelled", characterId: A, action: 0, reason: "not ready" });
    }
    state = newState;
  }
  assert.deepEqual(results, [true, false, false, false, false, true, false]);
});

test("while charge is on cooldown, the plan check says when it is ready", () => {
  let state = withA(turn(game(), charge0).newState, below(3));
  assert.equal(abilityProblem(a(state), "charge", []), "Ready in 5 turns");
  assert.match(planAbilityProblem(state, A, [charge0])!, /ready in 5 turns/);
  for (let i = 0; i < 4; i++) state = turn(state).newState;
  assert.equal(planAbilityProblem(state, A, [charge0]), undefined);
});

// --- Follow-up plans ---

test("after a charge, the follow-up plan has normal attacks on the monster", () => {
  const state = game({ actions: 3 });
  const hp3 = { ...state, monsters: state.monsters.map((m) => (m.id === 0 ? { ...m, hp: 3 } : m)) };
  const { newState, events } = turn(hp3, charge0);
  assert.deepEqual(followUpPlan(newState, A, events), [attack0, attack0]);
});

// --- Preview ---

test("the preview matches what happens when a plan holds a charge", () => {
  const state = game({ actions: 2 });
  const plans = new Map<CharacterId, Plan>([[A, [charge0, attack0]]]);
  const preview = previewCycle(state, [A, B], plans);
  const { events } = resolveTurn(state, A, plans);
  assert.deepEqual(preview.turns[0], { characterId: A, events });
  assert.deepEqual(preview.cancellations, []);
});

test("the preview shows a charge with something in the way as cancelled", () => {
  const preview = previewCycle(withB(game(), below(2)), [A, B], new Map([[A, [charge0]]]));
  assert.deepEqual(preview.cancellations, [{ type: "planCancelled", characterId: A, action: 0, reason: "path blocked" }]);
});
