import { test } from "node:test";
import assert from "node:assert/strict";
import { baseStats } from "./classes.ts";
import type { DungeonMap } from "./dungeon-map.ts";
import { applyEvents } from "./events.ts";
import type { CharacterId, GameState } from "./game-state.ts";
import { fromOffset, hex, hexKey, rectangle, type Hex } from "./hex.ts";
import { freeMovePath, inMoveRange, planMoveProblem, reachableHexes } from "./movement.ts";
import { previewCycle } from "./preview.ts";
import { createTrack } from "./track.ts";
import { newGameState, resolveTurn, type Plan } from "./turn.ts";

const H = 1;
const A = 2;
/** Where the healer stands: the middle of a 9 by 9 room. */
const CENTRE = fromOffset(4, 4);
const at = (dq: number, dr: number): Hex => hex(CENTRE.q + dq, CENTRE.r + dr);
const up = (steps: number) => at(0, -steps);

/**
 * A 9 by 9 room; `pillars` are left out of it, and a monster stands on each
 * of `monsters`, after one in a far corner that keeps the game going.
 */
function map(pillars: Hex[] = [], monsters: Hex[] = []): DungeonMap {
  return {
    hexes: rectangle(9, 9).filter((h) => !pillars.some((p) => hexKey(p) === hexKey(h))),
    startHexes: [fromOffset(8, 8)],
    doors: [],
    monsters: [fromOffset(0, 0), ...monsters].map((position) => ({ type: "basic", position })),
  };
}

/** A healer (movement 2) in the middle, or an adventurer (movement 1); the monsters never act. */
function game({
  classId = "healer",
  pillars = [],
  monsters = [],
  actions = 1,
}: { classId?: "healer" | "adventurer"; pillars?: Hex[]; monsters?: Hex[]; actions?: number } = {}): GameState {
  const state = newGameState(
    map(pillars, monsters),
    [
      { id: H, stats: { ...baseStats(classId), actions }, classId },
      { id: A, stats: baseStats("adventurer") },
    ],
    createTrack([H, A], new Map()),
  );
  return { ...state, characters: state.characters.map((c) => (c.id === H ? { ...c, position: CENTRE } : c)) };
}

function turn(state: GameState, ...plan: Plan) {
  const result = resolveTurn(state, H, new Map<CharacterId, Plan>([[H, plan]]));
  assert.deepEqual(applyEvents(state, result.events), result.newState, "replaying the events");
  return result;
}

const moved = (from: Hex, to: Hex) => ({ type: "moved", actor: { kind: "character", id: H }, from, to }) as const;
const positionOf = (state: GameState) => state.characters.find((c) => c.id === H)!.position;

test("a healer moves 2 hexes in one move action, one event per hex", () => {
  const { events, newState } = turn(game(), { type: "move", to: up(2) });
  assert.deepEqual(events, [moved(CENTRE, up(1)), moved(up(1), up(2))]);
  assert.deepEqual(positionOf(newState), up(2));
});

test("a healer can also move just 1 hex, and a character with a movement of 1 moves as before", () => {
  assert.deepEqual(turn(game(), { type: "move", to: up(1) }).events, [moved(CENTRE, up(1))]);
  assert.deepEqual(turn(game({ classId: "adventurer" }), { type: "move", to: up(1) }).events, [moved(CENTRE, up(1))]);
  assert.deepEqual(turn(game({ classId: "adventurer" }), { type: "move", to: up(2) }).events, [
    { type: "planCancelled", characterId: H, action: 0, reason: "not a neighbour" },
  ]);
  assert.deepEqual(turn(game(), { type: "move", to: up(3) }).events, [
    { type: "planCancelled", characterId: H, action: 0, reason: "out of range" },
  ]);
});

test("of equally short paths, it takes the first step clockwise from straight up, as monsters do", () => {
  // Up and then up-right, or up-right and then up: straight up comes first.
  const target = at(1, -2);
  assert.deepEqual(turn(game(), { type: "move", to: target }).events, [moved(CENTRE, up(1)), moved(up(1), target)]);
  // With a monster straight up, the other path.
  assert.deepEqual(turn(game({ monsters: [up(1)] }), { type: "move", to: target }).events, [
    moved(CENTRE, at(1, -1)),
    moved(at(1, -1), target),
  ]);
  // Down-left and then up-left, or up-left and then down-left: up-left is
  // further round the clock than down-left, so down-left comes first.
  const left = at(-2, 1);
  assert.deepEqual(freeMovePath(game(), CENTRE, left, 2), [at(-1, 1), left]);
});

