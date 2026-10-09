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
import { monsterXp } from "./difficulties.ts";
import type { DungeonMap } from "./dungeon-map.ts";
import { applyEvents } from "./events.ts";
import type { CharacterId, GameState, MonsterId } from "./game-state.ts";
import { distance, fromOffset, neighbours, rectangle, type Hex } from "./hex.ts";
import { previewCycle } from "./preview.ts";
import { baseStats } from "./stats.ts";
import { createTrack } from "./track.ts";
import { followUpPlan, newGameState, resolveTurn, type Plan, type PlannedAction } from "./turn.ts";

const A = 1;
const B = 2;

const cleave: PlannedAction = { type: "cleave" };
const attack0: PlannedAction = { type: "attack", monsterId: 0 };

/** Where A stands: the middle of the room. */
const CENTRE = fromOffset(4, 4);
/** The 6 hexes next to A. */
const AROUND = neighbours(CENTRE);
/** 2 hexes straight above A: close, but not next to it. */
const TWO_AWAY = fromOffset(4, 2);

/** A hex in the far left column, well away from A. */
function far(row: number): Hex {
  return fromOffset(0, row);
}

/**
 * One room of 9 by 9 hexes. Monsters 0 to 5 stand on the 6 hexes around A,
 * monster 6 two hexes away, and monsters 7 and 8 are guards (on guard at the
 * start) far away in the corner.
 */
const MAP: DungeonMap = {
  hexes: rectangle(9, 9),
  startHexes: [fromOffset(8, 8)],
  doors: [],
  monsters: [
    ...AROUND.map((position) => ({ type: "basic" as const, position })),
    { type: "basic", position: TWO_AWAY },
    { type: "guard", position: fromOffset(8, 0) },
    { type: "guard", position: fromOffset(8, 1) },
  ],
};

/**
 * A in the middle of the room, B off the map. A has every ability up to
 * cleave unless `abilities` says otherwise. Every monster has `monsterHp`
 * hit points. The monsters aren't on the track unless `monstersOf` puts
 * them there, so they never act.
 */
