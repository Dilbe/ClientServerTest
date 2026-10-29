import { test } from "node:test";
import assert from "node:assert/strict";
import { abilitiesOf, abilityProblem, abilityStats, planAbilityProblem, type AbilityId } from "./abilities.ts";
import { baseStats } from "./classes.ts";
import type { DungeonMap } from "./dungeon-map.ts";
import { applyEvents, type GameEvent } from "./events.ts";
import type { CharacterId, GameState, MonsterId } from "./game-state.ts";
import { fromOffset, hexEquals, neighbours, rectangle } from "./hex.ts";
import { decideMonsterAction } from "./monsters.ts";
import { previewCycle } from "./preview.ts";
import { followUpPlan, newGameState, resolveTurn, type Plan, type PlannedAction } from "./turn.ts";

/** The tank. */
const T = 1;
/** An adventurer next to monster 0: with fewer hit points, the monsters' usual target. */
const A = 2;
/** A second tank, off the map unless a test places it. */
const U = 3;

const CENTRE = fromOffset(4, 4);
const M0 = neighbours(CENTRE)[3]!;
/** Next to monster 0, not the tank's hex. */
const A_AT = neighbours(M0).find((h) => !hexEquals(h, CENTRE) && !neighbours(CENTRE).some((n) => hexEquals(n, h)))!;

/**
 * One room of 9 by 9 hexes. Monster 0 is a basic monster next to the tank
 * and to A, monster 1 a guard (on guard) next to the tank, monster 2 an
 * archer next to the tank, which can also see A.
 */
const MAP: DungeonMap = {
  hexes: rectangle(9, 9),
  startHexes: [fromOffset(8, 8)],
  doors: [],
  monsters: [
    { type: "basic", position: M0 },
    { type: "guard", position: neighbours(CENTRE)[1]! },
    { type: "archer", position: neighbours(CENTRE)[5]! },
  ],
};

const taunt = (id: MonsterId): PlannedAction => ({ type: "taunt", target: MAP.monsters[id]!.position });

/**
 * The tank in the middle, A next to monster 0, U off the map. `monsters`
 * says which monsters follow which character on the track; the others never act.
 */
function game({
  abilities = abilitiesOf("tank", 2),
  actions = 1,
  monsters = {},
}: {
  abilities?: readonly AbilityId[];
  actions?: number;
  monsters?: Partial<Record<CharacterId, MonsterId[]>>;
} = {}): GameState {
  const state = newGameState(
    MAP,
    [
      { id: T, stats: { ...baseStats("tank"), actions }, abilities },
      { id: A, stats: baseStats("adventurer") },
      { id: U, stats: baseStats("tank"), abilities: abilitiesOf("tank", 2) },
    ],
    [T, A, U].map((characterId) => ({ characterId, monsterIds: monsters[characterId] ?? [] })),
  );
  const at = new Map([
    [T, CENTRE],
    [A, A_AT],
  ]);
  return { ...state, characters: state.characters.map((c) => ({ ...c, position: at.get(c.id) ?? null })) };
}

/** Resolves one turn, and checks that replaying the events gives the same state. */
function turn(state: GameState, characterId: CharacterId, ...plan: Plan) {
  const plans = new Map<CharacterId, Plan>(plan.length > 0 ? [[characterId, plan]] : []);
  const result = resolveTurn(state, characterId, plans);
  assert.deepEqual(applyEvents(state, result.events), result.newState, "replaying the events");
  return result;
}

function monster(state: GameState, id: MonsterId) {
  return state.monsters.find((m) => m.id === id)!;
}

/** Whom monster `id` attacked in these events. */
function attackedBy(events: readonly GameEvent[], id: MonsterId): CharacterId[] {
  return events.flatMap((e) =>
    e.type === "attacked" && e.attacker.kind === "monster" && e.attacker.id === id ? [e.target.id] : [],
  );
}

