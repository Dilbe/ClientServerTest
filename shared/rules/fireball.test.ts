import { test } from "node:test";
import assert from "node:assert/strict";
import {
  abilitiesLine,
  abilitiesOf,
  abilityProblem,
  abilityStats,
  planAbilityProblem,
  type AbilityUpgradeCounts,
} from "./abilities.ts";
import { baseStats } from "./classes.ts";
import type { DungeonMap } from "./dungeon-map.ts";
import { applyEvents } from "./events.ts";
import type { CharacterId, GameState } from "./game-state.ts";
import { fromOffset, hex, hexKey, rectangle, type Hex } from "./hex.ts";
import { positionAfter } from "./planning.ts";
import { previewCycle } from "./preview.ts";
import { followUpPlan, newGameState, resolveTurn, type Plan, type PlannedAction } from "./turn.ts";
import { abilityUpgradeCost, applyUpgrade, nextAbilityUpgradeCost, type Upgrade } from "./upgrades.ts";

const C = 1;
const A = 2;

/** Where the caster stands: the middle of a 13 by 13 room. */
const CENTRE = fromOffset(6, 6);
const up = (steps: number): Hex => hex(CENTRE.q, CENTRE.r - steps);
const down = (steps: number): Hex => hex(CENTRE.q, CENTRE.r + steps);
const downRight = (steps: number): Hex => hex(CENTRE.q + steps, CENTRE.r);

/**
 * A pillar 2 hexes down-right of the caster. Monster 0, a brute, stands 3
 * hexes up; monster 1, a basic monster with 3 hit points, right next to it
 * (down-right of it); monster 2 behind the pillar; monster 3, a guard, far
 * down.
 */
const PILLAR = downRight(2);
const NEXT_TO_BRUTE = hex(CENTRE.q + 1, CENTRE.r - 3);
const MAP: DungeonMap = {
  hexes: rectangle(13, 13).filter((h) => hexKey(h) !== hexKey(PILLAR)),
  startHexes: [fromOffset(12, 12)],
  doors: [],
  monsters: [
    { type: "brute", position: up(3) },
    { type: "basic", position: NEXT_TO_BRUTE },
    { type: "basic", position: downRight(3) },
    { type: "guard", position: down(5) },
  ],
};

const fireball = (target: Hex): PlannedAction => ({ type: "fireball", target });

