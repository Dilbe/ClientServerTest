import { test } from "node:test";
import assert from "node:assert/strict";
import { baseStats, CLASSES, meleeDamage } from "./classes.ts";
import type { DungeonMap } from "./dungeon-map.ts";
import { applyEvents } from "./events.ts";
import type { CharacterId, GameState } from "./game-state.ts";
import { fromOffset, neighbours, rectangle } from "./hex.ts";
import { previewCycle } from "./preview.ts";
import { createTrack } from "./track.ts";
import { followUpPlan, newGameState, resolveTurn, type Plan } from "./turn.ts";
import { statsWithUpgrades, upgradeCost, type Upgrade } from "./upgrades.ts";

const A = 1;
const CENTRE = fromOffset(4, 4);
/** A brute next to the caster: 20 hit points, so it survives a few hits. */
const MAP: DungeonMap = {
  hexes: rectangle(9, 9),
  startHexes: [fromOffset(8, 8)],
  doors: [],
  monsters: [{ type: "brute", position: neighbours(CENTRE)[0]! }],
};
const attack0 = { type: "attack", target: MAP.monsters[0]!.position } as const;

/** A caster with `attackDamage` in the middle of the room, or an adventurer with `classId: "adventurer"`. */
function game(attackDamage: number, classId: "caster" | "adventurer" = "caster", actions = 1): GameState {
  const state = newGameState(
    MAP,
    [{ id: A, stats: { ...baseStats(classId), attackDamage, actions }, classId }],
    createTrack([A], new Map()),
  );
  return { ...state, characters: state.characters.map((c) => ({ ...c, position: CENTRE })) };
}

function turn(state: GameState, ...plan: Plan) {
  const plans = new Map<CharacterId, Plan>([[A, plan]]);
  const result = resolveTurn(state, A, plans);
  assert.deepEqual(applyEvents(state, result.events), result.newState, "replaying the events");
  return result;
}

test("a caster starts with 6 hit points and 2 attack damage; actions and movement are an adventurer's", () => {
  assert.deepEqual(baseStats("caster"), { actions: 1, movement: 1, attackDamage: 2, hitPoints: 6 });
  assert.equal(CLASSES.caster.extraMaxLevels, 10);
});

test("a caster's upgrade costs follow design.md, The caster", () => {
  const costs = (stat: "hitPoints" | "attackDamage" | "actions", n: number) =>
    Array.from({ length: n }, (_, i) => upgradeCost("caster", stat, i + 1));
  assert.deepEqual(costs("hitPoints", 4), [1, 2, 3, 4]);
  assert.deepEqual(costs("attackDamage", 4), [4, 12, 21, 32]);
  assert.deepEqual(costs("actions", 3), [20, 80, 180]);
  // Every upgrade adds 1, as for an adventurer.
  const upgrades: Upgrade[] = [
    { stat: "attackDamage", paid: 4 },
    { stat: "hitPoints", paid: 1 },
  ];
  assert.deepEqual(statsWithUpgrades("caster", upgrades), { actions: 1, movement: 1, attackDamage: 3, hitPoints: 7 });
});

test("a caster's melee damage is half its attack damage, rounded down", () => {
  const caster = (attackDamage: number) => game(attackDamage).characters[0]!;
  assert.deepEqual([2, 3, 4, 5].map((d) => meleeDamage(caster(d))), [1, 1, 2, 2]);
  // Only the caster: an adventurer hits for its full attack damage.
  assert.equal(meleeDamage(game(2, "adventurer").characters[0]!), 2);
  assert.equal(game(2, "adventurer").characters[0]!.halfMeleeDamage, undefined);
});

test("a caster's attack does half damage, and the preview and the log's events say so", () => {
  const { events, newState } = turn(game(4), attack0);
  const hit = events.find((e) => e.type === "attacked")!;
  assert.equal(hit.type === "attacked" && hit.damage, 2);
  assert.equal(newState.monsters[0]!.hp, 20 - 2);
  // The preview runs the same rules: the same damage.
  const preview = previewCycle(game(4), [A], new Map([[A, [attack0]]]));
  const previewed = preview.turns[0]!.events.find((e) => e.type === "attacked")!;
  assert.equal(previewed.type === "attacked" && previewed.damage, 2);
});

test("a caster's follow-up plan counts its halved melee damage", () => {
  // 2 actions, attack damage 4: 2 per hit. The brute has 20 - 2 × 2 = 16 left: 8 hits to kill, 2 actions.
  const state = game(4, "caster", 2);
  const { events, newState } = turn(state, attack0, attack0);
  assert.equal(newState.monsters[0]!.hp, 16);
  assert.equal(followUpPlan(newState, A, events)!.length, 2);
  // At attack damage 3 the melee damage is 1: 19 hit points left, so still 2 attacks, as many as it has actions.
  const weak = turn(game(3, "caster", 2), attack0);
  assert.equal(weak.newState.monsters[0]!.hp, 19);
  assert.equal(followUpPlan(weak.newState, A, weak.events)!.length, 2);
});
