import { test } from "node:test";
import assert from "node:assert/strict";
import { abilitiesOf, abilityCooldown, planAbilityProblem, type AbilityUpgradeCounts } from "./abilities.ts";
import { baseStats } from "./classes.ts";
import type { DungeonMap } from "./dungeon-map.ts";
import { applyEvents, type GameEvent } from "./events.ts";
import { isFree, type CharacterId, type GameState, type Trap } from "./game-state.ts";
import { fromOffset, hex, hexKey, rectangle, type Hex } from "./hex.ts";
import { previewCycle } from "./preview.ts";
import type { MonsterTypeId } from "./stats.ts";
import { followUpPlan, newGameState, resolveTurn, type Plan, type PlannedAction } from "./turn.ts";
import { abilityUpgradeCost } from "./upgrades.ts";

const R = 1;
const A = 2;
const S = 3;

/** Where the ranger stands: the middle of a 13 by 13 room. */
const CENTRE = fromOffset(6, 6);
const up = (steps: number): Hex => hex(CENTRE.q, CENTRE.r - steps);
const down = (steps: number): Hex => hex(CENTRE.q, CENTRE.r + steps);

const PILLAR = down(1);
const setTrap = (target: Hex): PlannedAction => ({ type: "trap", target });

/**
 * A ranger of `rank` in the middle of the room, A (an adventurer) at `aAt`
 * and S (a second rank 4 ranger) at `sAt`, off the map without them. The
 * monsters act in the turn of `slot`, R's unless it says otherwise.
 */
function game({
  monsters,
  rank = 4,
  attackDamage = 1,
  actions = 1,
  abilityUpgrades = {},
  aAt = null,
  sAt = null,
  traps,
  slot = R,
}: {
  monsters: [MonsterTypeId, Hex][];
  rank?: number;
  attackDamage?: number;
  actions?: number;
  abilityUpgrades?: AbilityUpgradeCounts;
  aAt?: Hex | null;
  sAt?: Hex | null;
  traps?: Trap[];
  slot?: CharacterId;
}): GameState {
  const map: DungeonMap = {
    hexes: rectangle(13, 13).filter((h) => hexKey(h) !== hexKey(PILLAR)),
    startHexes: [fromOffset(12, 12)],
    doors: [],
    monsters: monsters.map(([type, position]) => ({ type, position })),
  };
  const ranger = (id: CharacterId) => ({
    id,
    stats: { ...baseStats("ranger"), attackDamage, actions },
    abilities: abilitiesOf("ranger", rank),
    abilityUpgrades,
    classId: "ranger" as const,
  });
  const ids = monsters.map((_, i) => i);
  const state = newGameState(
    map,
    [ranger(R), { id: A, stats: baseStats("adventurer"), classId: "adventurer" }, ranger(S)],
    [R, A, S].map((characterId) => ({ characterId, monsterIds: characterId === slot ? ids : [] })),
  );
  const at = new Map<CharacterId, Hex | null>([
    [R, CENTRE],
    [A, aAt],
    [S, sAt],
  ]);
  return {
    ...state,
    characters: state.characters.map((c) => ({ ...c, position: at.get(c.id) ?? null })),
    ...(traps && { traps }),
  };
}

function turn(state: GameState, characterId: CharacterId, ...plan: Plan) {
  const plans = new Map<CharacterId, Plan>(plan.length > 0 ? [[characterId, plan]] : []);
  const result = resolveTurn(state, characterId, plans);
  assert.deepEqual(applyEvents(state, result.events), result.newState, "replaying the events");
  return result;
}

const monster = (state: GameState, id: number) => state.monsters.find((m) => m.id === id)!;
const cancelled = (events: readonly GameEvent[]) => events.flatMap((e) => (e.type === "planCancelled" ? [e.reason] : []));

// --- Setting it ---

test("a rank 4 ranger has trap: 1 action, cooldown 5", () => {
  assert.ok(!abilitiesOf("ranger", 3).includes("trap"));
  assert.ok(abilitiesOf("ranger", 4).includes("trap"));
  assert.equal(abilityCooldown("trap", {}), 5);
});

