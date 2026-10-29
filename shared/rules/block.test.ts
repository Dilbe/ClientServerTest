import { test } from "node:test";
import assert from "node:assert/strict";
import {
  abilitiesLine,
  abilitiesOf,
  abilityProblem,
  abilityStats,
  blockAttack,
  type AbilityUpgradeCounts,
} from "./abilities.ts";
import { baseStats } from "./classes.ts";
import { monsterStats } from "./difficulties.ts";
import type { DungeonMap } from "./dungeon-map.ts";
import { applyEvents, type GameEvent } from "./events.ts";
import type { CharacterId, GameState } from "./game-state.ts";
import { fromOffset, neighbours, rectangle } from "./hex.ts";
import { previewCycle } from "./preview.ts";
import { newGameState, resolveTurn, type Plan } from "./turn.ts";
import { abilityUpgradeCost, nextAbilityUpgradeCost, type Upgrade } from "./upgrades.ts";

const T = 1;
const B = 2;

/** Where the tank stands: the middle of the room. */
const CENTRE = fromOffset(4, 4);

/**
 * One room of 9 by 9 hexes. Monster 0 is an archer 2 hexes straight above
 * the tank, monster 1 a brute next to it and monster 2 a rat (2 actions)
 * next to it. In that order they attack the tank, when they follow it.
 */
const MAP: DungeonMap = {
  hexes: rectangle(9, 9),
  startHexes: [fromOffset(8, 8)],
  doors: [],
  monsters: [
    { type: "archer", position: fromOffset(4, 2) },
    { type: "brute", position: neighbours(CENTRE)[3]! },
    { type: "rat", position: neighbours(CENTRE)[2]! },
  ],
};

const BRUTE_DAMAGE = monsterStats("brute", "normal").attackDamage;

/** A rank 1 tank in the middle of the room, every monster following it; B off the map. */
function game(abilityUpgrades: AbilityUpgradeCounts = {}): GameState {
  const state = newGameState(
    MAP,
    [
      { id: T, stats: baseStats("tank"), abilities: abilitiesOf("tank", 1), abilityUpgrades },
      { id: B, stats: baseStats("adventurer") },
    ],
    [
      { characterId: T, monsterIds: [0, 1, 2] },
      { characterId: B, monsterIds: [] },
    ],
  );
  return { ...state, characters: state.characters.map((c) => (c.id === T ? { ...c, position: CENTRE } : c)) };
}

/** Resolves one turn, and checks that replaying the events gives the same state. */
function turn(state: GameState, characterId: CharacterId, plan: Plan = []) {
  const plans = new Map<CharacterId, Plan>(plan.length > 0 ? [[characterId, plan]] : []);
  const result = resolveTurn(state, characterId, plans);
  assert.deepEqual(applyEvents(state, result.events), result.newState, "replaying the events");
  return result;
}

function tank(state: GameState) {
  return state.characters.find((c) => c.id === T)!;
}

/** The attacks on the tank, as damage and blocked damage. */
function hits(events: readonly GameEvent[]): [damage: number, blocked: number][] {
  return events.flatMap((e) =>
    e.type === "attacked" && e.target.kind === "character" ? [[e.damage, e.blocked ?? 0] as [number, number]] : [],
  );
}

// --- Who has it ---

test("a tank has block from rank 1; it is passive, so it can never be planned", () => {
  assert.deepEqual(abilitiesOf("tank", 1), ["block"]);
  assert.ok(!abilitiesOf("adventurer", 5).includes("block"));
  assert.equal(abilityProblem(tank(game()), "block", []), "Works by itself");
});

test("the character page shows the charges and the damage blocked, with upgrades and no cooldown", () => {
  assert.deepEqual(abilityStats("block", baseStats("tank")), [
    { name: "Charges", value: "2 per turn", upgrade: "charges" },
    { name: "Damage blocked", value: "1 per charge", upgrade: "blockedDamage" },
  ]);
  assert.deepEqual(abilityStats("block", baseStats("tank"), { block: { charges: 3, blockedDamage: 2 } }), [
    { name: "Charges", value: "5 per turn", upgrade: "charges" },
    { name: "Damage blocked", value: "3 per charge", upgrade: "blockedDamage" },
  ]);
});