/** `state` with monster `id` taunted by `by`, as if a taunt had just been carried out. */
function tauntedBy(state: GameState, id: MonsterId, by: CharacterId): GameState {
  return { ...state, monsters: state.monsters.map((m) => (m.id === id ? { ...m, tauntedBy: by, asleep: false } : m)) };
}

// --- Who has it ---

test("a tank gets taunt at rank 2", () => {
  assert.deepEqual(abilitiesOf("tank", 1), ["block"]);
  assert.deepEqual(abilitiesOf("tank", 2), ["block", "taunt"]);
  assert.deepEqual(abilityStats("taunt", baseStats("tank")), [
    { name: "Effect", value: "the monster goes after the character on its next turn" },
    { name: "Cooldown", value: "4 turns", upgrade: "cooldown" },
  ]);
  const rank1 = game({ abilities: abilitiesOf("tank", 1) });
  assert.equal(planAbilityProblem(rank1, T, [taunt(0)]), "Taunt can't be planned: needs a higher rank.");
  assert.deepEqual(turn(rank1, T, taunt(0)).events, [{ type: "planCancelled", characterId: T, action: 0, reason: "no ability" }]);
});

// --- What it does ---

test("a taunted monster attacks the tank instead of its usual target, then acts as usual again", () => {
  const state = game({ monsters: { [T]: [0] } });
  // Without the taunt it attacks A, who has fewer hit points.
  assert.deepEqual(attackedBy(turn(state, T).events, 0), [A]);

  const { newState, events } = turn(state, T, taunt(0));
  assert.deepEqual(events.slice(0, 2), [
    { type: "taunted", characterId: T, monsterId: 0 },
    { type: "cooldownStarted", characterId: T, ability: "taunt", turns: 4 },
  ]);
  assert.deepEqual(attackedBy(events, 0), [T]);
  assert.deepEqual(events.at(-1), { type: "tauntEnded", monsterId: 0 });
  // It does no damage itself.
  assert.equal(monster(newState, 0).hp, monster(state, 0).hp);
  assert.equal(monster(newState, 0).tauntedBy, undefined);
  assert.deepEqual(attackedBy(turn(newState, T).events, 0), [A]);
});

test("a taunted monster that follows another character goes after the tank in that character's turn", () => {
  const state = turn(game({ monsters: { [A]: [0] } }), T, taunt(0)).newState;
  assert.equal(monster(state, 0).tauntedBy, T);
  const { newState, events } = turn(state, A);
  assert.deepEqual(attackedBy(events, 0), [T]);
  assert.deepEqual(attackedBy(turn(newState, A).events, 0), [A]);
});

test("a taunted archer shoots the tank when it can, and otherwise moves towards it", () => {
  const state = game();
  assert.deepEqual(decideMonsterAction(tauntedBy(state, 2, T), 2), { type: "attack", target: T });
  // The tank far away, out of its range. Without a taunt the archer shoots A,
  // whom it can see now; taunted, it moves towards the tank instead.
  const far = {
    ...state,
    characters: state.characters.map((c) => (c.id === T ? { ...c, position: fromOffset(0, 8) } : c)),
  };
  assert.deepEqual(decideMonsterAction(far, 2), { type: "attack", target: A });
  const action = decideMonsterAction(tauntedBy(far, 2, T), 2);
  assert.equal(action.type, "move");
  assert.equal(action.type === "move" && action.target, T);
});

test("with the tank dead or off the map, a taunted monster uses its usual rules", () => {
  const state = tauntedBy(game(), 0, T);
  const dead = { ...state, characters: state.characters.map((c) => (c.id === T ? { ...c, hp: 0 } : c)) };
  assert.deepEqual(decideMonsterAction(dead, 0), { type: "attack", target: A });
  const off = { ...state, characters: state.characters.map((c) => (c.id === T ? { ...c, position: null } : c)) };
  assert.deepEqual(decideMonsterAction(off, 0), { type: "attack", target: A });
});

