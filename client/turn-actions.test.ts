import { test } from "node:test";
import assert from "node:assert/strict";
import { baseStats } from "../shared/rules/classes.ts";
import type { CharacterId, GameState } from "../shared/rules/game-state.ts";
import { fromOffset, hex, rectangle } from "../shared/rules/hex.ts";
import { createTrack } from "../shared/rules/track.ts";
import { newGameState, resolveTurn, type Plan } from "../shared/rules/turn.ts";
import { actionOfEvent, turnActions } from "./turn-actions.ts";

const H = 1;
const CENTRE = fromOffset(4, 4);
const up = (steps: number) => hex(CENTRE.q, CENTRE.r - steps);

/** A healer (movement 2, 2 actions) in the middle of a 9 by 9 room, with a monster far away that never acts. */
function game(): GameState {
  const state = newGameState(
    { hexes: rectangle(9, 9), startHexes: [fromOffset(8, 8)], doors: [], monsters: [{ type: "basic", position: fromOffset(0, 0) }] },
    [{ id: H, stats: { ...baseStats("healer"), actions: 2 }, classId: "healer" }],
    createTrack([H], new Map()),
  );
  return { ...state, characters: state.characters.map((c) => ({ ...c, position: CENTRE })) };
}

const serverEvents = (state: GameState, plan: Plan) => resolveTurn(state, H, new Map<CharacterId, Plan>([[H, plan]])).events;

test("it finds where each action ended, and where each one started", () => {
  const plan: Plan = [
    { type: "move", to: up(2) },
    { type: "move", to: up(4) },
  ];
  const state = game();
  const actions = turnActions(state, H, plan, serverEvents(state, plan));
  assert.deepEqual(actions, { ends: [2, 4], starts: [CENTRE, up(2)] });
  assert.deepEqual([0, 1, 2, 3, 4].map((i) => actionOfEvent(actions!, i)), [0, 0, 1, 1, undefined]);
});

test("when its events aren't the server's, it doesn't know", () => {
  const state = game();
  const plan: Plan = [{ type: "move", to: up(2) }];
  // The server had another plan than the client thought.
  const other = serverEvents(state, [{ type: "move", to: up(1) }]);
  assert.equal(turnActions(state, H, plan, other), undefined);
});

test("a turn that can't be resolved at all gives no answer instead of an error", () => {
  const state = game();
  assert.equal(turnActions(state, 99, [], []), undefined);
});
