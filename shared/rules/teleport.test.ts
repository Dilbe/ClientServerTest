import { test } from "node:test";
import assert from "node:assert/strict";
import { abilitiesOf, abilityStats, planAbilityProblem } from "./abilities.ts";
import { baseStats } from "./classes.ts";
import type { DungeonMap } from "./dungeon-map.ts";
import { applyEvents } from "./events.ts";
import type { CharacterId, GameState } from "./game-state.ts";
import { fromOffset, hex, hexKey, rectangle, type Hex } from "./hex.ts";
import { positionAfter } from "./planning.ts";
import { previewCycle } from "./preview.ts";
import { followUpPlan, newGameState, resolveTurn, type Plan, type PlannedAction } from "./turn.ts";
import { abilityUpgradeCost } from "./upgrades.ts";

const C = 1;
const A = 2;

/**
 * Two rooms: a 7 by 9 room on the left, where the caster stands, and on the
 * right of a wall (column 7) a second room behind a closed door. A pillar
 * stands 2 hexes up from the caster; monster 0 3 hexes up; monster 1 asleep
 * in the right-hand room.
 */
const CENTRE = fromOffset(4, 4);
const up = (steps: number): Hex => hex(CENTRE.q, CENTRE.r - steps);
const down = (steps: number): Hex => hex(CENTRE.q, CENTRE.r + steps);
const DOOR = fromOffset(7, 4);
const PILLAR = up(2);
const WALL = rectangle(10, 9).filter((h) => h.q === 7 && hexKey(h) !== hexKey(DOOR));
/** In the right-hand room, 4 hexes from the caster. */
const BEHIND_DOOR = fromOffset(8, 4);
const MAP: DungeonMap = {
  hexes: rectangle(10, 9).filter((h) => hexKey(h) !== hexKey(PILLAR) && !WALL.some((w) => hexKey(w) === hexKey(h))),
  startHexes: [fromOffset(0, 8)],
  doors: [DOOR],
  monsters: [
    { type: "basic", position: up(3) },
    { type: "basic", position: fromOffset(9, 8) },
  ],
};

const teleport = (target: Hex): PlannedAction => ({ type: "teleport", target });

/** A rank 3 caster in the middle of the left room, A off the map unless placed; the monsters never act. */
function game({ rank = 3, actions = 1, aAt = null }: { rank?: number; actions?: number; aAt?: Hex | null } = {}): GameState {
  const state = newGameState(
    MAP,
    [
      { id: C, stats: { ...baseStats("caster"), actions }, abilities: abilitiesOf("caster", rank), classId: "caster" },
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

const casterAt = (state: GameState) => state.characters.find((c) => c.id === C)!.position;

test("a rank 3 caster has teleport, with a cooldown of 4 and only a cooldown upgrade", () => {
  assert.ok(!abilitiesOf("caster", 2).includes("teleport"));
  assert.ok(abilitiesOf("caster", 3).includes("teleport"));
  assert.deepEqual(
    abilityStats("teleport", baseStats("caster")).map((row) => row.value),
    ["1 to 5 hexes, no line of sight needed", "4 turns"],
  );
  assert.deepEqual([1, 2, 3].map((n) => abilityUpgradeCost("teleport", "cooldown", n)), [10, 40, 90]);
  assert.equal(abilityUpgradeCost("teleport", "range", 1), undefined);
});

test("a teleport moves the caster up to 5 hexes, past walls and monsters, and starts the cooldown", () => {
  // Up 4: past the pillar and monster 0, without line of sight.
  const { newState, events } = turn(game(), teleport(up(4)));
  assert.deepEqual(events, [
    { type: "moved", actor: { kind: "character", id: C }, from: CENTRE, to: up(4), ability: "teleport" },
    { type: "cooldownStarted", characterId: C, ability: "teleport", turns: 4 },
  ]);
  assert.deepEqual(casterAt(newState), up(4));
  assert.equal(followUpPlan(newState, C, events), null);
});

test("a teleport is all or nothing: cancelled without a cooldown when it can't land", () => {
  const cases: [Hex, string, GameState?][] = [
    [up(3), "hex taken"], // monster 0
    [down(2), "hex taken", game({ aAt: down(2) })], // a character
    [PILLAR, "not on the map"],
    [DOOR, "door closed"],
    [BEHIND_DOOR, "closed room"],
    [hex(CENTRE.q, CENTRE.r + 6), "out of range"], // sent anyway
  ];
  for (const [target, reason, state = game()] of cases) {
    const { newState, events } = turn(state, teleport(target));
    assert.deepEqual(events, [{ type: "planCancelled", characterId: C, action: 0, reason }], reason);
    assert.deepEqual(casterAt(newState), CENTRE);
    assert.deepEqual(newState.characters[0]!.cooldowns, {});
  }
});

test("once the door is open, the other room can be reached", () => {
  const open = { ...game(), closedDoors: [] };
  assert.deepEqual(casterAt(turn(open, teleport(BEHIND_DOOR)).newState), BEHIND_DOOR);
});

test("the server checks the rank, the distance and the room, but not whether the hex is free", () => {
  const state = game({ actions: 2 });
  assert.equal(planAbilityProblem(state, C, [teleport(up(3))]), undefined); // taken now, but may be free by then
  assert.equal(
    planAbilityProblem(state, C, [teleport(hex(CENTRE.q, CENTRE.r + 6))]),
    "Teleport can't be planned: the hex isn't 1 to 5 hexes away.",
  );
  assert.equal(
    planAbilityProblem(state, C, [teleport(BEHIND_DOOR)]),
    "Teleport can't be planned: the hex is behind a closed door.",
  );
  assert.equal(
    planAbilityProblem(game({ rank: 2 }), C, [teleport(up(4))]),
    "Teleport can't be planned: needs a higher rank.",
  );
  assert.equal(
    planAbilityProblem(state, C, [teleport(up(4)), teleport(down(1))]),
    "Teleport can't be planned: already planned.",
  );
  // A door the plan opens first counts as open.
  const atDoor = { ...state, characters: state.characters.map((c) => (c.id === C ? { ...c, position: fromOffset(6, 4) } : c)) };
  assert.equal(planAbilityProblem(atDoor, C, [{ type: "openDoor", door: DOOR }, teleport(BEHIND_DOOR)]), undefined);
  const after = turn(game(), teleport(up(4))).newState;
  assert.equal(planAbilityProblem(after, C, [teleport(CENTRE)]), "Teleport can't be planned: ready in 5 turns.");
});

test("a planned teleport leaves the caster on its hex, and the preview shows whether it goes through", () => {
  assert.deepEqual(positionAfter(CENTRE, teleport(up(4)), {}), up(4));
  assert.deepEqual(positionAfter(CENTRE, teleport(hex(CENTRE.q, CENTRE.r + 6)), {}), CENTRE);
  const state = game();
  const taken = previewCycle(state, [C, A], new Map([[C, [teleport(up(3))]]]));
  assert.deepEqual(taken.cancellations, [{ type: "planCancelled", characterId: C, action: 0, reason: "hex taken" }]);
  assert.deepEqual(previewCycle(state, [C, A], new Map([[C, [teleport(up(4))]]])).cancellations, []);
});
