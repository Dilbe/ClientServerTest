import { test } from "node:test";
import assert from "node:assert/strict";
import { abilitiesLine, abilitiesOf, abilityStats, planAbilityProblem } from "./abilities.ts";
import { baseStats } from "./classes.ts";
import type { DungeonMap } from "./dungeon-map.ts";
import { applyEvents, type GameEvent } from "./events.ts";
import type { CharacterId, GameState } from "./game-state.ts";
import { fromOffset, hex, hexKey, rectangle, type Hex } from "./hex.ts";
import { inLineOfSight, inLooseLineOfSight } from "./line-of-sight.ts";
import { meteorDamage } from "./meteor.ts";
import { previewCycle } from "./preview.ts";
import type { MonsterTypeId } from "./stats.ts";
import { followUpPlan, newGameState, resolveTurn, type Plan, type PlannedAction } from "./turn.ts";
import { abilityUpgradeCost, applyUpgrade, nextAbilityUpgradeCost, type Upgrade } from "./upgrades.ts";

const C = 1;
const A = 2;

const CENTRE = fromOffset(7, 7);
const up = (steps: number): Hex => hex(CENTRE.q, CENTRE.r - steps);
const downRight = (steps: number): Hex => hex(CENTRE.q + steps, CENTRE.r);

/** A pillar 2 hexes down-right of the caster. */
const PILLAR = downRight(2);
/** The meteor's target in most tests: 5 hexes up. */
const TARGET = up(5);

const meteor = (target: Hex): PlannedAction => ({ type: "meteor", target });

/**
 * A rank 5 caster with attack damage 4 in the middle of a 15 by 15 room,
 * with the given monsters (they never act) and a guard far away, so the
 * game isn't won. A stands where `aAt` says, or off the map.
 */
function game({
  monsters,
  attackDamage = 4,
  actions = 1,
  aAt = null,
}: {
  monsters: [MonsterTypeId, Hex][];
  attackDamage?: number;
  actions?: number;
  aAt?: Hex | null;
}): GameState {
  const map: DungeonMap = {
    hexes: rectangle(15, 15).filter((h) => hexKey(h) !== hexKey(PILLAR)),
    startHexes: [fromOffset(14, 14)],
    doors: [],
    monsters: [...monsters, ["guard", fromOffset(14, 0)] as [MonsterTypeId, Hex]].map(([type, position]) => ({
      type,
      position,
    })),
  };
  const state = newGameState(
    map,
    [
      {
        id: C,
        stats: { ...baseStats("caster"), attackDamage, actions },
        abilities: abilitiesOf("caster", 5),
        classId: "caster",
      },
      { id: A, stats: baseStats("adventurer") },
    ],
    [
      { characterId: C, monsterIds: [] },
      { characterId: A, monsterIds: [] },
    ],
  );
  const at = new Map<CharacterId, Hex | null>([
    [C, CENTRE],
    [A, aAt],
  ]);
  return { ...state, characters: state.characters.map((c) => ({ ...c, position: at.get(c.id) ?? null })) };
}

function turn(state: GameState, ...plan: Plan) {
  const result = resolveTurn(state, C, new Map<CharacterId, Plan>([[C, plan]]));
  assert.deepEqual(applyEvents(state, result.events), result.newState, "replaying the events");
  return result;
}

const caster = (state: GameState) => state.characters.find((c) => c.id === C)!;
/** The damage of the caster's hits, by monster id. */
const damageBy = (events: GameEvent[]) =>
  Object.fromEntries(
    events.flatMap((e) => (e.type === "attacked" && e.attacker.kind === "character" ? [[e.target.id, e.damage]] : [])),
  );

test("a rank 5 caster has meteor, with 1 charge and no cooldown", () => {
  assert.ok(!abilitiesOf("caster", 4).includes("meteor"));
  assert.ok(abilitiesOf("caster", 5).includes("meteor"));
  const state = game({ monsters: [] });
  assert.deepEqual(caster(state).spellCharges, { fireball: 3, frostWave: 2, meteor: 1 });
  assert.deepEqual(
    abilityStats("meteor", { ...baseStats("caster"), attackDamage: 4 }).map((r) => [r.name, r.value]),
    [
      ["Damage", "8 on the hex, 4 next to it, 2 on the ring around that"],
      ["Range", "0 to 6 hexes; only walls and closed doors block the line of sight"],
      ["Charges", "1 per game"],
    ],
  );
});

test("the three rings: double on the hex, full next to it, half (rounded down) on the ring around that", () => {
  assert.deepEqual(
    [0, 1, 2, 3].map((d) => meteorDamage(TARGET, hex(TARGET.q, TARGET.r + d), 5)),
    [10, 5, 2, undefined],
  );
  const state = game({
    monsters: [
      ["ogre", TARGET],
      ["ogre", hex(TARGET.q + 1, TARGET.r)], // next to it
      ["ogre", hex(TARGET.q + 2, TARGET.r - 1)], // 2 away
      ["ogre", hex(TARGET.q - 3, TARGET.r)], // 3 away: not hit
    ],
  });
  const { newState, events } = turn(state, meteor(TARGET));
  assert.deepEqual(damageBy(events), { 0: 8, 1: 4, 2: 2 });
  assert.deepEqual(
    newState.monsters.slice(0, 4).map((m) => m.hp),
    [30 - 8, 30 - 4, 30 - 2, 30],
  );
  assert.ok(events.some((e) => e.type === "chargeUsed" && e.ability === "meteor"));
  assert.ok(!events.some((e) => e.type === "cooldownStarted"));
  assert.equal(followUpPlan(newState, C, events), null);
  assert.equal(caster(newState).spellCharges?.meteor, 0);
});