test("a ranger sets a trap on a free hex next to it", () => {
  const { newState, events } = turn(game({ monsters: [["rat", fromOffset(0, 0)]], slot: A }), R, setTrap(up(1)));
  assert.deepEqual(events, [
    { type: "trapSet", characterId: R, hex: up(1) },
    { type: "cooldownStarted", characterId: R, ability: "trap", turns: 5 },
  ]);
  assert.deepEqual(newState.traps, [{ characterId: R, hex: up(1) }]);
});

test("one trap per ranger: a new one replaces the old one; another ranger's stays", () => {
  const state = game({ monsters: [["rat", fromOffset(0, 0)]], slot: A, traps: [{ characterId: R, hex: down(2) }, { characterId: S, hex: up(4) }] });
  const { newState } = turn(state, R, setTrap(up(1)));
  assert.deepEqual(newState.traps, [{ characterId: S, hex: up(4) }, { characterId: R, hex: up(1) }]);
});

test("cancelled on a hex that is taken, or not next to the ranger, without starting the cooldown", () => {
  const cases: [Hex, string, Partial<Parameters<typeof game>[0]>][] = [
    [up(2), "not a neighbour", {}],
    [PILLAR, "not on the map", {}],
    [up(1), "hex taken", { monsters: [["rat", up(1)]] }],
    [up(1), "hex taken", { aAt: up(1) }],
    // Another ranger's trap there: one trap per hex.
    [up(1), "hex taken", { traps: [{ characterId: S, hex: up(1) }] }],
  ];
  for (const [target, reason, options] of cases) {
    const state = game({ monsters: [["rat", fromOffset(0, 0)]], slot: A, ...options });
    const { newState, events } = turn(state, R, setTrap(target));
    assert.deepEqual(cancelled(events), [reason], reason);
    assert.deepEqual(newState.characters[0]!.cooldowns, {}, reason);
  }
  const walled = game({ monsters: [["rat", fromOffset(0, 0)]], slot: A });
  const withWall: GameState = { ...walled, createdWalls: [{ characterId: A, hexes: [up(1)], turnsLeft: 2 }] };
  assert.deepEqual(cancelled(turn(withWall, R, setTrap(up(1))).events), ["created wall"]);
});

// --- Setting it off ---

test("the first monster that steps on it takes 2 × the attack damage and loses the rest of its actions", () => {
  // A rat, 2 actions, 3 hexes up: it steps onto the trap 2 hexes up and stops there.
  const state = game({ monsters: [["rat", up(3)]], traps: [{ characterId: R, hex: up(2) }] });
  const { newState, events } = turn(state, R);
  assert.deepEqual(events, [
    { type: "moved", actor: { kind: "monster", id: 0 }, from: up(3), to: up(2) },
    { type: "trapTriggered", characterId: R, monsterId: 0 },
    { type: "attacked", attacker: { kind: "character", id: R }, target: { kind: "monster", id: 0 }, damage: 2, ability: "trap" },
  ]);
  assert.equal(monster(newState, 0).hp, 1);
  assert.deepEqual(monster(newState, 0).position, up(2));
  // The trap is gone, and setting it off didn't start any cooldown.
  assert.equal(newState.traps, undefined);
  assert.deepEqual(newState.characters[0]!.cooldowns, {});
});

test("a kill by a trap gives XP; a later monster walks over the hex", () => {
  const state = game({ monsters: [["rat", up(3)], ["rat", up(4)]], attackDamage: 2, traps: [{ characterId: R, hex: up(2) }] });
  const { newState, events } = turn(state, R);
  assert.equal(monster(newState, 0).hp, 0);
  assert.ok(events.some((e) => e.type === "died" && e.who.kind === "monster" && e.who.id === 0));
  assert.ok(events.some((e) => e.type === "xpGained"));
  // The second rat walks onto the hex where the trap was, and nothing goes off.
  assert.deepEqual(monster(newState, 1).position, up(2));
  assert.equal(events.filter((e) => e.type === "trapTriggered").length, 1);
});

