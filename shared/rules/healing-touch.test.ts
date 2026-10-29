import { test } from "node:test";
import assert from "node:assert/strict";
import { abilitiesOf, abilityStats, planAbilityProblem } from "./abilities.ts";
import { baseStats } from "./classes.ts";
import type { DungeonMap } from "./dungeon-map.ts";
import { applyEvents } from "./events.ts";
import type { CharacterId, GameState, MonsterId } from "./game-state.ts";
import { fromOffset, hex, rectangle, type Hex } from "./hex.ts";
import { previewCycle } from "./preview.ts";
import { createTrack } from "./track.ts";
import { followUpPlan, newGameState, resolveTurn, type Plan, type PlannedAction } from "./turn.ts";
import { abilityUpgradeCost, nextAbilityUpgradeCost, type Upgrade } from "./upgrades.ts";

const H = 1;
const A = 2;
const B = 3;
/** Where the healer stands: the middle of a 9 by 9 room. */
const CENTRE = fromOffset(4, 4);
const at = (dq: number, dr: number): Hex => hex(CENTRE.q + dq, CENTRE.r + dr);
const up = (steps: number) => at(0, -steps);
const down = (steps: number) => at(0, steps);

const touch = (target: CharacterId): PlannedAction => ({ type: "healingTouch", target });

/**
 * A healer of `rank` in the middle of a 9 by 9 room, A right below it and B
 * further away, each with the hit points given. A monster stands far away
 * in a corner; `monsterFollows` makes it act after that character.
 */
function game({
  rank = 1,
  actions = 1,
  hp = {},
  aAt = down(1),
  bAt = up(3),
  monster = fromOffset(0, 8),
  monsterFollows,
}: {
  rank?: number;
  actions?: number;
  hp?: Partial<Record<CharacterId, number>>;
  aAt?: Hex | null;
  bAt?: Hex | null;
  monster?: Hex;
  monsterFollows?: CharacterId;
} = {}): GameState {
  const map: DungeonMap = { hexes: rectangle(9, 9), startHexes: [fromOffset(8, 0)], doors: [], monsters: [{ type: "basic", position: monster }] };
  const state = newGameState(
    map,
    [
      { id: H, stats: { ...baseStats("healer"), actions }, abilities: abilitiesOf("healer", rank), classId: "healer" },
      { id: A, stats: baseStats("adventurer") },
      { id: B, stats: baseStats("adventurer") },
    ],
    createTrack([H, A, B], new Map<MonsterId, CharacterId>(monsterFollows === undefined ? [] : [[0, monsterFollows]])),
  );
  const positions: Record<CharacterId, Hex | null> = { [H]: CENTRE, [A]: aAt, [B]: bAt };
  return {
    ...state,
    characters: state.characters.map((c) => ({ ...c, position: positions[c.id]!, hp: hp[c.id] ?? c.hp })),
  };
}

function turn(state: GameState, who: CharacterId, ...plan: Plan) {
  const result = resolveTurn(state, who, new Map<CharacterId, Plan>([[who, plan]]));
  assert.deepEqual(applyEvents(state, result.events), result.newState, "replaying the events");
  return result;
}

const hpOf = (state: GameState, id: CharacterId) => state.characters.find((c) => c.id === id)!.hp;
const cancelled = (reason: string) => [{ type: "planCancelled", characterId: H, action: 0, reason }];

test("a rank 1 healer has healing touch: cooldown 2, healing its healing power", () => {
  assert.deepEqual(abilitiesOf("healer", 1), ["healingTouch"]);
  assert.deepEqual(abilityStats("healingTouch", baseStats("healer")), [
    { name: "Healing", value: "3 hit points, never above the max" },
    { name: "Cooldown", value: "2 turns", upgrade: "cooldown" },
  ]);
});

test("healing touch heals an adjacent ally for the healing power, and starts the cooldown", () => {
  const { events, newState } = turn(game({ hp: { [A]: 4 } }), H, touch(A));
  assert.deepEqual(events, [
    { type: "healed", characterId: H, targetId: A, healed: 3, ability: "healingTouch" },
    { type: "cooldownStarted", characterId: H, ability: "healingTouch", turns: 2 },
  ]);
  assert.equal(hpOf(newState, A), 7);
  // No XP for healing, and no follow-up plan.
  assert.equal(newState.characters.find((c) => c.id === H)!.xpGained, 0);
  assert.equal(followUpPlan(newState, H, events), null);
});

test("the healer can heal itself", () => {
  const { events, newState } = turn(game({ hp: { [H]: 2 } }), H, touch(H));
  assert.deepEqual(events[0], { type: "healed", characterId: H, targetId: H, healed: 3, ability: "healingTouch" });
  assert.equal(hpOf(newState, H), 5);
});