test("a move with no free path short enough is cancelled, and the character stays where it is", () => {
  // The only 2-hex path straight up goes through the hex right above.
  for (const state of [game({ monsters: [up(1)] }), game({ pillars: [up(1)] })]) {
    const { events, newState } = turn(state, { type: "move", to: up(2) });
    assert.deepEqual(events, [{ type: "planCancelled", characterId: H, action: 0, reason: "path blocked" }]);
    assert.deepEqual(positionOf(newState), CENTRE);
  }
  // Another character in the way blocks it too.
  const withAlly = game();
  withAlly.characters[1] = { ...withAlly.characters[1]!, position: up(1) };
  assert.deepEqual(turn(withAlly, { type: "move", to: up(2) }).events, [
    { type: "planCancelled", characterId: H, action: 0, reason: "path blocked" },
  ]);
  // A taken hex at the end is "hex taken", as for any move.
  assert.deepEqual(turn(game({ monsters: [up(2)] }), { type: "move", to: up(2) }).events, [
    { type: "planCancelled", characterId: H, action: 0, reason: "hex taken" },
  ]);
});

test("the next action starts where the move ended", () => {
  const { events } = turn(game({ actions: 2 }), { type: "move", to: up(2) }, { type: "move", to: up(4) });
  assert.deepEqual(events, [moved(CENTRE, up(1)), moved(up(1), up(2)), moved(up(2), up(3)), moved(up(3), up(4))]);
});

test("the preview shows each step", () => {
  const state = game();
  const preview = previewCycle(state, [H], new Map([[H, [{ type: "move", to: up(2) }]]]));
  assert.deepEqual(preview.turns[0]!.events, [moved(CENTRE, up(1)), moved(up(1), up(2))]);
});

test("a tap can plan a move to every hex a free path of at most the movement reaches", () => {
  // In an open room: the 6 neighbours and the 12 hexes 2 away.
  assert.equal(reachableHexes(game(), CENTRE, 2).length, 18);
  assert.equal(reachableHexes(game({ classId: "adventurer" }), CENTRE, 1).length, 6);
  // A monster straight up: that hex, and the one behind it that only it leads to, are out.
  const blocked = reachableHexes(game({ monsters: [up(1)] }), CENTRE, 2).map(hexKey);
  assert.equal(blocked.length, 16);
  assert.ok(!blocked.includes(hexKey(up(1))) && !blocked.includes(hexKey(up(2))));
});

test("the server checks that a path of at most the movement leads to the hex, ignoring who stands where", () => {
  const state = game({ monsters: [up(1)] });
  assert.equal(planMoveProblem(state, H, [{ type: "move", to: up(2) }]), undefined); // the monster may move
  assert.equal(
    planMoveProblem(state, H, [{ type: "move", to: up(3) }]),
    "A move can't be planned: no path of at most 2 hexes leads there.",
  );
  // A pillar doesn't move: the only short path is gone.
  assert.match(planMoveProblem(game({ pillars: [up(1)] }), H, [{ type: "move", to: up(2) }])!, /no path/);
  assert.ok(!inMoveRange(game({ pillars: [up(1)] }).map, CENTRE, up(2), 2));
  // Seen from where the actions before it leave the character.
  assert.equal(planMoveProblem(game({ actions: 2 }), H, [{ type: "move", to: up(2) }, { type: "move", to: up(4) }]), undefined);
  // A character with a movement of 1 only moves to a neighbour.
  assert.equal(
    planMoveProblem(game({ classId: "adventurer" }), H, [{ type: "move", to: up(2) }]),
    "A move can't be planned: the hex isn't next to the character.",
  );
  assert.equal(planMoveProblem(game({ classId: "adventurer" }), H, [{ type: "move", to: up(1) }]), undefined);
});
