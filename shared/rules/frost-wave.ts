// Frost wave (design.md, Frost wave): a line of hexes in one of the 6
// directions, starting next to the caster. The geometry lives here, so the
// rules, the server's plan check and the client's map all use the same
// answer to "which hexes does it cover?". Create wall uses the same line.

// Only types from abilities.ts: it imports this file, and type imports
// disappear when the code runs, so there is no import cycle.
import type { AbilityUpgradeCounts, AbilityUpgradeDefinition } from "./abilities.ts";
import { powerCost } from "./costs.ts";
import { isOnMap } from "./dungeon-map.ts";
import { isClosedDoor, isCreatedWall, type GameState } from "./game-state.ts";
import { areNeighbours, hex, type Hex } from "./hex.ts";

/** A frost wave covers this many hexes, without length upgrades. */
export const FROST_WAVE_LENGTH = 3;

/**
 * Each length upgrade adds 1 hex: 3, then 4, then 5 (design.md, Frost
 * wave). Part of frost wave in abilities.ts; here so `frostWaveLength` can
 * use it without an import cycle.
 */
export const FROST_WAVE_LENGTH_UPGRADE: AbilityUpgradeDefinition = {
  step: "+1",
  cost: powerCost(5, 1.5),
  maxUpgrades: 2,
};

/** How many hexes a frost wave covers, with the character's length upgrades. */
export function frostWaveLength(counts: AbilityUpgradeCounts): number {
  return FROST_WAVE_LENGTH + Math.min(counts.frostWave?.length ?? 0, FROST_WAVE_LENGTH_UPGRADE.maxUpgrades);
}

/** Whether `h` stops a wave or a wall going along a line: a wall, pillar, closed door or created wall. */
function stopsLine(state: GameState, h: Hex): boolean {
  return !isOnMap(state.map, h) || isClosedDoor(state, h) || isCreatedWall(state, h);
}

/**
 * The hexes a line from `from` through its neighbour `towards` covers:
 * `length` hexes in a straight line, starting at `towards`, cut short at the
 * first wall, pillar, closed door or created wall. Characters and monsters
 * don't stop it. Used by frost wave and create wall (design.md, Create wall).
 * Empty when `towards` isn't next to `from`.
 */
export function lineFrom(state: GameState, from: Hex, towards: Hex, length: number): Hex[] {
  if (!areNeighbours(from, towards)) return [];
  const dq = towards.q - from.q;
  const dr = towards.r - from.r;
  const hexes: Hex[] = [];
  for (let i = 1; i <= length; i++) {
    const h = hex(from.q + dq * i, from.r + dr * i);
    if (stopsLine(state, h)) break;
    hexes.push(h);
  }
  return hexes;
}