function game({
  abilities = ["heavyStrike", "charge", "cleave"],
  attackDamage = 1,
  actions = 1,
  abilityUpgrades = {},
  monsterHp = 100,
  maxXpGain,
  monstersOf = new Map(),
}: {
  abilities?: readonly AbilityId[];
  attackDamage?: number;
  actions?: number;
  abilityUpgrades?: AbilityUpgradeCounts;
  monsterHp?: number;
  maxXpGain?: number;
  monstersOf?: ReadonlyMap<MonsterId, CharacterId>;
} = {}): GameState {
  const state = newGameState(
    MAP,
    [
      { id: A, stats: { ...baseStats(), attackDamage, actions }, abilities, abilityUpgrades, maxXpGain },
      { id: B, stats: baseStats() },
    ],
    createTrack([A, B], monstersOf),
  );
  return {
    ...state,
    characters: state.characters.map((c) => (c.id === A ? { ...c, position: CENTRE } : c)),
    monsters: state.monsters.map((m) => ({ ...m, hp: monsterHp })),
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

function withMonster(state: GameState, id: MonsterId, position: Hex): GameState {
  return { ...state, monsters: state.monsters.map((m) => (m.id === id ? { ...m, position } : m)) };
}

/** Moves every monster around A from the `count`-th on far away, so `count` of them are left next to A. */
function withAdjacent(state: GameState, count: number): GameState {
  for (let id = count; id < AROUND.length; id++) state = withMonster(state, id, far(id));
  return state;
}

/** The monsters A's cleave hit in these events. */
function hitsOf(events: ReturnType<typeof turn>["events"]): MonsterId[] {
  return events.flatMap((e) => (e.type === "attacked" && e.ability === "cleave" ? [e.target.id] : []));
}

// --- Who has it ---

test("adventurers get cleave from rank 4", () => {
  assert.deepEqual(abilitiesOf("adventurer", 3), ["heavyStrike", "charge"]);
  assert.deepEqual(abilitiesOf("adventurer", 4), ["heavyStrike", "charge", "cleave"]);
  assert.ok(abilitiesOf("adventurer", 5).includes("cleave"));
});

test("the character page shows cleave's damage, and its cooldown with upgrades", () => {
  assert.deepEqual(abilityStats("cleave", { ...baseStats(), attackDamage: 3 }), [
    { name: "Damage", value: "3 to each adjacent monster" },
    { name: "Cooldown", value: "4 turns", upgrade: "cooldown" },
  ]);
  assert.deepEqual(abilityStats("cleave", baseStats(), { cleave: { cooldown: 3 } }).at(-1), {
    name: "Cooldown",
    value: "1 turn",
    upgrade: "cooldown",
  });
});

test("a rank 3 character can't cleave", () => {
  const rank3 = game({ abilities: ["heavyStrike", "charge"] });
  assert.equal(abilityProblem(a(rank3), "cleave", []), "Needs a higher rank");
  assert.equal(planAbilityProblem(rank3, A, [cleave]), "Cleave can't be planned: needs a higher rank.");
  // Sent anyway, the rules don't carry it out either.
  assert.deepEqual(turn(rank3, cleave).events, [
    { type: "planCancelled", characterId: A, action: 0, reason: "no ability" },
  ]);
});

// --- What it does ---

test("a cleave hits every adjacent monster, 1 to 6 of them, and none further away", () => {
  for (let count = 1; count <= 6; count++) {
    const { newState, events } = turn(withAdjacent(game(), count), cleave);
    const expected = Array.from({ length: count }, (_, id) => id);
    assert.deepEqual(hitsOf(events), expected, `${count} adjacent`);
    for (const m of newState.monsters) {
      assert.equal(m.hp, expected.includes(m.id) ? 99 : 100, `monster ${m.id} with ${count} adjacent`);
    }
  }
});

test("a cleave hits for the attack damage with upgrades, all at once, and starts one cooldown", () => {
  const { events } = turn(withAdjacent(game({ attackDamage: 3 }), 2), cleave);
  const attacker = { kind: "character", id: A } as const;
  assert.deepEqual(events, [
    { type: "attacked", attacker, target: { kind: "monster", id: 0 }, damage: 3, ability: "cleave" },
    { type: "attacked", attacker, target: { kind: "monster", id: 1 }, damage: 3, ability: "cleave" },
    { type: "cooldownStarted", characterId: A, ability: "cleave", turns: 4 },
  ]);
});

test("a dead monster next to the character isn't hit", () => {
  const state = withAdjacent(game(), 2);
  const oneDead = { ...state, monsters: state.monsters.map((m) => (m.id === 0 ? { ...m, hp: 0 } : m)) };
  assert.deepEqual(hitsOf(turn(oneDead, cleave).events), [1]);
});

test("each monster a cleave kills gives XP as usual", () => {
  const { newState, events } = turn(withAdjacent(game({ monsterHp: 1 }), 3), cleave);
  assert.deepEqual(
    events.filter((e) => e.type === "died").map((e) => e.who),
    [0, 1, 2].map((id) => ({ kind: "monster", id })),
  );
  const xp = monsterXp("basic", "normal");
  assert.equal(a(newState).xpGained, 3 * xp);
  assert.equal(newState.characters.find((c) => c.id === B)!.xpGained, 3 * xp);
});

test("the kills of one cleave together give no more XP than the character's max level needs", () => {
  const xp = monsterXp("basic", "normal");
  const state = withAdjacent(game({ monsterHp: 1, maxXpGain: xp + 1 }), 2);
  const { newState, events } = turn(state, cleave);
  const gainsOfA = events.flatMap((e) => (e.type === "xpGained" ? e.gains.filter((g) => g.characterId === A) : []));
  assert.deepEqual(
    gainsOfA.map((g) => g.xp),
    [xp, 1],
  );
  assert.equal(a(newState).xpGained, xp + 1);
});

test("every monster a cleave hits is alerted", () => {
  let state = withAdjacent(game(), 2);
  state = withMonster(withMonster(state, 7, AROUND[2]!), 8, AROUND[3]!);
  assert.ok(state.monsters[7]!.asleep && state.monsters[8]!.asleep);
  const { newState, events } = turn(state, cleave);
  assert.deepEqual(hitsOf(events), [0, 1, 7, 8]);
  assert.deepEqual(events.at(-1), { type: "monstersWoke", monsterIds: [7, 8] });
  assert.ok(!newState.monsters[7]!.asleep && !newState.monsters[8]!.asleep);
});

test("a cleave with no adjacent monster is cancelled and doesn't start the cooldown", () => {
  const { newState, events } = turn(withAdjacent(game(), 0), cleave);
  assert.deepEqual(events, [{ type: "planCancelled", characterId: A, action: 0, reason: "no monster adjacent" }]);
  assert.deepEqual(a(newState).cooldowns, {});
  assert.equal(planAbilityProblem(newState, A, [cleave]), undefined);
});

test("a cleave hits the monsters next to where the actions before it take the character", () => {
  // Moving up next to monster 6 (two hexes up), away from the monsters below.
  const state = withAdjacent(game({ actions: 2 }), 0);
  const up = fromOffset(4, 3);
  assert.equal(distance(up, TWO_AWAY), 1);
  const { events } = turn(state, { type: "move", to: up }, cleave);
  assert.deepEqual(hitsOf(events), [6]);
});

// --- Planning ---

test("a plan holds at most one cleave, next to a heavy strike and a charge", () => {
  const state = game({ actions: 3 });
  assert.equal(planAbilityProblem(state, A, [cleave, { type: "heavyStrike", monsterId: 0 }]), undefined);
  assert.equal(planAbilityProblem(state, A, [cleave, cleave]), "Cleave can't be planned: already planned.");
  assert.equal(abilityProblem(a(state), "cleave", [cleave]), "Already planned");
});

test("a cleave can't be planned before the character is on the map, but after entering it can", () => {
  const state = { ...game({ actions: 2 }), characters: game().characters.map((c) => ({ ...c, position: null })) };
  assert.equal(planAbilityProblem(state, A, [cleave]), "Cleave can't be planned: the character isn't on the map yet.");
  assert.equal(planAbilityProblem(state, A, [{ type: "place", hex: MAP.startHexes[0]! }, cleave]), undefined);
});

test("a cleave is planned without monsters next to the character: one may come close first", () => {
  assert.equal(planAbilityProblem(withAdjacent(game(), 0), A, [cleave]), undefined);
});

// --- Cooldown ---

test("used on turn 1, cleave can't be used on turns 2 to 5 and is ready on turn 6", () => {
  let state = game();
  const results: boolean[] = [];
  for (let i = 0; i < 7; i++) {
    const { newState, events } = turn(state, cleave);
    results.push(hitsOf(events).length > 0);
    if (!results.at(-1)) {
      assert.deepEqual(events.at(-1), { type: "planCancelled", characterId: A, action: 0, reason: "not ready" });
    }
    state = newState;
  }
  assert.deepEqual(results, [true, false, false, false, false, true, false]);
});

test("while cleave is on cooldown, the plan check says when it is ready", () => {
  let state = turn(game(), cleave).newState;
  assert.equal(abilityProblem(a(state), "cleave", []), "Ready in 5 turns");
  assert.match(planAbilityProblem(state, A, [cleave])!, /ready in 5 turns/);
  for (let i = 0; i < 4; i++) state = turn(state).newState;
  assert.equal(planAbilityProblem(state, A, [cleave]), undefined);
});

test("a cleave with cooldown upgrades starts the shorter cooldown", () => {
  const { events } = turn(game({ abilityUpgrades: { cleave: { cooldown: 2 } } }), cleave);
  assert.deepEqual(events.find((e) => e.type === "cooldownStarted"), {
    type: "cooldownStarted",
    characterId: A,
    ability: "cleave",
    turns: 2,
  });
});

// --- Follow-up plans ---

test("after a cleave there is no follow-up plan, also when an attack came before it", () => {
  const state = withAdjacent(game({ actions: 2, monsterHp: 3 }), 2);
  const { newState, events } = turn(state, attack0, cleave);
  assert.equal(followUpPlan(newState, A, events), null);
});

// --- Preview ---

test("the preview matches what happens, and shows whom the cleave hits", () => {
  const state = withAdjacent(game({ monsterHp: 1 }), 3);
  const plans = new Map<CharacterId, Plan>([[A, [cleave]]]);
  const preview = previewCycle(state, [A, B], plans);
  const { events } = resolveTurn(state, A, plans);
  assert.deepEqual(preview.turns[0], { characterId: A, events });
  assert.deepEqual(preview.cancellations, []);
  assert.deepEqual(
    preview.cleaves.get(A),
    [0, 1, 2].map((id) => ({ monsterId: id, at: AROUND[id]! })),
  );
});

test("the preview's cleave hits a monster that steps next to the character before its turn", () => {
  // Monster 6 acts in B's turn, which comes first: it steps next to A.
  const state = withAdjacent(game({ monstersOf: new Map([[6, B]]) }), 0);
  const plans = new Map<CharacterId, Plan>([[A, [cleave]]]);
  const preview = previewCycle(state, [B, A], plans);
  const moved = preview.turns[0]!.events.find((e) => e.type === "moved")!;
  assert.equal(moved.type === "moved" && distance(moved.to, CENTRE), 1);
  assert.deepEqual(preview.cleaves.get(A), [{ monsterId: 6, at: moved.type === "moved" ? moved.to : CENTRE }]);
  assert.deepEqual(preview.cancellations, []);

  // And the turns, fired one after the other, do the same.
  const afterB = resolveTurn(state, B, plans).newState;
  assert.deepEqual(hitsOf(resolveTurn(afterB, A, plans).events), [6]);
});

test("the preview shows a cleave without adjacent monsters as cancelled", () => {
  const preview = previewCycle(withAdjacent(game(), 0), [A, B], new Map([[A, [cleave]]]));
  assert.deepEqual(preview.cancellations, [
    { type: "planCancelled", characterId: A, action: 0, reason: "no monster adjacent" },
  ]);
  assert.equal(preview.cleaves.get(A), undefined);
});
