// Charge (design.md, Charge): a run in a straight line that ends in an
// attack. The geometry lives here, so the rules, the server's plan check and
// the client's action menu all use the same answer to "can this hex be
// charged from here?".

// Only types from abilities.ts: it imports this file, and type imports
// disappear when the code runs, so there is no import cycle.
import type { AbilityUpgradeCounts, AbilityUpgradeDefinition } from "./abilities.ts";
import { isOnMap } from "./dungeon-map.ts";
import { isClosedDoor, isFree, monsterAt, type GameState } from "./game-state.ts";
import { DIRECTIONS, distance, hex, type Hex } from "./hex.ts";

/** A charge targets a hex at least this many hexes away: at 1 it would just be an attack. */
export const CHARGE_MIN_DISTANCE = 2;
/** And at most this many, without range upgrades (see `chargeMaxDistance` in abilities.ts). */
export const CHARGE_MAX_DISTANCE = 4;

/**
 * Each range upgrade adds 1 to the longest charge: 4, then 5, then 6 hexes
 * (design.md, Ability upgrades). Part of charge in abilities.ts; here so
 * `chargeMaxDistance` can use it without an import cycle.
 */
export const CHARGE_RANGE_UPGRADE: AbilityUpgradeDefinition = {
  step: "+1",
  firstUpgradeCost: 5,
  upgradeCostExponent: 1.5,
  maxUpgrades: 2,
};

/**
 * The longest charge, in hexes, with the character's range upgrades. Never
 * more upgrades than allowed now, in case a balance change lowered that
 * after they were bought.
 */
export function chargeMaxDistance(counts: AbilityUpgradeCounts): number {
  return CHARGE_MAX_DISTANCE + Math.min(counts.charge?.range ?? 0, CHARGE_RANGE_UPGRADE.maxUpgrades);
}

/**
 * The hexes a charge from `from` at the hex `target` runs through, in
 * order, ending with the hex next to `target` that the character stops
 * on. `undefined` when `target` isn't along one of the 6 hex directions, or
 * isn't 2 to `maxDistance` hexes away.
 *
 * Along a hex direction only, not any straight line as in line of sight:
 * the player can see at a glance which hexes are in line.
 */
export function chargePath(from: Hex, target: Hex, maxDistance = CHARGE_MAX_DISTANCE): Hex[] | undefined {
  const steps = distance(from, target);
  if (steps < CHARGE_MIN_DISTANCE || steps > maxDistance) return undefined;
  const direction = DIRECTIONS.find((d) => from.q + d.dq * steps === target.q && from.r + d.dr * steps === target.r);
  if (!direction) return undefined;
  return Array.from({ length: steps - 1 }, (_, i) => hex(from.q + direction.dq * (i + 1), from.r + direction.dr * (i + 1)));
}

/** Why a charge can't be carried out. */
export type ChargeProblem =
  | "not in line" // not in a straight line 2 to `maxDistance` hexes away
  | "target gone" // no living monster on the target hex
  | "path blocked"; // a wall, pillar, closed door, character or monster on the way

/**
 * Why a character on `from` can't charge the hex `target` in `state`, or
 * `undefined` when it can: the hex must be in a straight line 2 to
 * `maxDistance` hexes away (4 without range upgrades), a living monster
 * must stand on it, and every hex of the run, also the one it stops on,
 * must be free. The character's own hex isn't part of the run.
 */
export function chargeProblem(state: GameState, from: Hex, target: Hex, maxDistance: number): ChargeProblem | undefined {
  const path = chargePath(from, target, maxDistance);
  if (!path) return "not in line";
  if (!monsterAt(state, target)) return "target gone";
  const blocked = path.some((h) => !isOnMap(state.map, h) || isClosedDoor(state, h) || !isFree(state, h));
  return blocked ? "path blocked" : undefined;
}
