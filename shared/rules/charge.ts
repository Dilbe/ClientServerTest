// Charge (design.md, Charge): a run in a straight line that ends in an
// attack. The geometry lives here, so the rules, the server's plan check and
// the client's highlights all use the same answer to "can this monster be
// charged from here?".

import { isOnMap } from "./dungeon-map.ts";
import { isClosedDoor, isFree, type GameState, type MonsterId } from "./game-state.ts";
import { DIRECTIONS, distance, hex, type Hex } from "./hex.ts";

/** A charge targets a monster at least this many hexes away: at 1 it would just be an attack. */
export const CHARGE_MIN_DISTANCE = 2;
/** And at most this many. */
export const CHARGE_MAX_DISTANCE = 4;

/**
 * The hexes a charge from `from` at a monster on `target` runs through, in
 * order, ending with the hex next to the monster that the character stops
 * on. `undefined` when `target` isn't along one of the 6 hex directions, or
 * isn't 2 to 4 hexes away.
 *
 * Along a hex direction only, not any straight line as in line of sight:
 * the player can see at a glance which monsters are in line.
 */
export function chargePath(from: Hex, target: Hex): Hex[] | undefined {
  const steps = distance(from, target);
  if (steps < CHARGE_MIN_DISTANCE || steps > CHARGE_MAX_DISTANCE) return undefined;
  const direction = DIRECTIONS.find((d) => from.q + d.dq * steps === target.q && from.r + d.dr * steps === target.r);
  if (!direction) return undefined;
  return Array.from({ length: steps - 1 }, (_, i) => hex(from.q + direction.dq * (i + 1), from.r + direction.dr * (i + 1)));
}

/** Why a charge can't be carried out. */
export type ChargeProblem =
  | "target gone" // the monster is dead
  | "not in line" // not in a straight line 2 to 4 hexes away
  | "path blocked"; // a wall, pillar, closed door, character or monster on the way

/**
 * Why a character on `from` can't charge monster `monsterId` in `state`, or
 * `undefined` when it can: the monster must be alive, in a straight line 2
 * to 4 hexes away, and every hex of the run, also the one it stops on, must
 * be free. The character's own hex isn't part of the run.
 */
export function chargeProblem(state: GameState, from: Hex, monsterId: MonsterId): ChargeProblem | undefined {
  const monster = state.monsters.find((m) => m.id === monsterId);
  if (!monster || monster.hp === 0) return "target gone";
  const path = chargePath(from, monster.position);
  if (!path) return "not in line";
  const blocked = path.some((h) => !isOnMap(state.map, h) || isClosedDoor(state, h) || !isFree(state, h));
  return blocked ? "path blocked" : undefined;
}
