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
import { baseStats } from "./classes.ts";
import type { DungeonMap } from "./dungeon-map.ts";
import { applyEvents, type GameEvent } from "./events.ts";
import type { CharacterId, GameState, MonsterId } from "./game-state.ts";
import { distance, fromOffset, hexEquals, hexesBetween, hexKey, neighbours, rectangle } from "./hex.ts";
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
/** Monster 3: 3 hexes above the tank, out of reach of a taunt without range upgrades. */
const M3 = fromOffset(4, 1);
/** Next to monster 0, not the tank's hex. */
const A_AT = neighbours(M0).find((h) => !hexEquals(h, CENTRE) && !neighbours(CENTRE).some((n) => hexEquals(n, h)))!;

/**
 * One room of 9 by 9 hexes. Monster 0 is a basic monster next to the tank
 * and to A, monster 1 a guard (on guard) next to the tank, monster 2 an
 * archer next to the tank, which can also see A. Monster 3 is a basic
 * monster 3 hexes from the tank.
 */
const MAP: DungeonMap = {
  hexes: rectangle(9, 9),
  startHexes: [fromOffset(8, 8)],
  doors: [],
  monsters: [
    { type: "basic", position: M0 },
    { type: "guard", position: neighbours(CENTRE)[1]! },
    { type: "archer", position: neighbours(CENTRE)[5]! },
    { type: "basic", position: M3 },
  ],
};

const taunt: PlannedAction = { type: "taunt" };

/**
 * The tank in the middle, A next to monster 0, U off the map. `monsters`
 * says which monsters follow which character on the track; the others never act.
 */
