import { test } from "node:test";
import assert from "node:assert/strict";
import { abilitiesLine, abilitiesOf, abilityStats, planAbilityProblem, type AbilityId } from "./abilities.ts";
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

/** Monster 0 is awake, 2 hexes up; monster 1 is a guard, on guard, in a corner. */
const MAP: DungeonMap = {
  hexes: rectangle(9, 9),
  startHexes: [fromOffset(8, 8)],
  doors: [],
  monsters: [
    { type: "brute", position: up(2) },
    { type: "guard", position: fromOffset(0, 8) },
  ],
};

const recall: PlannedAction = { type: "recall" };
const fireball: PlannedAction = { type: "fireball", target: up(2) };

/** A caster of `rank` in the middle of the room, with `charges` left; the monsters never act. */
function game({
  rank = 1,
  actions = 1,
  charges,
}: { rank?: number; actions?: number; charges?: Partial<Record<AbilityId, number>> } = {}): GameState {
  const state = newGameState(
    MAP,
    [{ id: C, stats: { ...baseStats("caster"), actions }, abilities: abilitiesOf("caster", rank), classId: "caster" }],
    [{ characterId: C, monsterIds: [] }],
  );
  return {
    ...state,
    characters: state.characters.map((c) => ({
      ...c,
      position: CENTRE,
      ...(charges && { spellCharges: { ...c.spellCharges, ...charges } }),
    })),
  };
}

/** `state` with every monster asleep (on guard or behind a door), or dead. */
function noneAwake(state: GameState, dead = false): GameState {
  return { ...state, monsters: state.monsters.map((m) => (dead && m.id === 0 ? { ...m, hp: 0 } : { ...m, asleep: true })) };
}

function turn(state: GameState, ...plan: Plan) {
  const result = resolveTurn(state, C, new Map<CharacterId, Plan>([[C, plan]]));
  assert.deepEqual(applyEvents(state, result.events), result.newState, "replaying the events");
  return result;
}

const charges = (state: GameState) => state.characters[0]!.spellCharges;

test("a rank 1 caster has recall, with a cooldown of 5", () => {
  assert.deepEqual(abilitiesOf("caster", 1), ["fireball", "recall"]);
  assert.deepEqual(
    abilityStats("recall", baseStats("caster")).map((row) => row.value),
    ["1 used charge back of each spell with charges, while a monster is awake", "5 turns"],
  );
});

test("a recall gives back 1 used charge of each spell with charges, and starts its cooldown", () => {
  const { newState, events } = turn(game({ charges: { fireball: 1 } }), recall);
  assert.deepEqual(events, [
    { type: "chargesRecalled", characterId: C, abilities: ["fireball"] },
    { type: "cooldownStarted", characterId: C, ability: "recall", turns: 5 },
  ]);
  assert.deepEqual(charges(newState), { fireball: 2 });
  assert.equal(followUpPlan(newState, C, events), null);
  assert.equal(abilitiesLine(newState.characters[0]!, []), "Fireball 2/3 ✓ · Recall 6");
});

test("a recall with no charge used is cancelled, without the cooldown", () => {
  const { newState, events } = turn(game(), recall);
  assert.deepEqual(events, [{ type: "planCancelled", characterId: C, action: 0, reason: "no charges used" }]);
  assert.deepEqual(newState.characters[0]!.cooldowns, {});
});

test("a fireball earlier in the same plan uses the charge a recall then gives back", () => {
  const { newState, events } = turn(game({ actions: 2 }), fireball, recall);
  assert.deepEqual(charges(newState), { fireball: 3 });
  assert.ok(events.some((e) => e.type === "chargesRecalled"));
});

test("a recall needs a monster awake, when it is planned and when it is carried out", () => {
  const asleep = noneAwake(game({ charges: { fireball: 0 } }));
  assert.equal(planAbilityProblem(asleep, C, [recall]), "Recall can't be planned: no monsters awake.");
  assert.equal(planAbilityProblem(game({ charges: { fireball: 0 } }), C, [recall]), undefined);
  // Sent anyway: cancelled, without the cooldown.
  const { newState, events } = turn(asleep, recall);
  assert.deepEqual(events, [{ type: "planCancelled", characterId: C, action: 0, reason: "no monsters awake" }]);
  assert.deepEqual(newState.characters[0]!.cooldowns, {});
  // A dead monster isn't awake either.
  assert.equal(planAbilityProblem(noneAwake(game(), true), C, [recall]), "Recall can't be planned: no monsters awake.");
});

test("a fireball that kills the last awake monster cancels the recall after it", () => {
  // The brute is the only monster awake; with attack damage 20 the fireball kills it.
  const base = game({ actions: 2 });
  const state = {
    ...base,
    characters: base.characters.map((c) => ({ ...c, stats: { ...c.stats, attackDamage: 20 } })),
  };
  const { events } = turn(state, fireball, recall);
  assert.deepEqual(events.at(-1), { type: "planCancelled", characterId: C, action: 1, reason: "no monsters awake" });
});

test("the server checks the rank, the cooldown and at most one per plan", () => {
  const state = game({ actions: 2, charges: { fireball: 0 } });
  assert.equal(planAbilityProblem(state, C, [recall, recall]), "Recall can't be planned: already planned.");
  const after = turn(state, recall).newState;
  assert.equal(planAbilityProblem(after, C, [recall]), "Recall can't be planned: ready in 6 turns.");
  const adventurer = { ...state, characters: state.characters.map((c) => ({ ...c, abilities: [] })) };
  assert.equal(planAbilityProblem(adventurer, C, [recall]), "Recall can't be planned: needs a higher rank.");
});

test("the preview shows a recall that won't go through", () => {
  const preview = previewCycle(game(), [C], new Map([[C, [recall]]]));
  assert.deepEqual(preview.cancellations, [{ type: "planCancelled", characterId: C, action: 0, reason: "no charges used" }]);
});

test("the cooldown upgrade costs 25, 100, 225, 400, down to 1", () => {
  assert.deepEqual([1, 2, 3, 4].map((n) => abilityUpgradeCost("recall", "cooldown", n)), [25, 100, 225, 400]);
  const four: Upgrade[] = [1, 2, 3, 4].map(() => ({ ability: "recall", upgrade: "cooldown", paid: 1 }));
  assert.equal(nextAbilityUpgradeCost(four, "recall", "cooldown"), undefined);
  assert.equal(abilityStats("recall", baseStats("caster"), { recall: { cooldown: 4 } }).at(-1)!.value, "1 turn");
});
