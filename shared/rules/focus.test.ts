import { test } from "node:test";
import assert from "node:assert/strict";
import {
  abilitiesLine,
  abilitiesOf,
  abilityStats,
  planAbilityProblem,
  type AbilityId,
  type AbilityUpgradeCounts,
} from "./abilities.ts";
import { baseStats } from "./classes.ts";
import type { DungeonMap } from "./dungeon-map.ts";
import { applyEvents } from "./events.ts";
import type { CharacterId, GameState } from "./game-state.ts";
import { fromOffset, hex, rectangle, type Hex } from "./hex.ts";
import { previewCycle } from "./preview.ts";
import { followUpPlan, newGameState, resolveTurn, type Plan, type PlannedAction } from "./turn.ts";
import { abilityUpgradeCost, nextAbilityUpgradeCost, type Upgrade } from "./upgrades.ts";

const C = 1;
const CENTRE = fromOffset(4, 4);
const up = (steps: number): Hex => hex(CENTRE.q, CENTRE.r - steps);

/** One monster, awake, 2 hexes up. */
const MAP: DungeonMap = {
  hexes: rectangle(9, 9),
  startHexes: [fromOffset(8, 8)],
  doors: [],
  monsters: [{ type: "brute", position: up(2) }],
};

const focus: PlannedAction = { type: "focus" };
const recall: PlannedAction = { type: "recall" };
const teleport: PlannedAction = { type: "teleport", target: hex(CENTRE.q + 2, CENTRE.r) };

/** A caster of `rank` in the middle of the room, with `cooldowns` running; the monster never acts. */
function game({
  rank = 8,
  actions = 1,
  cooldowns = {},
  abilityUpgrades = {},
}: {
  rank?: number;
  actions?: number;
  cooldowns?: Partial<Record<AbilityId, number>>;
  abilityUpgrades?: AbilityUpgradeCounts;
} = {}): GameState {
  const state = newGameState(
    MAP,
    [
      {
        id: C,
        stats: { ...baseStats("caster"), actions },
        abilities: abilitiesOf("caster", rank),
        classId: "caster",
        abilityUpgrades,
      },
    ],
    [{ characterId: C, monsterIds: [] }],
  );
  return { ...state, characters: state.characters.map((c) => ({ ...c, position: CENTRE, cooldowns })) };
}

function turn(state: GameState, ...plan: Plan) {
  const result = resolveTurn(state, C, new Map<CharacterId, Plan>([[C, plan]]));
  assert.deepEqual(applyEvents(state, result.events), result.newState, "replaying the events");
  return result;
}

const cooldowns = (state: GameState) => state.characters[0]!.cooldowns;

test("every caster rank has focus, with a cooldown of 3", () => {
  for (const rank of [6, 7, 8, 9, 10]) assert.ok(abilitiesOf("caster", rank).includes("focus"), `rank ${rank}`);
  assert.equal(abilitiesOf("adventurer", 5).includes("focus"), false);
  assert.deepEqual(
    abilityStats("focus", baseStats("caster")).map((row) => row.value),
    ["1 turn off the cooldown of each other ability on cooldown", "3 turns"],
  );
});

test("a focus takes 1 turn off each other cooldown, and starts its own", () => {
  // The cooldowns count down by 1 at the start of the turn first: 5 → 4 and 2 → 1.
  const { newState, events } = turn(game({ cooldowns: { recall: 5, teleport: 2 } }), focus);
  assert.deepEqual(events, [
    { type: "cooldownsAdvanced", characterId: C },
    { type: "cooldownsShortened", characterId: C, abilities: ["recall", "teleport"] },
    { type: "cooldownStarted", characterId: C, ability: "focus", turns: 3 },
  ]);
  assert.deepEqual(cooldowns(newState), { recall: 3, teleport: 0, focus: 3 });
  assert.equal(followUpPlan(newState, C, events), null);
});

test("a focus leaves abilities that are ready alone", () => {
  const { newState } = turn(game({ cooldowns: { recall: 3, teleport: 0 } }), focus);
  assert.deepEqual(cooldowns(newState), { recall: 1, teleport: 0, focus: 3 });
});

test("a focus with nothing on cooldown is cancelled, without its cooldown", () => {
  const { newState, events } = turn(game(), focus);
  assert.deepEqual(events, [{ type: "planCancelled", characterId: C, action: 0, reason: "nothing on cooldown" }]);
  assert.deepEqual(cooldowns(newState), {});
  // Planning it is fine: an ability earlier in the plan may start a cooldown.
  assert.equal(planAbilityProblem(game(), C, [focus]), undefined);
  const preview = previewCycle(game(), [C], new Map([[C, [focus]]]));
  assert.deepEqual(preview.cancellations, [{ type: "planCancelled", characterId: C, action: 0, reason: "nothing on cooldown" }]);
});

test("a focus also shortens a cooldown started earlier in the same plan", () => {
  const { newState, events } = turn(game({ actions: 2 }), teleport, focus);
  assert.ok(events.some((e) => e.type === "cooldownsShortened" && e.abilities.join() === "teleport"));
  assert.deepEqual(cooldowns(newState), { teleport: 3, focus: 3 });
});

test("a focus doesn't make a spell usable in the same turn", () => {
  // Recall has 1 turn left at the start: it counts down to 0, but isn't ready in this turn.
  const { events } = turn(game({ actions: 2, cooldowns: { recall: 1, teleport: 3 } }), focus, recall);
  assert.ok(events.some((e) => e.type === "planCancelled" && e.reason === "not ready"));
});

test("one focus per plan, and none while it is on cooldown", () => {
  const state = game({ actions: 2, cooldowns: { recall: 4 } });
  assert.equal(planAbilityProblem(state, C, [focus, focus]), "Focus can't be planned: already planned.");
  const after = turn(state, focus).newState;
  assert.equal(planAbilityProblem(after, C, [focus]), "Focus can't be planned: ready in 3 turns.");
  assert.equal(abilitiesLine(after.characters[0]!, []), "Fireball 3/3 ✓ · Recall 2 · Focus 3 · Frost wave 2/2 ✓ · Teleport ✓");
});

test("the cooldown upgrade costs 10, 40, 90, down to 0", () => {
  assert.deepEqual([1, 2, 3].map((n) => abilityUpgradeCost("focus", "cooldown", n)), [10, 40, 90]);
  const three: Upgrade[] = [1, 2, 3].map(() => ({ ability: "focus", upgrade: "cooldown", paid: 1 }));
  assert.equal(nextAbilityUpgradeCost(three, "focus", "cooldown"), undefined);
  assert.equal(abilityStats("focus", baseStats("caster"), { focus: { cooldown: 3 } }).at(-1)!.value, "0 turns");
});

test("with a cooldown of 0, focus can be used every turn, once per plan", () => {
  let state = game({ actions: 2, cooldowns: { recall: 5 }, abilityUpgrades: { focus: { cooldown: 3 } } });
  assert.equal(planAbilityProblem(state, C, [focus, focus]), "Focus can't be planned: already planned.");
  const first = turn(state, focus);
  assert.equal(first.events.some((e) => e.type === "cooldownStarted"), false);
  state = first.newState;
  assert.deepEqual(cooldowns(state), { recall: 3 });
  assert.equal(planAbilityProblem(state, C, [focus]), undefined);
  // Each turn: 1 off at the start, and 1 off by the focus.
  assert.deepEqual(cooldowns(turn(state, focus).newState), { recall: 1 });
});
