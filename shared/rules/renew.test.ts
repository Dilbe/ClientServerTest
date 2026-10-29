import { test } from "node:test";
import assert from "node:assert/strict";
import { abilitiesOf, abilityStats, planAbilityProblem } from "./abilities.ts";
import { baseStats } from "./classes.ts";
import type { DungeonMap } from "./dungeon-map.ts";
import { applyEvents, type GameEvent } from "./events.ts";
import type { CharacterId, GameState, MonsterId } from "./game-state.ts";
import { fromOffset, hex, rectangle, type Hex } from "./hex.ts";
import { createTrack } from "./track.ts";
import { followUpPlan, newGameState, resolveTurn, type Plan, type PlannedAction } from "./turn.ts";
import { abilityUpgradeCost } from "./upgrades.ts";

const H = 1;
const A = 2;
const T = 3;
const CENTRE = fromOffset(4, 4);
const at = (dq: number, dr: number): Hex => hex(CENTRE.q + dq, CENTRE.r + dr);
const down = (steps: number) => at(0, steps);

const renew = (target: CharacterId): PlannedAction => ({ type: "renew", target });

/**
 * A rank 2 healer in the middle of a 9 by 9 room, an adventurer A right
 * below it and a rank 3 tank T (with regen) right above it. A monster
 * stands in a corner; `monsterAt` and `monsterFollows` put it somewhere
 * else and let it act after that character, and `brute` makes it a brute.
 */
function game({
  hp = {},
  healingPower = 3,
  monsterAt = fromOffset(0, 8),
  monsterFollows,
  brute = false,
}: {
  hp?: Partial<Record<CharacterId, number>>;
  healingPower?: number;
  monsterAt?: Hex;
  monsterFollows?: CharacterId;
  brute?: boolean;
} = {}): GameState {
  const map: DungeonMap = {
    hexes: rectangle(9, 9),
    startHexes: [fromOffset(8, 0)],
    doors: [],
    monsters: [{ type: brute ? "brute" : "basic", position: monsterAt }],
  };
  const state = newGameState(
    map,
    [
      { id: H, stats: { ...baseStats("healer"), healingPower }, abilities: abilitiesOf("healer", 2), classId: "healer" },
      { id: A, stats: baseStats("adventurer") },
      { id: T, stats: baseStats("tank"), abilities: abilitiesOf("tank", 3), classId: "tank" },
    ],
    createTrack([H, A, T], new Map<MonsterId, CharacterId>(monsterFollows === undefined ? [] : [[0, monsterFollows]])),
  );
  const positions: Record<CharacterId, Hex> = { [H]: CENTRE, [A]: down(1), [T]: at(0, -1) };
  return {
    ...state,
    characters: state.characters.map((c) => ({ ...c, position: positions[c.id]!, hp: hp[c.id] ?? c.hp })),
  };
}

function turn(state: GameState, who: CharacterId, ...plan: Plan) {
  const result = resolveTurn(state, who, new Map<CharacterId, Plan>([[who, plan]]));
  assert.deepEqual(applyEvents(state, result.events), result.newState, "replaying the events");
  return result;
}

const of = (state: GameState, id: CharacterId) => state.characters.find((c) => c.id === id)!;

test("a rank 2 healer has renew: cooldown 4, for healing power + 3 turns", () => {
  assert.deepEqual(abilitiesOf("healer", 2), ["healingTouch", "renew"]);
  assert.deepEqual(abilityStats("renew", baseStats("healer")).map((r) => r.value), [
    "1 hit point at the start of each of the character's turns",
    "6 turns (healing power + 3)",
    "4 turns",
  ]);
});

test("renew heals its target 1 hit point at the start of each of its next turns, for healing power + 3 turns", () => {
  let state = turn(game({ hp: { [A]: 1 } }), H, renew(A)).newState;
  assert.equal(of(state, A).renewTurns, 6);
  const healed: GameEvent[] = [];
  for (let i = 0; i < 7; i++) {
    const result = turn(state, A);
    healed.push(...result.events);
    state = result.newState;
  }
  assert.deepEqual(
    healed,
    Array.from({ length: 6 }, () => ({ type: "renewHealed", characterId: A, healed: 1 })),
  );
  assert.equal(of(state, A).hp, 7);
  assert.equal(of(state, A).renewTurns, 0);
});

