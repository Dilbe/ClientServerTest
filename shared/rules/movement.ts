// Moves of more than 1 hex (design.md, Moving more than 1 hex): a move
// action goes up to the character's movement in hexes, along a free path.
// A character with a movement of 1 moves to a neighbour, as before.
//
// When the move is carried out, the character takes the shortest free path
// at that moment, all or nothing: if none is short enough, it stays put.
// Between equally short paths it chooses as monsters do: at every step the
// first neighbour that is still on a shortest path, clockwise, starting at
// straight up (design.md, Choosing a route).

import { isOnMap, type DungeonMap } from "./dungeon-map.ts";
import { isClosedDoor, isCreatedWall, isFree, type CharacterId, type GameState } from "./game-state.ts";
import { distance, hexEquals, hexKey, neighbours, stepsFrom, type Hex } from "./hex.ts";
import { stateAfterPlan } from "./planning.ts";
import type { Plan } from "./turn.ts";

/**
 * Whether a character may step on `h` now: a hex of the map that isn't a
 * closed door or a created wall, and where nobody stands.
 */
export function canStepOn(state: GameState, h: Hex): boolean {
  return isOnMap(state.map, h) && !isClosedDoor(state, h) && !isCreatedWall(state, h) && isFree(state, h);
}

/**
 * The shortest path from `from` to `to` over hexes for which `canEnter` is
 * true, at most `movement` steps long: the hexes after `from`, ending with
 * `to`. `undefined` when there is none. Of equally short paths, each step
 * takes the first neighbour in direction order that is still on a shortest
 * path, as a monster chooses its step.
 */
export function shortestPath(from: Hex, to: Hex, movement: number, canEnter: (h: Hex) => boolean): Hex[] | undefined {
  if (hexEquals(from, to) || !canEnter(to) || distance(from, to) > movement) return undefined;
  // Search outwards from the target: that gives the steps from every hex to it.
  // Only hexes within reach count, so the search stops early on a big map.
  const near = (h: Hex) => distance(h, from) <= movement && canEnter(h);
  const stepsToTarget = stepsFrom(to, near);
  const stepsAt = (h: Hex) => stepsToTarget.get(hexKey(h)) ?? Infinity;
  const path: Hex[] = [];
  let current = from;
  let left = Math.min(...neighbours(from).map(stepsAt)) + 1;
  if (left > movement) return undefined;
  while (!hexEquals(current, to)) {
    left -= 1;
    current = neighbours(current).find((n) => stepsAt(n) === left)!;
    path.push(current);
  }
  return path;
}

/**
 * The path a move takes when it is carried out now (see `shortestPath`): only
 * over free hexes, so walls, pillars, closed doors, created walls,
 * characters and monsters are in the way.
 */
export function freeMovePath(state: GameState, from: Hex, to: Hex, movement: number): Hex[] | undefined {
  return shortestPath(from, to, movement, (h) => canStepOn(state, h));
}

/**
 * Whether a move from `from` to `to` can be planned (design.md, Moving more
 * than 1 hex): a path of at most `movement` hexes over the map. Characters
 * and monsters may move before the turn fires, a door may be opened and a
 * created wall may go, so only the map itself counts. For a movement of 1,
 * that is a neighbour on the map.
 */
export function inMoveRange(map: DungeonMap, from: Hex, to: Hex, movement: number): boolean {
  return mapPath(map, from, to, movement) !== undefined;
}

/** The shortest path over the map alone, ignoring who stands where and what is closed (see `inMoveRange`). */
export function mapPath(map: DungeonMap, from: Hex, to: Hex, movement: number): Hex[] | undefined {
  return shortestPath(from, to, movement, (h) => isOnMap(map, h));
}

/**
 * Every hex a move from `from` reaches now, along a free path of at most
 * `movement` hexes: what a tap can plan a move to.
 */
export function reachableHexes(state: GameState, from: Hex, movement: number): Hex[] {
  const steps = stepsFrom(from, (h) => distance(h, from) <= movement && canStepOn(state, h));
  return state.map.hexes.filter((h) => {
    const n = steps.get(hexKey(h));
    return n !== undefined && n > 0 && n <= movement;
  });
}

/**
 * Why a plan's moves can't be planned, or `undefined` when they can: the
 * server refuses a move to a hex that no path of at most the character's
 * movement reaches over the map, seen from where the actions before it
 * take the character (design.md, Moving more than 1 hex). Whether the path
 * is free is up to the turn: who stands where may change before then. A
 * move before the character is on the map is cancelled when the turn fires,
 * as before.
 */
export function planMoveProblem(state: GameState, characterId: CharacterId, plan: Plan): string | undefined {
  const character = state.characters.find((c) => c.id === characterId);
  if (!character) return "That character isn't in this game.";
  const { movement } = character.stats;
  for (let index = 0; index < plan.length; index++) {
    const action = plan[index]!;
    if (action.type !== "move") continue;
    const position = stateAfterPlan(state, characterId, plan.slice(0, index)).characters.find(
      (c) => c.id === characterId,
    )!.position;
    if (position !== null && !inMoveRange(state.map, position, action.to, movement)) {
      return movement === 1
        ? "A move can't be planned: the hex isn't next to the character."
        : `A move can't be planned: no path of at most ${movement} hexes leads there.`;
    }
  }
  return undefined;
}
