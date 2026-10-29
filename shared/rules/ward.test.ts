import { test } from "node:test";
import assert from "node:assert/strict";
import { abilitiesOf, abilityStats, planAbilityProblem } from "./abilities.ts";
import { baseStats } from "./classes.ts";
import type { DungeonMap } from "./dungeon-map.ts";
import { applyEvents } from "./events.ts";
import type { CharacterId, GameState, MonsterId } from "./game-state.ts";
import { fromOffset, hex, rectangle, type Hex } from "./hex.ts";
import { previewCycle } from "./preview.ts";
import { createTrack } from "./track.ts";
import { followUpPlan, newGameState, resolveTurn, type Plan, type PlannedAction } from "./turn.ts";
import { abilityUpgradeCost } from "./upgrades.ts";

const H = 1;
const A = 2;
const T = 3;
const CENTRE = fromOffset(4, 4);
const at = (dq: number, dr: number): Hex => hex(CENTRE.q + dq, CENTRE.r + dr);
const down = (steps: number) => at(0, steps);
const up = (steps: number) => at(0, -steps);

const ward = (target: CharacterId): PlannedAction => ({ type: "ward", target });

/**
 * A rank 3 healer in the middle of a 9 by 9 room, an adventurer A right
 * below it and a rank 4 tank T (block, protect) right above it. A brute
 * (3 damage) stands below A and acts after A.
 */
function game({ tankAt = up(1) }: { tankAt?: Hex } = {}): GameState {
  const map: DungeonMap = {
    hexes: rectangle(9, 9),
    startHexes: [fromOffset(8, 0)],
    doors: [],
    monsters: [{ type: "brute", position: down(2) }],
  };
  const state = newGameState(
    map,
    [
      { id: H, stats: baseStats("healer"), abilities: abilitiesOf("healer", 3), classId: "healer" },
      { id: A, stats: { ...baseStats("adventurer"), hitPoints: 20 } },
      { id: T, stats: { ...baseStats("tank"), actions: 2 }, abilities: abilitiesOf("tank", 4), classId: "tank" },
    ],
    createTrack([H, A, T], new Map<MonsterId, CharacterId>([[0, A]])),
  );
  const positions: Record<CharacterId, Hex> = { [H]: CENTRE, [A]: down(1), [T]: tankAt };
  return { ...state, characters: state.characters.map((c) => ({ ...c, position: positions[c.id]! })) };
}

function turn(state: GameState, who: CharacterId, ...plan: Plan) {
  const result = resolveTurn(state, who, new Map<CharacterId, Plan>([[who, plan]]));
  assert.deepEqual(applyEvents(state, result.events), result.newState, "replaying the events");
  return result;
}

const of = (state: GameState, id: CharacterId) => state.characters.find((c) => c.id === id)!;
const brute = { kind: "monster", id: 0 } as const;

test("a rank 3 healer has ward: a shield of healing power × 2, cooldown 4", () => {
  assert.deepEqual(abilitiesOf("healer", 3), ["healingTouch", "renew", "ward"]);
  assert.deepEqual(abilityStats("ward", baseStats("healer")).map((r) => r.value), [
    "6 damage (healing power × 2)",
    "until the start of the healer's next turn",
    "4 turns",
  ]);
  assert.deepEqual([1, 2, 3].map((n) => abilityUpgradeCost("ward", "cooldown", n)), [10, 40, 90]);
});

test("ward gives the target a shield, also at full hit points", () => {
  const { events, newState } = turn(game(), H, ward(A));
  assert.deepEqual(events, [
    { type: "warded", characterId: H, targetId: A, shield: 6 },
    { type: "cooldownStarted", characterId: H, ability: "ward", turns: 4 },
  ]);
  assert.deepEqual(of(newState, A).ward, { by: H, shield: 6 });
  assert.equal(followUpPlan(newState, H, events), null);
});

test("an attack on the warded character hits the shield first", () => {
  const warded = turn(game(), H, ward(A)).newState;
  const { events, newState } = turn(warded, A);
  assert.deepEqual(events[0], { type: "attacked", attacker: brute, target: { kind: "character", id: A }, damage: 0, absorbed: 3 });
  assert.equal(of(newState, A).hp, 20);
  assert.deepEqual(of(newState, A).ward, { by: H, shield: 3 });
});