// --- What it does ---

test("every attack on the tank uses a charge and does 1 damage less, in the order the attacks happen", () => {
  const state = game();
  assert.equal(tank(state).blockCharges, 2);
  const { newState, events } = turn(state, T);
  // The archer's shot (1) and the brute's hit (3) use the 2 charges; the rat's two bites (1 each) don't get one.
  assert.deepEqual(hits(events), [
    [0, 1],
    [BRUTE_DAMAGE - 1, 1],
    [1, 0],
    [1, 0],
  ]);
  assert.equal(tank(newState).blockCharges, 0);
  assert.equal(tank(newState).hp, 20 - (BRUTE_DAMAGE - 1) - 2);
});

test("the charges are back to full at the start of the tank's turn; unused ones don't carry over", () => {
  const used = turn(game(), T).newState;
  const { events } = turn(used, T);
  assert.deepEqual(events[0], { type: "blockRefilled", characterId: T, charges: 2 });
  // Full already: nothing to refill.
  const full = game();
  const quiet = { ...full, track: full.track.map((slot) => ({ ...slot, monsterIds: [] })) };
  assert.ok(!turn(quiet, T).events.some((e) => e.type === "blockRefilled"));
});

test("an attack that would do no damage uses no charge; a block never goes below 0 damage", () => {
  const state = game({ block: { blockedDamage: 2 } });
  assert.deepEqual(blockAttack(tank(state), 0), { damage: 0, blocked: 0 });
  // 3 blocked per charge: a hit for 1 does 0, not −2.
  assert.deepEqual(blockAttack(tank(state), 1), { damage: 0, blocked: 1 });
  assert.deepEqual(blockAttack(tank(state), 5), { damage: 2, blocked: 3 });
  // Without charges left, nothing is blocked.
  assert.deepEqual(blockAttack({ ...tank(state), blockCharges: 0 }, 5), { damage: 5, blocked: 0 });
});

test("the upgrades give more charges and block more damage", () => {
  const { events } = turn(game({ block: { charges: 3, blockedDamage: 2 } }), T);
  // 5 charges, 3 damage each: every attack is blocked completely.
  assert.deepEqual(hits(events), [
    [0, 1],
    [0, BRUTE_DAMAGE],
    [0, 1],
    [0, 1],
  ]);
});

test("the upgrades cost as in design.md and stop at their limits", () => {
  const costs = (upgrade: "charges" | "blockedDamage", count: number) =>
    Array.from({ length: count }, (_, i) => abilityUpgradeCost("block", upgrade, i + 1));
  assert.deepEqual(costs("charges", 3), [10, 29, 52]);
  assert.deepEqual(costs("blockedDamage", 2), [30, 100]);
  const maxed: Upgrade[] = [
    ...[10, 29, 52].map((paid) => ({ ability: "block" as const, upgrade: "charges" as const, paid })),
    ...[30, 100].map((paid) => ({ ability: "block" as const, upgrade: "blockedDamage" as const, paid })),
  ];
  assert.equal(nextAbilityUpgradeCost(maxed, "block", "charges"), undefined);
  assert.equal(nextAbilityUpgradeCost(maxed, "block", "blockedDamage"), undefined);
  // Block has no cooldown to shorten.
  assert.equal(nextAbilityUpgradeCost([], "block", "cooldown"), undefined);
});

// --- Showing it ---

test("the details card shows the charges left", () => {
  const used = turn(game(), T).newState;
  assert.equal(abilitiesLine(tank(game()), []), "Block 2/2");
  assert.equal(abilitiesLine(tank(used), []), "Block 0/2");
});

test("the preview shows the blocked damage, and matches what happens", () => {
  const state = game();
  const preview = previewCycle(state, [T, B], new Map());
  assert.deepEqual(preview.turns[0]!.events, resolveTurn(state, T, new Map()).events);
  const brute = preview.monsters.get(1);
  assert.equal(brute?.type, "acts");
  assert.deepEqual(brute.type === "acts" && brute.steps[0], {
    type: "attack",
    target: T,
    targetAt: CENTRE,
    damage: BRUTE_DAMAGE - 1,
    blocked: 1,
    kills: false,
  });
});