test("a heal never goes above the max hit points, and the event says what it really healed", () => {
  const { events, newState } = turn(game({ hp: { [A]: 9 } }), H, touch(A));
  assert.deepEqual(events[0], { type: "healed", characterId: H, targetId: A, healed: 1, ability: "healingTouch" });
  assert.equal(hpOf(newState, A), 10);
  // More healing power heals more.
  const strong = game({ hp: { [A]: 2 } });
  strong.characters[0] = { ...strong.characters[0]!, stats: { ...strong.characters[0]!.stats, healingPower: 5 } };
  assert.equal(hpOf(turn(strong, H, touch(A)).newState, A), 7);
});

test("healing touch is cancelled at full hit points, not next to the healer, or on the dead, without the cooldown", () => {
  assert.deepEqual(turn(game(), H, touch(A)).events, cancelled("full hit points"));
  assert.deepEqual(turn(game({ hp: { [B]: 4 } }), H, touch(B)).events, cancelled("not a neighbour"));
  assert.deepEqual(turn(game({ hp: { [A]: 0 } }), H, touch(A)).events, cancelled("no ally"));
  assert.deepEqual(turn(game({ aAt: null, hp: { [A]: 4 } }), H, touch(A)).events, cancelled("no ally"));
});

test("a heal follows its target: an ally that moved next to the healer is healed, one that moved away isn't", () => {
  // A plans to step away and then back next to the healer; B steps next to it.
  const state = game({ actions: 1, hp: { [A]: 4, [B]: 4 }, bAt: up(2) });
  const awayA = turn(state, A, { type: "move", to: down(2) }).newState;
  assert.deepEqual(turn(awayA, H, touch(A)).events, cancelled("not a neighbour"));
  const closerB = turn(state, B, { type: "move", to: up(1) }).newState;
  assert.equal(hpOf(turn(closerB, H, touch(B)).newState, B), 7);
});

test("a heal on an ally that died first is cancelled", () => {
  // A brute next to A kills it in the turn before the healer's.
  const state = game({ hp: { [A]: 1 }, monster: down(2), monsterFollows: A });
  const preview = previewCycle(state, [A, H], new Map([[H, [touch(A)]]]));
  assert.deepEqual(preview.cancellations, [{ type: "planCancelled", characterId: H, action: 0, reason: "no ally" }]);
});

test("the preview shows the hit points after the heal, and a change in whom the monsters go after", () => {
  // The monster is as close to A as to B, and goes after the one with the
  // fewest hit points: A at 5, until the healer heals it to 8.
  const state = game({ aAt: at(-1, 0), bAt: at(1, -1), monster: up(3), monsterFollows: H, hp: { [A]: 5, [B]: 6 } });
  const target = (plans: Map<CharacterId, Plan>) => {
    const p = previewCycle(state, [H], plans).monsters.get(0)!;
    assert.equal(p.type, "acts");
    return p.type === "acts" ? p.steps[0]!.type === "move" && p.steps[0]!.target : undefined;
  };
  assert.equal(target(new Map()), A);
  const plans = new Map([[H, [touch(A)]]]);
  assert.equal(target(plans), B);
  assert.deepEqual(previewCycle(state, [H], plans).heals.get(H), [
    { ability: "healingTouch", targetId: A, healed: 3, hpAfter: 8 },
  ]);
});

test("the server checks the rank, the cooldown, one per plan, and that the target is a living character next to the planned position", () => {
  const state = game({ actions: 2, hp: { [A]: 4 } });
  assert.equal(planAbilityProblem(state, H, [touch(A)]), undefined);
  assert.equal(planAbilityProblem(state, H, [touch(H)]), undefined);
  // Next to the hex the plan moves the healer to.
  assert.equal(planAbilityProblem(state, H, [{ type: "move", to: up(2) }, touch(B)]), undefined);
  assert.equal(
    planAbilityProblem(state, H, [touch(B)]),
    "Healing touch can't be planned: the target isn't next to the character.",
  );
  assert.equal(
    planAbilityProblem(game({ hp: { [A]: 0 } }), H, [touch(A)]),
    "Healing touch can't be planned: the target isn't a living character on the map.",
  );
  assert.equal(
    planAbilityProblem(state, H, [touch(A), touch(H)]),
    "Healing touch can't be planned: already planned.",
  );
  const used = turn(state, H, touch(A)).newState;
  assert.equal(planAbilityProblem(used, H, [touch(A)]), "Healing touch can't be planned: ready in 3 turns.");
  // An adventurer doesn't have it.
  assert.equal(planAbilityProblem(state, A, [touch(H)]), "Healing touch can't be planned: needs a higher rank.");
});

test("healing touch's cooldown can be upgraded once, for 10 points, down to 1", () => {
  assert.equal(abilityUpgradeCost("healingTouch", "cooldown", 1), 10);
  const once: Upgrade[] = [{ ability: "healingTouch", upgrade: "cooldown", paid: 10 }];
  assert.equal(nextAbilityUpgradeCost(once, "healingTouch", "cooldown"), undefined);
  assert.equal(
    abilityStats("healingTouch", baseStats("healer"), { healingTouch: { cooldown: 1 } }).at(-1)!.value,
    "1 turn",
  );
});
