import { test } from "node:test";
import assert from "node:assert/strict";
import { abilitiesOf, abilityCooldown, abilityStats, planAbilityProblem, type AbilityUpgradeCounts } from "./abilities.ts";
import { baseStats } from "./classes.ts";
import type { DungeonMap } from "./dungeon-map.ts";
import { applyEvents, type GameEvent } from "./events.ts";
import type { CharacterId, GameState } from "./game-state.ts";
import { fromOffset, hex, rectangle, type Hex } from "./hex.ts";
import { previewCycle } from "./preview.ts";
import type { MonsterTypeId } from "./stats.ts";
import { followUpPlan, newGameState, resolveTurn, type Plan, type PlannedAction } from "./turn.ts";
import { abilityUpgradeCost } from "./upgrades.ts";

const R = 1;
const A = 2;

/** Where the ranger stands: the middle of a 13 by 13 room. */
const CENTRE = fromOffset(6, 6);
const up = (steps: number): Hex => hex(CENTRE.q, CENTRE.r - steps);
const down = (steps: number): Hex => hex(CENTRE.q, CENTRE.r + steps);

const pin = (target: Hex): PlannedAction => ({ type: "pinningShot", target });
const attack = (target: Hex): PlannedAction => ({ type: "attack", target });

/**
 * A ranger of `rank` in the middle of the room, with the monsters given; A,
 * an adventurer, stands at `aAt` (off the map without it). The monsters act
 * after A.
 */