test("each kill gives XP, every monster hit is alerted, and characters take no damage", () => {
  const state = game({
    monsters: [
      ["basic", TARGET],
      ["guard", hex(TARGET.q, TARGET.r + 2)],
    ],
    aAt: hex(TARGET.q + 1, TARGET.r),
  });
  const { newState, events } = turn(state, meteor(TARGET));
  assert.ok(events.some((e) => e.type === "died" && e.who.kind === "monster" && e.who.id === 0));
  assert.ok(events.some((e) => e.type === "xpGained"));
  assert.equal(newState.monsters[1]!.asleep, false);
  assert.equal(newState.characters[1]!.hp, 10);
});

test("the looser line of sight: characters don't block it, walls do", () => {
  const ally = game({ monsters: [["ogre", TARGET]], aAt: up(2) });
  assert.equal(inLineOfSight(ally, CENTRE, TARGET), false);
  assert.equal(inLooseLineOfSight(ally, CENTRE, TARGET), true);
  assert.deepEqual(damageBy(turn(ally, meteor(TARGET)).events), { 0: 8 });
  // Behind the pillar: cancelled, without using the charge.
  const behind = downRight(4);
  const walled = game({ monsters: [["ogre", behind]] });
  const { newState, events } = turn(walled, meteor(behind));
  assert.deepEqual(events, [{ type: "planCancelled", characterId: C, action: 0, reason: "out of sight" }]);
  assert.equal(caster(newState).spellCharges?.meteor, 1);
  // So does a created wall.
  const createdWall: GameState = {
    ...game({ monsters: [["ogre", TARGET]] }),
    createdWalls: [{ characterId: A, hexes: [up(2)], turnsLeft: 3 }],
  };
  assert.equal(inLooseLineOfSight(createdWall, CENTRE, TARGET), false);
  // Line of sight only counts for the target hex: a monster behind the pillar, next to a hex in sight, is hit.
  const nextToPillar = game({ monsters: [["ogre", downRight(3)]] });
  assert.deepEqual(damageBy(turn(nextToPillar, meteor(hex(CENTRE.q + 3, CENTRE.r - 1))).events), { 0: 4 });
});

test("a meteor is cancelled when no monster is in the area or it is out of range", () => {
  const state = game({ monsters: [["ogre", up(1)]] });
  assert.deepEqual(turn(state, meteor(hex(CENTRE.q - 5, CENTRE.r))).events, [
    { type: "planCancelled", characterId: C, action: 0, reason: "no monster in area" },
  ]);
  assert.deepEqual(turn(state, meteor(up(7))).events, [
    { type: "planCancelled", characterId: C, action: 0, reason: "out of range" },
  ]);
});

test("the charges: one per game, refused when used, and the +1 charge upgrade", () => {
  const state = game({ monsters: [["ogre", TARGET]], actions: 2 });
  const used = turn(state, meteor(TARGET)).newState;
  assert.equal(planAbilityProblem(used, C, [meteor(TARGET)]), "Meteor can't be planned: no charges left.");
  assert.deepEqual(turn(used, meteor(TARGET)).events, [
    { type: "planCancelled", characterId: C, action: 0, reason: "no charges" },
  ]);
  assert.match(abilitiesLine(caster(used), []) ?? "", /Meteor 0\/1/);
  assert.deepEqual([1].map((n) => abilityUpgradeCost("meteor", "charges", n)), [50]);
  const one: Upgrade[] = [{ ability: "meteor", upgrade: "charges", paid: 50 }];
  assert.equal(nextAbilityUpgradeCost(one, "meteor", "charges"), undefined);
  const upgraded = applyUpgrade(used, C, "caster", { ability: "meteor", upgrade: "charges" });
  assert.equal(caster(upgraded).spellCharges?.meteor, 1);
  // Recall gives it back too.
  const recalled = turn(used, { type: "recall" }).newState;
  assert.equal(caster(recalled).spellCharges?.meteor, 1);
});

test("the server checks the rank, the distance and one per plan; the preview shows whom it hits", () => {
  const state = game({ monsters: [["ogre", TARGET]], actions: 2 });
  assert.equal(planAbilityProblem(state, C, [meteor(up(6))]), undefined);
  assert.equal(planAbilityProblem(state, C, [meteor(up(7))]), "Meteor can't be planned: the hex is more than 6 hexes away.");
  assert.equal(planAbilityProblem(state, C, [meteor(TARGET), meteor(TARGET)]), "Meteor can't be planned: already planned.");
  const rank4 = { ...state, characters: state.characters.map((c) => ({ ...c, abilities: abilitiesOf("caster", 4) })) };
  assert.equal(planAbilityProblem(rank4, C, [meteor(TARGET)]), "Meteor can't be planned: needs a higher rank.");
  const preview = previewCycle(state, [C, A], new Map([[C, [meteor(TARGET)]]]));
  assert.deepEqual(preview.areaHits.get(C)?.meteor, [{ monsterId: 0, at: TARGET }]);
});
