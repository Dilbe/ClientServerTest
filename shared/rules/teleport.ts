// Teleport (design.md, Teleport): the caster moves to a free hex a few hexes
// away without walking there, and without needing to see it. The geometry
// lives here, so the rules, the server's plan check and the client's action
// menu all use the same answer to "can the caster teleport there?".

import { isOnMap, roomAround } from "./dungeon-map.ts";
import { isClosedDoor, isFree, type GameState } from "./game-state.ts";
import { distance, hexKey, type Hex } from "./hex.ts";

/** A teleport goes at most this many hexes, counted in a straight line. */
export const TELEPORT_MAX_DISTANCE = 5;

/** Whether `target` is within a teleport from `from`: 1 to 5 hexes away, counted in a straight line. */
export function inTeleportRange(from: Hex, target: Hex): boolean {
  const d = distance(from, target);
  return d >= 1 && d <= TELEPORT_MAX_DISTANCE;
}

/**
 * Whether `target` is in the room `from` is in, with the doors that are
 * closed in `state`: a caster can't teleport behind a closed door, to the
 * sleeping monsters there (design.md, Teleport).
 */
export function inSameRoom(state: GameState, from: Hex, target: Hex): boolean {
  return roomAround(state.map, state.closedDoors, from).has(hexKey(target));
}

/** Why a teleport can't be carried out. */
export type TeleportProblem =
  | "out of range" // further away than the longest teleport
  | "not on the map" // a wall or pillar
  | "door closed"
  | "closed room" // in a room behind a closed door
  | "hex taken"; // a character or monster stands on it

/**
 * Why a caster on `from` can't teleport to `target` in `state`, or
 * `undefined` when it can: the hex must be within range, in the caster's
 * room (not behind a closed door) and free. No line of sight is needed.
 */
export function teleportProblem(state: GameState, from: Hex, target: Hex): TeleportProblem | undefined {
  if (!inTeleportRange(from, target)) return "out of range";
  if (!isOnMap(state.map, target)) return "not on the map";
  if (isClosedDoor(state, target)) return "door closed";
  if (!inSameRoom(state, from, target)) return "closed room";
  if (!isFree(state, target)) return "hex taken";
  return undefined;
}