function game({
  abilities = abilitiesOf("tank", 7),
  abilityUpgrades = {},
  actions = 1,
  monsters = {},
  map = MAP,
}: {
  abilities?: readonly AbilityId[];
  abilityUpgrades?: AbilityUpgradeCounts;
  actions?: number;
  monsters?: Partial<Record<CharacterId, MonsterId[]>>;
  map?: DungeonMap;
} = {}): GameState {
  const state = newGameState(
    map,
    [
      { id: T, stats: { ...baseStats("tank"), actions }, abilities, abilityUpgrades },
      { id: A, stats: baseStats("adventurer") },
      { id: U, stats: baseStats("tank"), abilities: abilitiesOf("tank", 7) },
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

/** The `taunted` events in these events: which monsters a taunt reached. */
function tauntedIds(events: readonly GameEvent[]): MonsterId[] {
  return events.flatMap((e) => (e.type === "taunted" ? [e.monsterId] : []));
}

// --- Who has it ---

test("a tank gets taunt at rank 7, with a range of 1 and no cooldown", () => {
  assert.deepEqual(abilitiesOf("tank", 6), ["block"]);
  assert.deepEqual(abilitiesOf("tank", 7), ["block", "taunt"]);
  assert.deepEqual(abilityStats("taunt", baseStats("tank")), [
    { name: "Effect", value: "every monster in range goes after the character on its next turn" },
    { name: "Range", value: "1 hex, in line of sight", upgrade: "range" },
  ]);
  assert.deepEqual(abilityStats("taunt", baseStats("tank"), { taunt: { range: 4 } })[1], {
    name: "Range",
    value: "5 hexes, in line of sight",
    upgrade: "range",
  });
  const rank6 = game({ abilities: abilitiesOf("tank", 6) });
  assert.equal(planAbilityProblem(rank6, T, [taunt]), "Taunt can't be planned: needs a higher rank.");
  assert.deepEqual(turn(rank6, T, taunt).events, [{ type: "planCancelled", characterId: T, action: 0, reason: "no ability" }]);
});

// --- What it does ---

test("a taunt reaches every monster next to the tank, and wakes the one on guard", () => {
  const state = game();
  assert.ok(monster(state, 1).asleep);
  assert.equal(distance(CENTRE, M3), 3);
  const { newState, events } = turn(state, T, taunt);
  // No cooldown: it can be used again on the next turn.
  assert.deepEqual(events.slice(0, 4), [
    { type: "taunted", characterId: T, monsterId: 0 },
    { type: "taunted", characterId: T, monsterId: 1 },
    { type: "taunted", characterId: T, monsterId: 2 },
    { type: "monstersWoke", monsterIds: [1] },
  ]);
  assert.equal(monster(newState, 3).tauntedBy, undefined);
  assert.deepEqual(newState.characters[0]!.cooldowns, {});
  assert.equal(abilityProblem(newState.characters[0]!, "taunt", []), undefined);
});

test("each range upgrade reaches one hex further", () => {
  const twice = turn(game({ abilityUpgrades: { taunt: { range: 1 } } }), T, taunt);
  assert.deepEqual(tauntedIds(twice.events), [0, 1, 2]);
  const thrice = turn(game({ abilityUpgrades: { taunt: { range: 2 } } }), T, taunt);
  assert.deepEqual(tauntedIds(thrice.events), [0, 1, 2, 3]);
  assert.equal(monster(thrice.newState, 3).tauntedBy, T);
});

test("a taunt doesn't reach a monster behind a wall or pillar", () => {
  // Pillars on every hex between the tank and monster 3.
  const between = new Set(hexesBetween(CENTRE, M3).flat().map(hexKey));
  const map = { ...MAP, hexes: MAP.hexes.filter((h) => !between.has(hexKey(h))) };
  assert.ok(map.hexes.some((h) => hexEquals(h, M3)) && map.hexes.length < MAP.hexes.length);
  const { events } = turn(game({ map, abilityUpgrades: { taunt: { range: 4 } } }), T, taunt);
  assert.deepEqual(tauntedIds(events), [0, 1, 2]);
});

test("a taunted monster attacks the tank instead of its usual target, then acts as usual again", () => {
  const state = game({ monsters: { [T]: [0] } });
  // Without the taunt it attacks A, who has fewer hit points.
  assert.deepEqual(attackedBy(turn(state, T).events, 0), [A]);

  const { newState, events } = turn(state, T, taunt);
  assert.deepEqual(attackedBy(events, 0), [T]);
  assert.deepEqual(events.at(-1), { type: "tauntEnded", monsterId: 0 });
  // It does no damage itself.
  assert.equal(monster(newState, 0).hp, monster(state, 0).hp);
  assert.equal(monster(newState, 0).tauntedBy, undefined);
  assert.deepEqual(attackedBy(turn(newState, T).events, 0), [A]);
});

test("a taunted monster that follows another character goes after the tank in that character's turn", () => {
  const state = turn(game({ monsters: { [A]: [0] } }), T, taunt).newState;
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

test("a taunted guard goes after the tank", () => {
  const { events } = turn(game({ monsters: { [T]: [1] } }), T, taunt);
  assert.deepEqual(attackedBy(events, 1), [T]);
});

test("a stunned monster that is also taunted just skips its turn, and is no longer taunted after it", () => {
  let state = game({ monsters: { [A]: [0] } });
  state = turn(state, T, taunt).newState;
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
  state = turn(state, T, taunt).newState;
  state = turn(state, U, taunt).newState;
  assert.equal(monster(state, 0).tauntedBy, U);
  assert.deepEqual(attackedBy(turn(state, A).events, 0), [U]);
});

test("a taunt with no living monster in range is cancelled", () => {
  const state = game();
  const gone = { ...state, monsters: state.monsters.map((m) => (m.id === 3 ? m : { ...m, hp: 0 })) };
  const cancelled = turn(gone, T, taunt);
  assert.deepEqual(cancelled.events, [{ type: "planCancelled", characterId: T, action: 0, reason: "no monster in area" }]);
});

// --- Planning ---

test("the server checks at most one taunt per plan; it is ready again on the next turn", () => {
  const state = game({ actions: 2 });
  assert.equal(planAbilityProblem(state, T, [taunt, taunt]), "Taunt can't be planned: already planned.");
  const used = turn(state, T, taunt).newState;
  assert.equal(planAbilityProblem(used, T, [taunt]), undefined);
  assert.deepEqual(tauntedIds(turn(used, T, taunt).events), [0, 1, 2]);
});

test("after a taunt there is no follow-up plan", () => {
  const { newState, events } = turn(game({ actions: 2 }), T, { type: "attack", target: M0 }, taunt);
  assert.equal(followUpPlan(newState, T, events), null);
});

// --- Preview ---

test("the preview shows the monsters a taunt reaches going after the tank, and matches what happens", () => {
  const state = game({ monsters: { [A]: [0] } });
  const plans = new Map<CharacterId, Plan>([[T, [taunt]]]);
  const preview = previewCycle(state, [T, A, U], plans);
  assert.deepEqual(preview.turns[0], { characterId: T, events: resolveTurn(state, T, plans).events });
  assert.deepEqual(preview.areaHits.get(T)?.taunt?.map((hit) => hit.monsterId), [0, 1, 2]);
  const step = preview.monsters.get(0);
  assert.equal(step?.type, "acts");
  const first = step?.type === "acts" ? step.steps[0] : undefined;
  assert.equal(first?.type !== "trap" && first?.target, T);
});
