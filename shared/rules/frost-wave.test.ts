import { test } from "node:test";
import assert from "node:assert/strict";
import { abilitiesOf, abilityStats, planAbilityProblem, type AbilityUpgradeCounts } from "./abilities.ts";
import { baseStats } from "./classes.ts";
import type { DungeonMap } from "./dungeon-map.ts";
import { applyEvents, type GameEvent } from "./events.ts";
import type { CharacterId, GameState, MonsterId } from "./game-state.ts";
import { fromOffset, hex, hexKey, rectangle, type Hex } from "./hex.ts";
import { lineFrom } from "./frost-wave.ts";
import { previewCycle } from "./preview.ts";
import type { MonsterTypeId } from "./stats.ts";
import { followUpPlan, newGameState, resolveTurn, type Plan, type PlannedAction } from "./turn.ts";
import { abilityUpgradeCost, nextAbilityUpgradeCost, type Upgrade } from "./upgrades.ts";

const C = 1;
const A = 2;

const CENTRE = fromOffset(6, 6);
const up = (steps: number): Hex => hex(CENTRE.q, CENTRE.r - steps);
const down = (steps: number): Hex => hex(CENTRE.q, CENTRE.r + steps);
const downRight = (steps: number): Hex => hex(CENTRE.q + steps, CENTRE.r);
const upLeft = (steps: number): Hex => hex(CENTRE.q - steps, CENTRE.r);

/** A pillar 2 hexes down-right of the caster. */
const PILLAR = downRight(2);

const wave = (towards: Hex): PlannedAction => ({ type: "frostWave", target: towards });

/**
 * A rank 2 caster in the middle of a 13 by 13 room with the given monsters,
 * all of which follow the caster on the track, so they act right after it.
 * A stands where `aAt` says, or off the map.
 */
