// Piercing shot (design.md, Piercing shot): a ranger's shot along one of the 6
// hex directions that hits every monster 2 to 6 hexes away on that line. The
// geometry lives here, so the rules, the server's plan check and the client's
// action menu and map all use the same answer to "which hexes does it cover?".

// Only types from abilities.ts: it imports this file, and type imports
// disappear when the code runs, so there is no import cycle.
import type { AbilityUpgradeCounts, AbilityUpgradeDefinition } from "./abilities.ts";
import { powerCost } from "./costs.ts";
import { lineFrom } from "./frost-wave.ts";
import type { GameState } from "./game-state.ts";
import { DIRECTIONS, distance, hex, type Hex } from "./hex.ts";

/** The hex next to the ranger isn't hit, as with any shot: the line starts this many hexes away. */
export const PIERCING_SHOT_MIN_DISTANCE = 2;
/** And it reaches this many hexes away, without length upgrades. */
export const PIERCING_SHOT_LENGTH = 6;

/**
 * Each length upgrade adds 1 hex: 6, then 7, then 8 hexes away (design.md,
 * Piercing shot), priced like frost wave's length. Part of piercing shot in
 * abilities.ts; here so `piercingShotLength` can use it without an import cycle.
 */
export const PIERCING_SHOT_LENGTH_UPGRADE: AbilityUpgradeDefinition = {
  step: "+1",
  cost: powerCost(5, 1.5),
  maxUpgrades: 2,
};

/** How far away a piercing shot reaches, with the character's length upgrades. */
export function piercingShotLength(counts: AbilityUpgradeCounts): number {
  return PIERCING_SHOT_LENGTH + Math.min(counts.piercingShot?.length ?? 0, PIERCING_SHOT_LENGTH_UPGRADE.maxUpgrades);
}

/**
 * The neighbour of `from` in the direction of `target`, when `target` is in
 * a straight line along one of the 6 hex directions, 2 to `length` hexes
 * away: the hex picks the direction (design.md, Piercing shot). `undefined`
 * otherwise.
 */
export function piercingDirection(from: Hex, target: Hex, length: number): Hex | undefined {
  const steps = distance(from, target);
  if (steps < PIERCING_SHOT_MIN_DISTANCE || steps > length) return undefined;
  const direction = DIRECTIONS.find((d) => from.q + d.dq * steps === target.q && from.r + d.dr * steps === target.r);
  return direction && hex(from.q + direction.dq, from.r + direction.dr);
}

/**
 * The hexes a piercing shot from `from` towards `target` covers: 2 to
 * `length` hexes away in that direction, cut short at the first wall,
 * pillar, closed door or created wall, also one next to the ranger.
 * Monsters and characters don't stop it. Empty when `target` isn't in a
 * straight line 2 to `length` hexes away.
 */
export function piercingShotHexes(state: GameState, from: Hex, target: Hex, length: number): Hex[] {
  const towards = piercingDirection(from, target, length);
  if (!towards) return [];
  return lineFrom(state, from, towards, length).slice(PIERCING_SHOT_MIN_DISTANCE - 1);
}
