// Leap (design.md, Leap): the tank jumps to a free hex a few hexes away, over
// whatever is in between, as long as it can see the hex. The geometry lives
// here, so the rules, the server's plan check and the client's action menu
// all use the same answer to "can the tank leap there?".

// Only types from abilities.ts: it imports this file, and type imports
// disappear when the code runs, so there is no import cycle.
import type { AbilityUpgradeCounts, AbilityUpgradeDefinition } from "./abilities.ts";
import { powerCost } from "./costs.ts";
import { isOnMap } from "./dungeon-map.ts";
import { isClosedDoor, isFree, type GameState } from "./game-state.ts";
import { distance, type Hex } from "./hex.ts";
import { inLineOfSight } from "./line-of-sight.ts";

/** A leap goes at most this many hexes, counted in a straight line, without range upgrades. */
export const LEAP_MAX_DISTANCE = 4;

/**
 * Each range upgrade adds 1 to the longest leap: 4, then 5, then 6 hexes,
 * priced like charge range (design.md, Leap). Part of leap in
 * abilities.ts; here so `leapMaxDistance` can use it without an import cycle.
 */
export const LEAP_RANGE_UPGRADE: AbilityUpgradeDefinition = {
  step: "+1",
  cost: powerCost(5, 1.5),
  maxUpgrades: 2,
};

/** The longest leap, in hexes, with the character's range upgrades. */
export function leapMaxDistance(counts: AbilityUpgradeCounts): number {
  return LEAP_MAX_DISTANCE + Math.min(counts.leap?.range ?? 0, LEAP_RANGE_UPGRADE.maxUpgrades);
}

/** Whether `target` is within a leap from `from`: 1 to `maxDistance` hexes away, counted in a straight line. */
export function inLeapRange(from: Hex, target: Hex, maxDistance: number): boolean {
  const d = distance(from, target);
  return d >= 1 && d <= maxDistance;
}

/** Why a leap can't be carried out. */
export type LeapProblem =
  | "out of range" // further away than the longest leap
  | "not on the map" // a wall or pillar
  | "door closed"
  | "hex taken" // a character or monster stands on it
  | "out of sight"; // the line of sight to it is blocked

/**
 * Why a character on `from` can't leap to `target` in `state`, or
 * `undefined` when it can: the hex must be within range, free (no wall,
 * pillar, closed door, character or monster) and in line of sight. Monsters
 * don't block the line of sight, so the tank can jump past them; walls,
 * closed doors and characters do (design.md, Line of sight).
 */
export function leapProblem(state: GameState, from: Hex, target: Hex, maxDistance: number): LeapProblem | undefined {
  if (!inLeapRange(from, target, maxDistance)) return "out of range";
  if (!isOnMap(state.map, target)) return "not on the map";
  if (isClosedDoor(state, target)) return "door closed";
  if (!isFree(state, target)) return "hex taken";
  if (!inLineOfSight(state, from, target)) return "out of sight";
  return undefined;
}