test("the healing power when it is cast counts; renewing again sets the count back to full, without stacking", () => {
  assert.equal(of(turn(game({ healingPower: 5 }), H, renew(A)).newState, A).renewTurns, 8);
  let state = turn(game({ hp: { [A]: 1 } }), H, renew(A)).newState;
  state = turn(state, A).newState;
  state = turn(state, A).newState;
  assert.equal(of(state, A).renewTurns, 4);
  // The cooldown is over after 4 of the healer's turns.
  for (let i = 0; i < 4; i++) state = turn(state, H).newState;
  state = turn(state, H, renew(A)).newState;
  assert.equal(of(state, A).renewTurns, 6);
  const { events } = turn(state, A);
  assert.deepEqual(events, [{ type: "renewHealed", characterId: A, healed: 1 }]);
});

test("renew never heals above the max hit points, and isn't cancelled at full hit points", () => {
  const { events, newState } = turn(game(), H, renew(A));
  assert.deepEqual(events, [
    { type: "renewStarted", characterId: H, targetId: A, turns: 6 },
    { type: "cooldownStarted", characterId: H, ability: "renew", turns: 4 },
  ]);
  assert.equal(followUpPlan(newState, H, events), null);
  const atFull = turn(newState, A);
  assert.deepEqual(atFull.events, [{ type: "renewHealed", characterId: A, healed: 0 }]);
  assert.equal(of(atFull.newState, A).hp, 10);
  assert.equal(of(atFull.newState, A).renewTurns, 5);
});

test("the healer can renew itself", () => {
  const state = turn(game({ hp: { [H]: 3 } }), H, renew(H)).newState;
  assert.equal(turn(state, H).events[0]!.type, "cooldownsAdvanced");
  assert.equal(of(turn(state, H).newState, H).hp, 4);
});

test("renew is cancelled when the target isn't next to the healer or is dead", () => {
  const far = game();
  far.characters[1] = { ...far.characters[1]!, position: down(2) };
  assert.deepEqual(turn(far, H, renew(A)).events, [{ type: "planCancelled", characterId: H, action: 0, reason: "not a neighbour" }]);
  assert.deepEqual(turn(game({ hp: { [A]: 0 } }), H, renew(A)).events, [
    { type: "planCancelled", characterId: H, action: 0, reason: "no ally" },
  ]);
});

test("dying ends renew", () => {
  // A brute next to A hits it for 3 on A's turn, after renew healed it from 2 to 3.
  const state = turn(game({ hp: { [A]: 2 }, monsterAt: down(2), monsterFollows: A, brute: true }), H, renew(A)).newState;
  const { events, newState } = turn(state, A);
  assert.deepEqual(
    events.map((e) => e.type),
    ["renewHealed", "attacked", "died"],
  );
  assert.equal(of(newState, A).hp, 0);
  assert.equal(of(newState, A).renewTurns, 0);
});

test("renew works next to a tank's regen: both heal", () => {
  let state = turn(game({ hp: { [T]: 10 } }), H, renew(T)).newState;
  state = { ...state, characters: state.characters.map((c) => (c.id === T ? { ...c, regenTurns: 5 } : c)) };
  const { events, newState } = turn(state, T);
  assert.deepEqual(
    events.filter((e) => e.type === "regenerated" || e.type === "renewHealed"),
    [
      { type: "regenerated", characterId: T, healed: 1 },
      { type: "renewHealed", characterId: T, healed: 1 },
    ],
  );
  assert.equal(of(newState, T).hp, 12);
});

test("the server checks renew's rank, cooldown and target", () => {
  assert.equal(planAbilityProblem(game(), H, [renew(A)]), undefined);
  assert.equal(planAbilityProblem(game(), H, [renew(H)]), undefined);
  const far = game();
  far.characters[1] = { ...far.characters[1]!, position: down(2) };
  assert.equal(planAbilityProblem(far, H, [renew(A)]), "Renew can't be planned: the target isn't next to the character.");
  const rank1 = game();
  rank1.characters[0] = { ...rank1.characters[0]!, abilities: abilitiesOf("healer", 1) };
  assert.equal(planAbilityProblem(rank1, H, [renew(A)]), "Renew can't be planned: needs a higher rank.");
  const used = turn(game(), H, renew(A)).newState;
  assert.equal(planAbilityProblem(used, H, [renew(A)]), "Renew can't be planned: ready in 5 turns.");
});

test("renew's only upgrade is its cooldown: 10, 40, 90, down to 1", () => {
  assert.deepEqual([1, 2, 3].map((n) => abilityUpgradeCost("renew", "cooldown", n)), [10, 40, 90]);
  assert.equal(abilityUpgradeCost("renew", "cooldown", 4), undefined);
});
