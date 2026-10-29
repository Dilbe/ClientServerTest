import { test } from "node:test";
import assert from "node:assert/strict";
import { abilitiesOf, abilityCooldown, abilityStats, planAbilityProblem, type AbilityUpgradeCounts } from "./abilities.ts";
import { baseStats } from "./classes.ts";
import type { DungeonMap } from "./dungeon-map.ts";
import { applyEvents, type GameEvent } from "./events.ts";
import type { CharacterId, GameState } from "./game-state.ts";
import { fromOffset, hex, hexKey, rectangle, type Hex } from "./hex.ts";
import { previewCycle } from "./preview.ts";
import { followUpPlan, newGameState, resolveTurn, type Plan, type PlannedAction } from "./turn.ts";
import { abilityUpgradeCost, nextAbilityUpgradeCost, type Upgrade } from "./upgrades.ts";

const R = 1;
const A = 2;

/** Where the ranger stands: the middle of a 13 by 13 room, with a pillar 2 hexes down. */
const CENTRE = fromOffset(6, 6);
const up = (steps: number): Hex => hex(CENTRE.q, CENTRE.r - steps);
const down = (steps: number): Hex => hex(CENTRE.q, CENTRE.r + steps);
const PILLAR = down(2);

const volley = (target: Hex): PlannedAction => ({ type: "volley", target });

