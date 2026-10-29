import { test } from "node:test";
import assert from "node:assert/strict";
import { abilitiesOf, abilityStats, planAbilityProblem, type AbilityUpgradeCounts } from "./abilities.ts";
import { baseStats } from "./classes.ts";
import type { DungeonMap } from "./dungeon-map.ts";
import { applyEvents } from "./events.ts";
import type { CharacterId, GameState } from "./game-state.ts";
import { fromOffset, rectangle, type Hex } from "./hex.ts";
import { previewCycle } from "./preview.ts";
import { createTrack } from "./track.ts";
import { followUpPlan, newGameState, resolveTurn, type Plan } from "./turn.ts";
import { abilityUpgradeCost, nextAbilityUpgradeCost, type Upgrade } from "./upgrades.ts";

const H = 1;
const A = 2;
const B = 3;
const C = 4;
const groupHeal = { type: "groupHeal" } as const;

/**
 * A rank 4 healer and three adventurers, anywhere in a 9 by 9 room: group
 * heal needs no range. `null` is off the map. A monster stands in a corner
 * and never acts.
 */
function game({
  hp = {},
  positions = {},
  abilityUpgrades = {},
}: {
  hp?: Partial<Record<CharacterId, number>>;
  positions?: Partial<Record<CharacterId, Hex | null>>;
  abilityUpgrades?: AbilityUpgradeCounts;
} = {}): GameState {
  const map: DungeonMap = { hexes: rectangle(9, 9), startHexes: [fromOffset(8, 0)], doors: [], monsters: [{ type: "basic", position: fromOffset(0, 8) }] };
  const state = newGameState(
    map,
    [
      { id: H, stats: baseStats("healer"), abilities: abilitiesOf("healer", 4), abilityUpgrades, classId: "healer" },
      { id: A, stats: baseStats("adventurer") },
      { id: B, stats: baseStats("adventurer") },
      { id: C, stats: baseStats("adventurer") },
    ],
    createTrack([H, A, B, C], new Map()),
  );
  const at: Record<CharacterId, Hex | null> = {
    [H]: fromOffset(4, 4),
    [A]: fromOffset(0, 0),
    [B]: fromOffset(8, 4),
    [C]: fromOffset(2, 7),
    ...positions,
  };
  return { ...state, characters: state.characters.map((c) => ({ ...c, position: at[c.id]!, hp: hp[c.id] ?? c.hp })) };
}

function turn(state: GameState, ...plan: Plan) {
  const result = resolveTurn(state, H, new Map<CharacterId, Plan>([[H, plan]]));
  assert.deepEqual(applyEvents(state, result.events), result.newState, "replaying the events");
  return result;
}

const hpOf = (state: GameState, id: CharacterId) => state.characters.find((c) => c.id === id)!.hp;

test("a rank 4 healer has group heal: cooldown 6, healing its healing power", () => {
  assert.deepEqual(abilitiesOf("healer", 4), ["healingTouch", "renew", "ward", "groupHeal"]);
  assert.deepEqual(abilityStats("groupHeal", baseStats("healer")).map((r) => r.value), [
    "3 hit points to every living character on the map",
    "6 turns",
  ]);
});

test("group heal heals every hurt living character on the map, the healer included, never above the max", () => {
  const { events, newState } = turn(game({ hp: { [H]: 5, [A]: 2, [B]: 9 } }), groupHeal);
  assert.deepEqual(events, [
    { type: "healed", characterId: H, targetId: H, healed: 3, ability: "groupHeal" },
    { type: "healed", characterId: H, targetId: A, healed: 3, ability: "groupHeal" },
    { type: "healed", characterId: H, targetId: B, healed: 1, ability: "groupHeal" },
    { type: "cooldownStarted", characterId: H, ability: "groupHeal", turns: 6 },
  ]);
  assert.deepEqual([H, A, B, C].map((id) => hpOf(newState, id)), [8, 5, 10, 10]);
  assert.equal(followUpPlan(newState, H, events), null);
});

test("dead characters and characters not on the map yet aren't healed", () => {
  const { events } = turn(game({ hp: { [A]: 0, [B]: 4, [C]: 6 }, positions: { [B]: null } }), groupHeal);
  assert.deepEqual(
    events.filter((e) => e.type === "healed").map((e) => e.type === "healed" && e.targetId),
    [C],
  );
});

test("group heal is cancelled when nobody is hurt, without starting the cooldown", () => {
  assert.deepEqual(turn(game(), groupHeal).events, [
    { type: "planCancelled", characterId: H, action: 0, reason: "nobody hurt" },
  ]);
  // The dead don't count as hurt.
  assert.deepEqual(turn(game({ hp: { [A]: 0 } }), groupHeal).events, [
    { type: "planCancelled", characterId: H, action: 0, reason: "nobody hurt" },
  ]);
});

test("the preview lists whom group heal heals, and the server checks the healer is on the map", () => {
  const state = game({ hp: { [A]: 3 } });
  assert.deepEqual(previewCycle(state, [H], new Map([[H, [groupHeal]]])).heals.get(H), [
    { ability: "groupHeal", targetId: A, healed: 3, hpAfter: 6 },
  ]);
  assert.equal(planAbilityProblem(state, H, [groupHeal]), undefined);
  assert.equal(
    planAbilityProblem(game({ positions: { [H]: null } }), H, [groupHeal]),
    "Group heal can't be planned: the character isn't on the map yet.",
  );
  const used = turn(state, groupHeal).newState;
  assert.equal(planAbilityProblem(used, H, [groupHeal]), "Group heal can't be planned: ready in 7 turns.");
});

test("group heal's cooldown upgrades are dear and stop at 3, for a cooldown of 3", () => {
  assert.deepEqual([1, 2, 3].map((n) => abilityUpgradeCost("groupHeal", "cooldown", n)), [25, 100, 225]);
  const three: Upgrade[] = [25, 100, 225].map((paid) => ({ ability: "groupHeal", upgrade: "cooldown", paid }));
  assert.equal(nextAbilityUpgradeCost(three, "groupHeal", "cooldown"), undefined);
  const { events } = turn(game({ hp: { [A]: 3 }, abilityUpgrades: { groupHeal: { cooldown: 3 } } }), groupHeal);
  assert.deepEqual(events.at(-1), { type: "cooldownStarted", characterId: H, ability: "groupHeal", turns: 3 });
});