test("damage the shield can't take goes to the hit points, and a used-up shield ends the ward", () => {
  let state = turn(game(), H, ward(A)).newState;
  state = { ...state, characters: state.characters.map((c) => (c.id === A ? { ...c, ward: { by: H, shield: 2 } } : c)) };
  const { events, newState } = turn(state, A);
  assert.deepEqual(events[0], { type: "attacked", attacker: brute, target: { kind: "character", id: A }, damage: 1, absorbed: 2 });
  assert.equal(of(newState, A).hp, 19);
  assert.equal(of(newState, A).ward, undefined);
});

test("the ward ends at the start of the healer's next turn", () => {
  const warded = turn(game(), H, ward(A)).newState;
  const { events, newState } = turn(warded, H);
  assert.deepEqual(events.slice(0, 2), [
    { type: "cooldownsAdvanced", characterId: H },
    { type: "wardEnded", characterId: A },
  ]);
  assert.equal(of(newState, A).ward, undefined);
});

test("wards don't stack: a new ward replaces the old one with a full shield", () => {
  let state = turn(game(), H, ward(A)).newState;
  state = turn(state, A).newState; // the brute takes 3 off the shield
  assert.equal(of(state, A).ward!.shield, 3);
  const ready = { ...state, characters: state.characters.map((c) => (c.id === H ? { ...c, cooldowns: {} } : c)) };
  const after = turn(ready, H, ward(A)).newState;
  assert.deepEqual(of(after, A).ward, { by: H, shield: 6 });
});

test("block takes off its damage first, and the shield takes the rest", () => {
  // The brute next to the tank instead.
  const state = game({ tankAt: down(1) });
  const moved = {
    ...state,
    characters: state.characters.map((c) => (c.id === A ? { ...c, position: up(1) } : c)),
    track: createTrack([H, A, T], new Map<MonsterId, CharacterId>([[0, T]])),
  };
  const warded = turn(moved, H, ward(T)).newState;
  const { events } = turn(warded, T);
  const hit = events.find((e) => e.type === "attacked")!;
  assert.deepEqual(hit, { type: "attacked", attacker: brute, target: { kind: "character", id: T }, damage: 0, blocked: 1, absorbed: 2 });
  assert.equal(of(turn(warded, T).newState, T).ward!.shield, 4);
});

test("an attack that protect redirects to the tank uses the tank's shield, not the ally's", () => {
  // The tank stands next to A and protects it; only A is warded.
  const state = game({ tankAt: at(1, 0) });
  let s = turn(state, T, { type: "protect", target: down(1) }).newState;
  s = turn(s, H, ward(A)).newState;
  const { events, newState } = turn(s, A);
  const hit = events.find((e) => e.type === "attacked")!;
  assert.deepEqual(hit, {
    type: "attacked",
    attacker: brute,
    target: { kind: "character", id: T },
    damage: 2,
    blocked: 1,
    protecting: A,
  });
  // A's shield is untouched.
  assert.deepEqual(of(newState, A).ward, { by: H, shield: 6 });
});

test("the preview and its steps show the absorbed damage", () => {
  const warded = turn(game(), H, ward(A)).newState;
  const preview = previewCycle(warded, [A], new Map());
  const p = preview.monsters.get(0)!;
  assert.equal(p.type, "acts");
  if (p.type === "acts") assert.deepEqual(p.steps[0], { type: "attack", target: A, targetAt: down(1), damage: 0, absorbed: 3, kills: false });
});

test("ward is cancelled when the target isn't next to the healer or is dead; the server checks the same", () => {
  const far = game();
  far.characters[1] = { ...far.characters[1]!, position: down(3) };
  assert.deepEqual(turn(far, H, ward(A)).events, [{ type: "planCancelled", characterId: H, action: 0, reason: "not a neighbour" }]);
  assert.equal(planAbilityProblem(far, H, [ward(A)]), "Ward can't be planned: the target isn't next to the character.");
  assert.equal(planAbilityProblem(game(), H, [ward(H)]), undefined);
  const dead = game();
  dead.characters[1] = { ...dead.characters[1]!, hp: 0 };
  assert.deepEqual(turn(dead, H, ward(A)).events, [{ type: "planCancelled", characterId: H, action: 0, reason: "no ally" }]);
});

test("a dead character loses its ward, and a dead healer's wards end", () => {
  const warded = turn(game(), H, ward(A)).newState;
  const healerDied = applyEvents(warded, [{ type: "died", who: { kind: "character", id: H } }]);
  assert.equal(of(healerDied, A).ward, undefined);
  const allyDied = applyEvents(warded, [{ type: "died", who: { kind: "character", id: A } }]);
  assert.equal(of(allyDied, A).ward, undefined);
});