/** A rank 1 caster in the middle of the room, A off the map unless placed; the monsters never act. */
function game({
  actions = 1,
  attackDamage = 2,
  abilityUpgrades = {},
  aAt = null,
}: {
  actions?: number;
  attackDamage?: number;
  abilityUpgrades?: AbilityUpgradeCounts;
  aAt?: Hex | null;
} = {}): GameState {
  const state = newGameState(
    MAP,
    [
      {
        id: C,
        stats: { ...baseStats("caster"), actions, attackDamage },
        abilities: abilitiesOf("caster", 1),
        abilityUpgrades,
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

function turn(state: GameState, characterId: CharacterId, ...plan: Plan) {
  const plans = new Map<CharacterId, Plan>(plan.length > 0 ? [[characterId, plan]] : []);
  const result = resolveTurn(state, characterId, plans);
  assert.deepEqual(applyEvents(state, result.events), result.newState, "replaying the events");
  return result;
}

const caster = (state: GameState) => state.characters.find((c) => c.id === C)!;
const hp = (state: GameState) => state.monsters.map((m) => m.hp);

// --- Who has it, and its charges ---

test("a rank 1 caster has fireball, and every game starts with all its charges", () => {
  assert.ok(abilitiesOf("caster", 1).includes("fireball"));
  assert.ok(!abilitiesOf("adventurer", 5).includes("fireball"));
  assert.deepEqual(caster(game()).spellCharges, { fireball: 3 });
  assert.deepEqual(caster(game({ abilityUpgrades: { fireball: { charges: 2 } } })).spellCharges, { fireball: 5 });
  // Characters without spells have no charges to keep.
  assert.equal(game().characters[1]!.spellCharges, undefined);
});

// --- The area ---

test("a fireball hits every monster on the hex and around it, at once, for the full attack damage", () => {
  const state = game();
  const { newState, events } = turn(state, C, fireball(up(3)));
  assert.deepEqual(events, [
    { type: "attacked", attacker: { kind: "character", id: C }, target: { kind: "monster", id: 0 }, damage: 2, ability: "fireball" },
    { type: "attacked", attacker: { kind: "character", id: C }, target: { kind: "monster", id: 1 }, damage: 2, ability: "fireball" },
    { type: "chargeUsed", characterId: C, ability: "fireball" },
  ]);
  // Spells use the full attack damage, not the halved melee damage.
  assert.deepEqual(hp(newState).slice(0, 2), [18, 1]);
  assert.deepEqual(caster(newState).spellCharges, { fireball: 2 });
  // No cooldown: it can be cast again on the next turn.
  assert.deepEqual(caster(newState).cooldowns, {});
  assert.equal(planAbilityProblem(newState, C, [fireball(up(3))]), undefined);
});

test("the target hex doesn't need a monster on it, and each kill gives XP", () => {
  // Up 2 is empty, between the caster and the two monsters, and next to both.
  const { newState, events } = turn(game({ attackDamage: 3 }), C, fireball(up(2)));
  assert.deepEqual(hp(newState).slice(0, 2), [17, 0]);
  assert.ok(events.some((e) => e.type === "died" && e.who.kind === "monster" && e.who.id === 1));
  assert.ok(events.some((e) => e.type === "xpGained"));
});

test("a fireball never hurts characters, also not the caster", () => {
  // A stands next to the brute, in the area; the caster aims at its own neighbour.
  const aAt = hex(CENTRE.q - 1, CENTRE.r - 2);
  const { newState } = turn(game({ aAt }), C, fireball(up(3)));
  assert.equal(newState.characters[1]!.hp, 10);
  // The caster on its own hex, in the area of its own fireball.
  const near = game();
  const withMonster: GameState = { ...near, monsters: near.monsters.map((m) => (m.id === 1 ? { ...m, position: up(1) } : m)) };
  const self = turn(withMonster, C, fireball(CENTRE));
  assert.equal(caster(self.newState).hp, 6);
  assert.equal(self.newState.monsters[1]!.hp, 1);
});

test("a fireball wakes the monsters it hits", () => {
  const state = game();
  assert.equal(state.monsters[3]!.asleep, true);
  const target = down(4); // next to the guard, 4 hexes away
  const { newState, events } = turn(state, C, fireball(target));
  assert.equal(newState.monsters[3]!.asleep, false);
  assert.ok(events.some((e) => e.type === "monstersWoke" && e.monsterIds.includes(3)));
});

// --- Cancelling ---

test("a fireball that can't go through is cancelled and uses no charge", () => {
  const cases: [Hex, string, GameState?][] = [
    [downRight(3), "out of sight"], // behind the pillar
    [down(2), "no monster in area"],
    [up(5), "out of range"], // sent anyway
    [up(3), "out of sight", game({ aAt: up(1) })], // characters block the line of sight; monsters don't
  ];
  for (const [target, reason, state = game()] of cases) {
    const { newState, events } = turn(state, C, fireball(target));
    assert.deepEqual(events, [{ type: "planCancelled", characterId: C, action: 0, reason }], reason);
    assert.deepEqual(caster(newState).spellCharges, { fireball: 3 }, reason);
  }
  // A monster in the way doesn't block it: monster 1 is between the caster and this hex.
  const behindMonster = hex(CENTRE.q + 2, CENTRE.r - 4);
  assert.equal(turn(game(), C, fireball(behindMonster)).events[0]!.type, "attacked");
});

test("without charges left it can't be planned, and is cancelled if it comes anyway", () => {
  let state = game();
  for (let i = 0; i < 3; i++) state = turn(state, C, fireball(up(3))).newState;
  assert.deepEqual(caster(state).spellCharges, { fireball: 0 });
  assert.equal(abilityProblem(caster(state), "fireball", []), "No charges left");
  assert.equal(planAbilityProblem(state, C, [fireball(up(3))]), "Fireball can't be planned: no charges left.");
  const { events } = turn(state, C, fireball(up(3)));
  assert.deepEqual(events, [{ type: "planCancelled", characterId: C, action: 0, reason: "no charges" }]);
});

// --- The server's checks ---

test("the server refuses a fireball without the rank, out of range, or twice in a plan", () => {
  const state = game({ actions: 2 });
  assert.equal(planAbilityProblem(state, C, [fireball(up(4))]), undefined);
  assert.equal(planAbilityProblem(state, C, [fireball(CENTRE)]), undefined);
  assert.equal(
    planAbilityProblem(state, C, [fireball(up(5))]),
    "Fireball can't be planned: the hex is more than 4 hexes away.",
  );
  // From where the plan places the caster: a step up first brings up 5 within range.
  assert.equal(planAbilityProblem(state, C, [{ type: "move", to: up(1) }, fireball(up(5))]), undefined);
  assert.equal(
    planAbilityProblem(state, C, [fireball(up(3)), fireball(up(3))]),
    "Fireball can't be planned: already planned.",
  );
  const adventurer = { ...state, characters: state.characters.map((c) => ({ ...c, abilities: [] })) };
  assert.equal(planAbilityProblem(adventurer, C, [fireball(up(3))]), "Fireball can't be planned: needs a higher rank.");
});

// --- Planning, the preview and the details card ---

test("a fireball leaves the caster where it is, and no follow-up plan", () => {
  assert.deepEqual(positionAfter(CENTRE, fireball(up(3)), {}), CENTRE);
  const { newState, events } = turn(game(), C, fireball(up(3)));
  assert.equal(followUpPlan(newState, C, events), null);
});

test("the preview shows the monsters a fireball hits, and whether it goes through", () => {
  const state = game();
  const preview = previewCycle(state, [C, A], new Map([[C, [fireball(up(3))]]]));
  assert.deepEqual(preview.areaHits.get(C)?.fireball, [
    { monsterId: 0, at: up(3) },
    { monsterId: 1, at: NEXT_TO_BRUTE },
  ]);
  const blocked = previewCycle(state, [C, A], new Map([[C, [fireball(downRight(3))]]]));
  assert.deepEqual(blocked.cancellations, [{ type: "planCancelled", characterId: C, action: 0, reason: "out of sight" }]);
});

test("the details card shows the charges left", () => {
  const state = game();
  assert.equal(abilitiesLine(caster(state), []), "Fireball 3/3 ✓");
  assert.equal(abilitiesLine(caster(state), [fireball(up(3))]), "Fireball 3/3 planned");
  const empty = { ...caster(state), spellCharges: { fireball: 0 } };
  assert.equal(abilitiesLine(empty, []), "Fireball 0/3");
});

// --- Upgrades ---

test("a charge upgrade costs 10, 29, 52, at most 3, and counts at once in a game", () => {
  assert.deepEqual([1, 2, 3].map((n) => abilityUpgradeCost("fireball", "charges", n)), [10, 29, 52]);
  const three: Upgrade[] = [1, 2, 3].map(() => ({ ability: "fireball", upgrade: "charges", paid: 1 }));
  assert.equal(nextAbilityUpgradeCost(three, "fireball", "charges"), undefined);
  assert.equal(nextAbilityUpgradeCost([], "fireball", "cooldown"), undefined);
  assert.deepEqual(
    abilityStats("fireball", baseStats("caster"), { fireball: { charges: 1 } }).map((row) => [row.name, row.value]),
    [
      ["Damage", "2 to every monster on the hex and the 6 around it"],
      ["Range", "0 to 4 hexes, in line of sight"],
      ["Charges", "4 per game"],
    ],
  );
  // Bought during a game: one more charge to use right away.
  let state = turn(game(), C, fireball(up(3))).newState;
  state = applyUpgrade(state, C, "caster", { ability: "fireball", upgrade: "charges" });
  assert.deepEqual(caster(state).spellCharges, { fireball: 3 });
  assert.equal(abilitiesLine(caster(state), []), "Fireball 3/4 ✓");
});
