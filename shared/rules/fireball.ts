// Fireball (design.md, Fireball): the caster's area spell. The geometry
// lives here, so the rules, the server's plan check and the client's action
// menu all use the same answer to "can the caster throw a fireball there?".

// Only types from abilities.ts: it imports this file, and type imports
// disappear when the code runs, so there is no import cycle.
import type { AbilityUpgradeCounts, AbilityUpgradeDefinition } from "./abilities.ts";
import type { GameState, MonsterState } from "./game-state.ts";
import { distance, hexKey, neighbours, type Hex } from "./hex.ts";
import { inLooseLineOfSight } from "./line-of-sight.ts";

/**
 * A fireball targets a hex at most this many hexes away, counted in a
 * straight line, without range upgrades. Its own hex counts too.
 */
export const FIREBALL_MAX_DISTANCE = 4;

/**
 * Each range upgrade adds 1 to the longest fireball: 4, then 5, then 6
 * hexes, for 10 and then 30 points (design.md, Fireball; issue #432). Part
 * of fireball in abilities.ts; here so `fireballMaxDistance` can use it
 * without an import cycle.
 */
export const FIREBALL_RANGE_UPGRADE: AbilityUpgradeDefinition = {
  step: "+1",
  cost: (n) => 10 * (2 * n - 1),
  maxUpgrades: 2,
};

/** The longest fireball, in hexes, with the character's range upgrades. */
export function fireballMaxDistance(counts: AbilityUpgradeCounts): number {
  return FIREBALL_MAX_DISTANCE + Math.min(counts.fireball?.range ?? 0, FIREBALL_RANGE_UPGRADE.maxUpgrades);
}

/** Whether `target` is within a fireball from `from`: 0 to `maxDistance` hexes away. */
export function inFireballRange(from: Hex, target: Hex, maxDistance: number): boolean {
  return distance(from, target) <= maxDistance;
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
  | "out of sight" // a wall, pillar, closed door or created wall blocks the line to the target hex
  | "no monster in area"; // no living monster on the target hex or around it

/**
 * Why a caster on `from` can't throw a fireball at `target` in `state`, or
 * `undefined` when it can: the hex must be in range and in the looser line
 * of sight of a meteor (walls, pillars, closed doors and created walls block
 * it; characters and monsters don't, so it goes past the tank in front of
 * the caster; issue #430), and a living monster must stand in the area. The hex itself may be empty:
 * aiming between monsters is the point (design.md, Fireball). `maxDistance`
 * is the caster's longest fireball, with its range upgrades.
 */
export function fireballProblem(
  state: GameState,
  from: Hex,
  target: Hex,
  maxDistance: number,
): FireballProblem | undefined {
  if (!inFireballRange(from, target, maxDistance)) return "out of range";
  if (!inLooseLineOfSight(state, from, target)) return "out of sight";
  if (monstersIn(state, fireballArea(target)).length === 0) return "no monster in area";
  return undefined;
}