function game({
  monsters,
  rank = 2,
  actions = 1,
  attackDamage = 1,
  abilityUpgrades = {},
  aAt = null,
}: {
  monsters: [MonsterTypeId, Hex][];
  rank?: number;
  actions?: number;
  attackDamage?: number;
  abilityUpgrades?: AbilityUpgradeCounts;
  aAt?: Hex | null;
}): GameState {
  const map: DungeonMap = {
    hexes: rectangle(13, 13),
    startHexes: [fromOffset(12, 12)],
    doors: [],
    monsters: monsters.map(([type, position]) => ({ type, position })),
  };
  const state = newGameState(
    map,
    [
      {
        id: R,
        stats: { ...baseStats("ranger"), actions, attackDamage },
        abilities: abilitiesOf("ranger", rank),
        abilityUpgrades,
        classId: "ranger",
      },
      { id: A, stats: baseStats("adventurer"), classId: "adventurer" },
    ],
    [
      { characterId: R, monsterIds: [] },
      { characterId: A, monsterIds: monsters.map((_, i) => i) },
    ],
  );
  const at = new Map<CharacterId, Hex | null>([
    [R, CENTRE],
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

const ranger = (state: GameState) => state.characters.find((c) => c.id === R)!;
const monster = (state: GameState, id: number) => state.monsters.find((m) => m.id === id)!;
const cancelled = (events: readonly GameEvent[]) => events.flatMap((e) => (e.type === "planCancelled" ? [e.reason] : []));

test("a rank 2 ranger has pinning shot: 1 action, cooldown 4; a rank 1 ranger has no abilities", () => {
  assert.deepEqual(abilitiesOf("ranger", 1), []);
  assert.deepEqual(abilitiesOf("ranger", 2), ["pinningShot"]);
  assert.equal(abilityCooldown("pinningShot", {}), 4);
});

test("a pinning shot hits for the attack damage and freezes the monster; it is alerted", () => {
  const state = game({ monsters: [["guard", up(3)]], attackDamage: 2 });
  assert.ok(monster(state, 0).asleep);
  const { newState, events } = turn(state, R, pin(up(3)));
  assert.deepEqual(events, [
    { type: "attacked", attacker: { kind: "character", id: R }, target: { kind: "monster", id: 0 }, damage: 2, ability: "pinningShot" },
    { type: "cooldownStarted", characterId: R, ability: "pinningShot", turns: 4 },
    { type: "monstersWoke", monsterIds: [0] },
    { type: "frozen", characterId: R, monsterIds: [0], ability: "pinningShot" },
  ]);
  assert.equal(monster(newState, 0).frozen, true);
  assert.equal(monster(newState, 0).hp, 13);
});

test("a pinned monster can't move on its next turn, but still attacks; a killed one isn't frozen", () => {
  // A brute 2 hexes away, A right next to it: frozen, it attacks A without moving.
  const state = game({ monsters: [["brute", up(2)]], aAt: up(3) });
  const pinned = turn(state, R, pin(up(2))).newState;
  const { newState, events } = turn(pinned, A);
  assert.ok(events.some((e) => e.type === "attacked" && e.attacker.kind === "monster"));
  assert.deepEqual(monster(newState, 0).position, up(2));
  assert.equal(monster(newState, 0).frozen, undefined);
  // A basic monster with 3 hit points, killed by the shot: no freeze.
  const killed = turn(game({ monsters: [["basic", up(2)]], attackDamage: 3 }), R, pin(up(2)));
  assert.ok(!killed.events.some((e) => e.type === "frozen"));
});

test("pinning follows frost wave's freezing rules: no stacking, and a stun wins", () => {
  const state = game({ monsters: [["brute", up(2)]], aAt: down(5) });
  const frozen: GameState = { ...state, monsters: state.monsters.map((m) => ({ ...m, frozen: true as const })) };
  const again = turn(frozen, R, pin(up(2))).newState;
  const after = turn(again, A);
  assert.equal(after.events.filter((e) => e.type === "thawed").length, 1);
  assert.equal(monster(after.newState, 0).frozen, undefined);
  const both: GameState = { ...again, monsters: again.monsters.map((m) => ({ ...m, stunned: true })) };
  const skipped = turn(both, A);
  assert.deepEqual(skipped.events, [{ type: "turnSkipped", monsterId: 0 }]);
  assert.equal(monster(skipped.newState, 0).frozen, undefined);
});

test("a pinning shot is cancelled like a normal shot, and then doesn't start the cooldown", () => {
  const cases: [Hex, [MonsterTypeId, Hex][], string][] = [
    [up(1), [["brute", up(1)]], "too close"],
    [up(4), [["brute", up(4)]], "out of range"],
    [up(3), [["brute", up(2)], ["brute", up(3)]], "out of sight"],
    [up(2), [["brute", up(5)]], "target gone"],
  ];
  for (const [target, monsters, reason] of cases) {
    const { newState, events } = turn(game({ monsters }), R, pin(target));
    assert.deepEqual(cancelled(events), [reason], reason);
    assert.deepEqual(ranger(newState).cooldowns, {});
  }
});

test("a pinning shot counts as an attack: shots at the monster follow", () => {
  const state = game({ monsters: [["brute", up(3)]], actions: 2 });
  const { newState, events } = turn(state, R, pin(up(3)), attack(up(3)));
  assert.deepEqual(followUpPlan(newState, R, events), [attack(up(3)), attack(up(3))]);
  const only = turn(game({ monsters: [["brute", up(3)]] }), R, pin(up(3)));
  assert.deepEqual(followUpPlan(only.newState, R, only.events), [attack(up(3))]);
});

test("the preview shows the pinned monster attacking without moving", () => {
  const state = game({ monsters: [["brute", up(2)]], aAt: up(3) });
  const preview = previewCycle(state, [R, A], new Map([[R, [pin(up(2))]]]));
  const brute = preview.monsters.get(0)!;
  assert.equal(brute.type, "acts");
  assert.ok(brute.type === "acts" && brute.steps.every((s) => s.type === "attack"));
});

test("the server checks the rank, the cooldown, at most one per plan and the range", () => {
  const state = game({ monsters: [["brute", up(3)]], actions: 2 });
  assert.equal(planAbilityProblem(state, R, [pin(up(3))]), undefined);
  // Out of sight or empty now is fine: that may change before the turn fires.
  assert.equal(planAbilityProblem(state, R, [pin(down(2))]), undefined);
  assert.equal(planAbilityProblem(state, R, [pin(up(1))]), "Pinning shot can't be planned: the hex isn't 2 to 3 hexes away.");
  assert.equal(planAbilityProblem(state, R, [pin(up(10))]), "Pinning shot can't be planned: the hex isn't 2 to 3 hexes away.");
  assert.equal(planAbilityProblem(state, R, [pin(up(3)), pin(up(3))]), "Pinning shot can't be planned: already planned.");
  // From where a move leaves the ranger: one down, up 3 is 4 away.
  assert.equal(
    planAbilityProblem(state, R, [{ type: "move", to: down(1) }, pin(up(3))]),
    "Pinning shot can't be planned: the hex isn't 2 to 3 hexes away.",
  );
  assert.equal(
    planAbilityProblem(game({ monsters: [], rank: 1 }), R, [pin(up(3))]),
    "Pinning shot can't be planned: needs a higher rank.",
  );
  const after = turn(state, R, pin(up(3))).newState;
  assert.equal(planAbilityProblem(after, R, [pin(up(3))]), "Pinning shot can't be planned: ready in 5 turns.");
});

test("only its cooldown can be upgraded, like heavy strike's", () => {
  assert.deepEqual(
    [1, 2, 3].map((n) => abilityUpgradeCost("pinningShot", "cooldown", n)),
    [10, 40, 90],
  );
  assert.equal(abilityUpgradeCost("pinningShot", "cooldown", 4), undefined);
  assert.equal(abilityCooldown("pinningShot", { pinningShot: { cooldown: 3 } }), 1);
  assert.deepEqual(
    abilityStats("pinningShot", baseStats("ranger")).map((row) => row.name),
    ["Damage", "Range", "Cooldown"],
  );
  assert.equal(abilityStats("pinningShot", baseStats("ranger"))[1]!.value, "2–3 hexes, in line of sight, as for a shot");
});
