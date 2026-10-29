// Fireball (design.md, Fireball): the caster's area spell. The geometry
// lives here, so the rules, the server's plan check and the client's action
// menu all use the same answer to "can the caster throw a fireball there?".

import type { GameState, MonsterState } from "./game-state.ts";
import { distance, hexKey, neighbours, type Hex } from "./hex.ts";
import { inLineOfSight } from "./line-of-sight.ts";

/** A fireball targets a hex at most this many hexes away, counted in a straight line. Its own hex counts too. */
export const FIREBALL_MAX_DISTANCE = 4;

/** Whether `target` is within a fireball from `from`: 0 to the longest distance. */
export function inFireballRange(from: Hex, target: Hex): boolean {
  return distance(from, target) <= FIREBALL_MAX_DISTANCE;
}

/** The hexes a fireball on `target` hits: the hex itself and the 6 around it. */
export function fireballArea(target: Hex): Hex[] {
  return [target, ...neighbours(target)];
}

/** The living monsters on any of `area`'s hexes, in the order of the monster list. */
export function monstersIn(state: GameState, area: readonly Hex[]): MonsterState[] {
  const keys = new Set(area.map(hexKey));
  return state.monsters.filter((m) => m.hp > 0 && keys.has(hexKey(m.position)));
}

/** Why a fireball can't be carried out. */
export type FireballProblem =
  | "out of range" // further away than the longest fireball
  | "out of sight" // the line of sight to the target hex is blocked
  | "no monster in area"; // no living monster on the target hex or around it

/**
 * Why a caster on `from` can't throw a fireball at `target` in `state`, or
 * `undefined` when it can: the hex must be in range and in line of sight
 * (walls, closed doors and characters block it; monsters don't), and a
 * living monster must stand in the area. The hex itself may be empty:
 * aiming between monsters is the point (design.md, Fireball).
 */
export function fireballProblem(state: GameState, from: Hex, target: Hex): FireballProblem | undefined {
  if (!inFireballRange(from, target)) return "out of range";
  if (!inLineOfSight(state, from, target)) return "out of sight";
  if (monstersIn(state, fireballArea(target)).length === 0) return "no monster in area";
  return undefined;
}