function game({
  monsters,
  rank = 2,
  actions = 1,
  abilityUpgrades = {},
  aAt = null,
}: {
  monsters: [MonsterTypeId, Hex][];
  rank?: number;
  actions?: number;
  abilityUpgrades?: AbilityUpgradeCounts;
  aAt?: Hex | null;
}): GameState {
  const map: DungeonMap = {
    hexes: rectangle(13, 13).filter((h) => hexKey(h) !== hexKey(PILLAR)),
    startHexes: [fromOffset(12, 12)],
    doors: [],
    monsters: monsters.map(([type, position]) => ({ type, position })),
  };
  const state = newGameState(
    map,
    [
      {
        id: C,
        stats: { ...baseStats("caster"), actions },
        abilities: abilitiesOf("caster", rank),
        abilityUpgrades,
        classId: "caster",
      },
      { id: A, stats: baseStats("adventurer") },
    ],
    [
      { characterId: C, monsterIds: monsters.map((_, id) => id) },
      { characterId: A, monsterIds: [] },
    ],
  );
  const at = new Map<CharacterId, Hex | null>([
    [C, CENTRE],
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

const caster = (state: GameState) => state.characters.find((c) => c.id === C)!;
const monster = (state: GameState, id: MonsterId) => state.monsters.find((m) => m.id === id)!;
/** What monster `id` did in these events: its moves and attacks. */
function by(events: GameEvent[], id: MonsterId): GameEvent[] {
  return events.filter(
    (e) =>
      (e.type === "moved" && e.actor.kind === "monster" && e.actor.id === id) ||
      (e.type === "attacked" && e.attacker.kind === "monster" && e.attacker.id === id),
  );
}

// --- The wave ---

test("a rank 2 caster has frost wave: 2 charges, cooldown 4", () => {
  assert.ok(!abilitiesOf("caster", 1).includes("frostWave"));
  assert.ok(abilitiesOf("caster", 2).includes("frostWave"));
  const state = game({ monsters: [] });
  assert.deepEqual(caster(state).spellCharges, { fireball: 3, frostWave: 2 });
});

test("the wave covers 3 hexes in a straight line, starting next to the caster", () => {
  const state = game({ monsters: [] });
  assert.deepEqual(lineFrom(state, CENTRE, up(1), 3), [up(1), up(2), up(3)]);
  // A pillar stops it: the hexes from there on aren't covered.
  assert.deepEqual(lineFrom(state, CENTRE, downRight(1), 3), [downRight(1)]);
  // So does a closed door.
  const door = { ...state, closedDoors: [down(2)] };
  assert.deepEqual(lineFrom(door, CENTRE, down(1), 3), [down(1)]);
  // Not a neighbour: no direction.
  assert.deepEqual(lineFrom(state, CENTRE, up(2), 3), []);
});

test("every monster in the wave takes the full attack damage, is frozen and alerted; characters don't stop it", () => {
  const state = game({
    monsters: [
      ["basic", up(1)],
      ["guard", up(3)],
      ["basic", up(4)], // past the end of the wave
    ],
    aAt: up(2),
  });
  assert.equal(monster(state, 1).asleep, true);
  const { newState, events } = turn(state, C, wave(up(1)));
  const hits = events.filter((e) => e.type === "attacked" && e.attacker.kind === "character");
  assert.deepEqual(
    hits.map((e) => e.type === "attacked" && [e.target.id, e.damage, e.ability]),
    [
      [0, 2, "frostWave"],
      [1, 2, "frostWave"],
    ],
  );
  assert.ok(events.some((e) => e.type === "frozen" && e.monsterIds.join() === "0,1"));
  assert.ok(events.some((e) => e.type === "chargeUsed" && e.ability === "frostWave"));
  assert.ok(events.some((e) => e.type === "cooldownStarted" && e.ability === "frostWave" && e.turns === 4));
  // No friendly fire: A stood in the wave. (The frozen monsters next to it still hit it afterwards.)
  assert.ok(!hits.some((e) => e.type === "attacked" && e.target.kind === "character"));
  assert.equal(monster(newState, 1).asleep, false);
  assert.equal(monster(newState, 2).hp, 3);
  assert.equal(followUpPlan(newState, C, events), null);
});

test("a wall stops the wave: a monster behind it isn't hit", () => {
  const state = game({ monsters: [["basic", downRight(3)], ["basic", downRight(1)]] });
  const { newState } = turn(state, C, wave(downRight(1)));
  assert.equal(monster(newState, 0).hp, 3);
  assert.equal(monster(newState, 1).hp, 1);
});

// --- Frozen monsters ---

test("a frozen monster can't move on its next turn, and can afterwards", () => {
  // The brute acts right after the caster, frozen, 3 hexes away: it does nothing.
  const state = game({ monsters: [["brute", up(3)]] });
  const { newState, events } = turn(state, C, wave(up(1)));
  assert.deepEqual(by(events, 0), []);
  assert.deepEqual(events.at(-1), { type: "thawed", monsterId: 0 });
  assert.equal(monster(newState, 0).frozen, undefined);
  // Its next turn it walks again.
  const next = turn(newState, C);
  assert.equal(by(next.events, 0)[0]?.type, "moved");
});

test("a frozen monster still attacks a target in its range", () => {
  // Melee: the brute next to the caster hits it, though it is frozen.
  const melee = turn(game({ monsters: [["brute", up(1)]] }), C, wave(up(1)));
  assert.deepEqual(by(melee.events, 0).map((e) => e.type), ["attacked"]);
  // Ranged: an archer 3 hexes away shoots, but a frozen one out of range doesn't walk closer.
  const archer = turn(game({ monsters: [["archer", up(3)]] }), C, wave(up(1)));
  assert.deepEqual(by(archer.events, 0).map((e) => e.type), ["attacked"]);
  const far = game({ monsters: [["archer", upLeft(1)]] });
  const frozenFar: GameState = {
    ...far,
    characters: far.characters.map((c) => (c.id === C ? { ...c, position: fromOffset(0, 0) } : c)),
    monsters: far.monsters.map((m) => ({ ...m, frozen: true as const })),
  };
  const result = turn(frozenFar, C);
  assert.deepEqual(by(result.events, 0), []);
  assert.deepEqual(result.events.at(-1), { type: "thawed", monsterId: 0 });
});

test("freezes don't stack, and a stunned monster that is also frozen just skips its turn", () => {
  const state = game({ monsters: [["brute", up(3)]] });
  const frozen: GameState = { ...state, monsters: state.monsters.map((m) => ({ ...m, frozen: true as const })) };
  // Frozen again before its turn: still one frozen turn.
  const again = turn(frozen, C, wave(up(1)));
  assert.equal(again.events.filter((e) => e.type === "thawed").length, 1);
  assert.equal(monster(again.newState, 0).frozen, undefined);
  // Stunned and frozen: it skips its turn, and is neither afterwards.
  const both: GameState = { ...frozen, monsters: frozen.monsters.map((m) => ({ ...m, stunned: true })) };
  const skipped = turn(both, C);
  assert.deepEqual(skipped.events, [{ type: "turnSkipped", monsterId: 0 }]);
  assert.equal(monster(skipped.newState, 0).frozen, undefined);
  assert.equal(monster(skipped.newState, 0).stunned, false);
});

// --- Cancelling and the server's checks ---

test("a frost wave without a monster in it is cancelled, without a charge or the cooldown", () => {
  const state = game({ monsters: [["basic", up(4)]] });
  const { newState, events } = turn(state, C, wave(up(1)));
  assert.deepEqual(events[0], { type: "planCancelled", characterId: C, action: 0, reason: "no monster in area" });
  assert.equal(caster(newState).spellCharges?.frostWave, 2);
  assert.deepEqual(caster(newState).cooldowns, {});
});

test("the server checks the rank, the cooldown, the charges, one per plan and a hex next to the caster", () => {
  const state = game({ monsters: [["brute", up(2)]], actions: 2 });
  assert.equal(planAbilityProblem(state, C, [wave(up(1))]), undefined);
  assert.equal(planAbilityProblem(state, C, [wave(up(2))]), "Frost wave can't be planned: the hex isn't next to the character.");
  assert.equal(planAbilityProblem(state, C, [wave(up(1)), wave(down(1))]), "Frost wave can't be planned: already planned.");
  assert.equal(
    planAbilityProblem(game({ monsters: [], rank: 1 }), C, [wave(up(1))]),
    "Frost wave can't be planned: needs a higher rank.",
  );
  const after = turn(state, C, wave(up(1))).newState;
  assert.equal(planAbilityProblem(after, C, [wave(up(1))]), "Frost wave can't be planned: ready in 5 turns.");
  const empty: GameState = {
    ...state,
    characters: state.characters.map((c) => (c.id === C ? { ...c, spellCharges: { ...c.spellCharges, frostWave: 0 } } : c)),
  };
  assert.equal(planAbilityProblem(empty, C, [wave(up(1))]), "Frost wave can't be planned: no charges left.");
});

test("recall gives a frost wave charge back too", () => {
  const state = game({ monsters: [["brute", up(3)]], actions: 2 });
  const used: GameState = {
    ...state,
    characters: state.characters.map((c) => (c.id === C ? { ...c, spellCharges: { fireball: 2, frostWave: 1 } } : c)),
  };
  const { newState, events } = turn(used, C, { type: "recall" });
  assert.deepEqual(events[0], { type: "chargesRecalled", characterId: C, abilities: ["fireball", "frostWave"] });
  assert.deepEqual(caster(newState).spellCharges, { fireball: 3, frostWave: 2 });
});

// --- The preview ---

test("the preview shows whom a frost wave hits, and a frozen monster attacking but not moving", () => {
  const state = game({ monsters: [["brute", up(1)], ["brute", up(3)]] });
  const preview = previewCycle(state, [C, A], new Map([[C, [wave(up(1))]]]));
  assert.deepEqual(preview.areaHits.get(C)?.frostWave?.map((hit) => hit.monsterId), [0, 1]);
  const near = preview.monsters.get(0)!;
  assert.equal(near.type === "acts" && near.steps.map((s) => s.type).join(), "attack");
  assert.deepEqual(preview.monsters.get(1), { type: "frozen", after: C });
});

// --- Upgrades ---

test("frost wave's upgrades: cooldown, charges and length", () => {
  assert.deepEqual([1, 2, 3].map((n) => abilityUpgradeCost("frostWave", "cooldown", n)), [10, 40, 90]);
  assert.deepEqual([1, 2].map((n) => abilityUpgradeCost("frostWave", "charges", n)), [10, 29]);
  assert.deepEqual([1, 2].map((n) => abilityUpgradeCost("frostWave", "length", n)), [5, 15]);
  const two: Upgrade[] = [1, 2].map(() => ({ ability: "frostWave", upgrade: "length", paid: 1 }));
  assert.equal(nextAbilityUpgradeCost(two, "frostWave", "length"), undefined);
  assert.deepEqual(
    abilityStats("frostWave", baseStats("caster"), { frostWave: { length: 2, charges: 1 } }).map((r) => [r.name, r.value]),
    [
      ["Damage", "2 to every monster on the line, which is frozen"],
      ["Length", "5 hexes"],
      ["Charges", "3 per game"],
      ["Cooldown", "4 turns"],
    ],
  );
  // A longer wave reaches further.
  const state = game({ monsters: [["basic", up(5)]], abilityUpgrades: { frostWave: { length: 2 } } });
  assert.equal(monster(turn(state, C, wave(up(1))).newState, 0).hp, 1);
});