/** A ranger of `rank` in the middle, basic monsters (3 hit points) on the given hexes, A at `aAt`; the monsters never act. */
function game({
  monsters,
  rank = 5,
  attackDamage = 1,
  actions = 1,
  abilityUpgrades = {},
  aAt = null,
}: {
  monsters: Hex[];
  rank?: number;
  attackDamage?: number;
  actions?: number;
  abilityUpgrades?: AbilityUpgradeCounts;
  aAt?: Hex | null;
}): GameState {
  const map: DungeonMap = {
    hexes: rectangle(13, 13).filter((h) => hexKey(h) !== hexKey(PILLAR)),
    startHexes: [fromOffset(12, 12)],
    doors: [],
    monsters: monsters.map((position) => ({ type: "basic", position })),
  };
  const state = newGameState(
    map,
    [
      {
        id: R,
        stats: { ...baseStats("ranger"), attackDamage, actions },
        abilities: abilitiesOf("ranger", rank),
        abilityUpgrades,
        classId: "ranger",
      },
      { id: A, stats: baseStats("adventurer"), classId: "adventurer" },
    ],
    [
      { characterId: R, monsterIds: [] },
      { characterId: A, monsterIds: [] },
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
const hp = (state: GameState) => state.monsters.map((m) => m.hp);
const cancelled = (events: readonly GameEvent[]) => events.flatMap((e) => (e.type === "planCancelled" ? [e.reason] : []));

test("a rank 5 ranger has volley: 1 action, cooldown 6, no charges", () => {
  assert.ok(!abilitiesOf("ranger", 4).includes("volley"));
  assert.deepEqual(abilitiesOf("ranger", 5), ["pinningShot", "piercingShot", "trap", "volley"]);
  assert.equal(abilityCooldown("volley", {}), 6);
  assert.equal(ranger(game({ monsters: [] })).spellCharges, undefined);
});

test("it hits every monster on the hex and the 6 around it at once, also next to the ranger; kills give XP", () => {
  // Aimed 2 hexes away, up and to the right: up 1, next to the ranger, and
  // up 2 are in the area; up 4 isn't. The line runs along the border of up 1
  // and its neighbour, which is free, so it gets through.
  const target = hex(CENTRE.q + 1, CENTRE.r - 2);
  const state = game({ monsters: [up(1), up(2), target, up(4)], attackDamage: 3 });
  const { newState, events } = turn(state, R, volley(target));
  const hits = events.flatMap((e) => (e.type === "attacked" ? [e.target.id] : []));
  assert.deepEqual(hits, [0, 1, 2]);
  assert.ok(events.every((e) => e.type !== "attacked" || e.ability === "volley"));
  assert.deepEqual(hp(newState), [0, 0, 0, 3]);
  assert.ok(events.some((e) => e.type === "xpGained"));
  assert.ok(events.some((e) => e.type === "cooldownStarted" && e.ability === "volley" && e.turns === 6));
  // No follow-up plan.
  const hurt = turn(game({ monsters: [up(2)] }), R, volley(up(2)));
  assert.equal(followUpPlan(hurt.newState, R, hurt.events), null);
});

test("the target hex doesn't need a monster on it, and characters in the area take no damage", () => {
  const { newState } = turn(game({ monsters: [up(4)], aAt: up(2) }), R, volley(up(3)));
  assert.deepEqual(hp(newState), [2]);
  assert.equal(newState.characters[1]!.hp, 10);
});

test("it needs line of sight to the target hex as a shot does: monsters block it, characters don't", () => {
  // A monster 1 up blocks the line to 2 up; it is in the area of 3 up, though, so aim past it at 3 up.
  const blocked = turn(game({ monsters: [up(1), up(3)] }), R, volley(up(3)));
  assert.deepEqual(cancelled(blocked.events), ["out of sight"]);
  assert.deepEqual(ranger(blocked.newState).cooldowns, {});
  const pastAlly = turn(game({ monsters: [up(3)], aAt: up(1) }), R, volley(up(2)));
  assert.deepEqual(hp(pastAlly.newState), [2]);
  // The pillar 2 down blocks 3 down.
  assert.deepEqual(cancelled(turn(game({ monsters: [down(3)] }), R, volley(down(3))).events), ["out of sight"]);
});

test("cancelled without a monster in the area, or with the hex out of range, without starting the cooldown", () => {
  const cases: [Hex, Hex[], string][] = [
    [up(3), [down(4)], "no monster in area"],
    [up(1), [up(1)], "too close"],
    [up(4), [up(4)], "out of range"],
  ];
  for (const [target, monsters, reason] of cases) {
    const { newState, events } = turn(game({ monsters }), R, volley(target));
    assert.deepEqual(cancelled(events), [reason], reason);
    assert.deepEqual(ranger(newState).cooldowns, {}, reason);
  }
});

test("the preview shows whom it hits", () => {
  const preview = previewCycle(game({ monsters: [up(3), hex(CENTRE.q + 1, CENTRE.r - 3)] }), [R, A], new Map([[R, [volley(up(2))]]]));
  assert.deepEqual(preview.areaHits.get(R)?.volley?.map((hit) => hit.monsterId), [0, 1]);
});

test("the server checks the rank, the cooldown, at most one per plan and the range", () => {
  const state = game({ monsters: [up(3)], actions: 2 });
  assert.equal(planAbilityProblem(state, R, [volley(up(3))]), undefined);
  // Empty or out of sight now is fine: that may change before the turn fires.
  assert.equal(planAbilityProblem(state, R, [volley(down(3))]), undefined);
  assert.equal(planAbilityProblem(state, R, [volley(up(1))]), "Volley can't be planned: the hex isn't 2 to 3 hexes away.");
  assert.equal(planAbilityProblem(state, R, [volley(up(9))]), "Volley can't be planned: the hex isn't 2 to 3 hexes away.");
  assert.equal(planAbilityProblem(state, R, [volley(up(3)), volley(up(2))]), "Volley can't be planned: already planned.");
  assert.equal(planAbilityProblem(game({ monsters: [], rank: 4 }), R, [volley(up(3))]), "Volley can't be planned: needs a higher rank.");
  const after = turn(game({ monsters: [up(3)] }), R, volley(up(3))).newState;
  assert.equal(planAbilityProblem(after, R, [volley(up(3))]), "Volley can't be planned: ready in 7 turns.");
});

test("only its cooldown can be upgraded, dear: 25, 100, 225, down to 3", () => {
  assert.deepEqual([1, 2, 3].map((n) => abilityUpgradeCost("volley", "cooldown", n)), [25, 100, 225]);
  const three: Upgrade[] = [25, 100, 225].map((paid) => ({ ability: "volley", upgrade: "cooldown", paid }));
  assert.equal(nextAbilityUpgradeCost(three, "volley", "cooldown"), undefined);
  assert.equal(abilityCooldown("volley", { volley: { cooldown: 3 } }), 3);
  const upgraded = turn(game({ monsters: [up(3)], abilityUpgrades: { volley: { cooldown: 3 } } }), R, volley(up(3)));
  assert.equal(ranger(upgraded.newState).cooldowns.volley, 3);
  assert.deepEqual(abilityStats("volley", baseStats("ranger")).map((row) => row.name), ["Damage", "Range", "Cooldown"]);
});