test("a taunt wakes a guard, which then goes after the tank", () => {
  const state = game({ monsters: { [T]: [1] } });
  assert.ok(monster(state, 1).asleep);
  const { events } = turn(state, T, taunt(1));
  assert.deepEqual(events.slice(0, 3), [
    { type: "taunted", characterId: T, monsterId: 1 },
    { type: "cooldownStarted", characterId: T, ability: "taunt", turns: 4 },
    { type: "monstersWoke", monsterIds: [1] },
  ]);
  assert.deepEqual(attackedBy(events, 1), [T]);
});

test("a stunned monster that is also taunted just skips its turn, and is no longer taunted after it", () => {
  let state = game({ monsters: { [A]: [0] } });
  state = turn(state, T, taunt(0)).newState;
  state = { ...state, monsters: state.monsters.map((m) => (m.id === 0 ? { ...m, stunned: true } : m)) };
  const { newState, events } = turn(state, A);
  assert.deepEqual(events.at(-1), { type: "turnSkipped", monsterId: 0 });
  assert.deepEqual(attackedBy(events, 0), []);
  assert.equal(monster(newState, 0).tauntedBy, undefined);
});

test("taunts don't stack: the latest taunt counts", () => {
  let state = game({ monsters: { [A]: [0] } });
  // U stands next to monster 0 too.
  const uAt = neighbours(M0).find((h) => !hexEquals(h, CENTRE) && !hexEquals(h, A_AT) && h.q >= 0)!;
  state = { ...state, characters: state.characters.map((c) => (c.id === U ? { ...c, position: uAt } : c)) };
  state = turn(state, T, taunt(0)).newState;
  state = turn(state, U, taunt(0)).newState;
  assert.equal(monster(state, 0).tauntedBy, U);
  assert.deepEqual(attackedBy(turn(state, A).events, 0), [U]);
});

test("a taunt on a hex without a living monster, or not next to the tank, is cancelled without a cooldown", () => {
  const state = game();
  const gone = { ...state, monsters: state.monsters.map((m) => (m.id === 0 ? { ...m, hp: 0 } : m)) };
  const cancelled = turn(gone, T, taunt(0));
  assert.deepEqual(cancelled.events, [{ type: "planCancelled", characterId: T, action: 0, reason: "target gone" }]);
  assert.deepEqual(cancelled.newState.characters[0]!.cooldowns, {});
  assert.deepEqual(turn(state, T, { type: "taunt", target: fromOffset(4, 1) }).events, [
    { type: "planCancelled", characterId: T, action: 0, reason: "not a neighbour" },
  ]);
});

// --- Planning ---

test("the server checks at most one taunt per plan and the cooldown", () => {
  const state = game({ actions: 2 });
  assert.equal(planAbilityProblem(state, T, [taunt(0), taunt(2)]), "Taunt can't be planned: already planned.");
  const used = turn(state, T, taunt(0)).newState;
  assert.equal(abilityProblem(used.characters[0]!, "taunt", []), "Ready in 5 turns");
  assert.equal(planAbilityProblem(used, T, [taunt(0)]), "Taunt can't be planned: ready in 5 turns.");
});

test("after a taunt there is no follow-up plan", () => {
  const { newState, events } = turn(game({ actions: 2 }), T, { type: "attack", target: M0 }, taunt(0));
  assert.equal(followUpPlan(newState, T, events), null);
});

// --- Preview ---

test("the preview shows the taunted monster going after the tank, and matches what happens", () => {
  const state = game({ monsters: { [A]: [0] } });
  const plans = new Map<CharacterId, Plan>([[T, [taunt(0)]]]);
  const preview = previewCycle(state, [T, A, U], plans);
  assert.deepEqual(preview.turns[0], { characterId: T, events: resolveTurn(state, T, plans).events });
  const step = preview.monsters.get(0);
  assert.equal(step?.type, "acts");
  const first = step?.type === "acts" ? step.steps[0] : undefined;
  assert.equal(first?.type !== "trap" && first?.target, T);
});