test("it works also when the ranger is dead, with the ranger's attack damage", () => {
  // A stands where the ranger died, so the rat walks the same way.
  const state = game({ monsters: [["rat", up(3)]], attackDamage: 2, traps: [{ characterId: R, hex: up(2) }], aAt: CENTRE, slot: A });
  const dead: GameState = { ...state, characters: state.characters.map((c) => (c.id === R ? { ...c, hp: 0 } : c)), track: state.track.filter((s) => s.characterId !== R) };
  const { newState } = turn(dead, A);
  assert.equal(monster(newState, 0).hp, 0);
});

test("characters don't set it off and walk over it; it blocks nothing", () => {
  const state = game({ monsters: [["rat", fromOffset(0, 0)]], slot: S, aAt: up(1), traps: [{ characterId: R, hex: up(2) }] });
  assert.ok(isFree(state, up(2)));
  const { newState, events } = turn(state, A, { type: "move", to: up(2) });
  assert.deepEqual(events, [{ type: "moved", actor: { kind: "character", id: A }, from: up(1), to: up(2) }]);
  assert.deepEqual(newState.traps, [{ characterId: R, hex: up(2) }]);
});

test("monsters don't know about traps, and the preview shows which monster sets it off", () => {
  const state = game({ monsters: [["rat", up(3)]], traps: [{ characterId: R, hex: up(2) }] });
  const preview = previewCycle(state, [R, A, S], new Map());
  assert.deepEqual(preview.monsters.get(0), {
    type: "acts",
    after: R,
    steps: [
      { type: "move", from: up(3), to: up(2), target: R },
      { type: "trap", by: R, damage: 2, kills: false },
    ],
  });
});

test("a trap going off isn't the ranger's action: its follow-up plan still shoots its own target", () => {
  // The ranger shoots a brute 3 hexes down-left; then its rat sets off its trap.
  const brute = hex(CENTRE.q - 3, CENTRE.r + 3);
  const state = game({ monsters: [["rat", up(3)], ["brute", brute]], traps: [{ characterId: R, hex: up(2) }] });
  const plan: Plan = [{ type: "attack", target: brute }];
  const { newState, events } = turn(state, R, ...plan);
  assert.ok(events.some((e) => e.type === "trapTriggered"));
  assert.deepEqual(followUpPlan(newState, R, events), [{ type: "attack", target: monster(newState, 1).position }]);
});

// --- The server's check ---

test("the server checks the rank, the cooldown, at most one per plan and a hex next to the planned position", () => {
  const state = game({ monsters: [["rat", up(3)]], actions: 2 });
  // Taken now is fine: that may change before the turn fires.
  assert.equal(planAbilityProblem(state, R, [setTrap(up(1))]), undefined);
  assert.equal(planAbilityProblem(state, R, [setTrap(up(2))]), "Trap can't be planned: the hex isn't next to the character.");
  assert.equal(planAbilityProblem(state, R, [{ type: "move", to: up(1) }, setTrap(up(2))]), undefined);
  assert.equal(planAbilityProblem(state, R, [setTrap(up(1)), setTrap(down(1))]), "Trap can't be planned: already planned.");
  assert.equal(planAbilityProblem(game({ monsters: [], rank: 3 }), R, [setTrap(up(1))]), "Trap can't be planned: needs a higher rank.");
  const after = turn(game({ monsters: [["rat", fromOffset(0, 0)]], slot: A }), R, setTrap(up(1))).newState;
  assert.equal(planAbilityProblem(after, R, [setTrap(up(1))]), "Trap can't be planned: ready in 6 turns.");
});

test("only its cooldown can be upgraded", () => {
  assert.deepEqual([1, 2, 3, 4].map((n) => abilityUpgradeCost("trap", "cooldown", n)), [10, 40, 90, 160]);
  assert.equal(abilityUpgradeCost("trap", "length", 1), undefined);
});
