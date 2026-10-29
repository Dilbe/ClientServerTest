// Meteor (design.md, Meteor): the caster's biggest spell, three rings of
// damage around a hex further away, thrown over the heads of allies. The
// geometry lives here, so the rules, the server's plan check and the
// client's action menu all use the same answer to "where does it hit, and
// for how much?".

import type { GameState, MonsterState } from "./game-state.ts";
import { distance, type Hex } from "./hex.ts";
import { inLooseLineOfSight } from "./line-of-sight.ts";

/** A meteor targets a hex at most this many hexes away, counted in a straight line. */
export const METEOR_MAX_DISTANCE = 6;

/** Whether `target` is within a meteor from `from`: 0 to the longest distance. */
export function inMeteorRange(from: Hex, target: Hex): boolean {
  return distance(from, target) <= METEOR_MAX_DISTANCE;
}

/**
 * What a meteor on `target` does to a monster on `h`, for a caster with
 * `attackDamage` (design.md, Meteor): double on the target hex, the attack
 * damage on the 6 hexes around it, half of it, rounded down, on the 12 around
 * those, and `undefined` further away.
 */
export function meteorDamage(target: Hex, h: Hex, attackDamage: number): number | undefined {
  const d = distance(target, h);
  return d === 0 ? attackDamage * 2 : d === 1 ? attackDamage : d === 2 ? Math.floor(attackDamage / 2) : undefined;
}

/** Every living monster a meteor on `target` hits, each once, with the damage it takes. */
export function meteorHits(
  state: GameState,
  target: Hex,
  attackDamage: number,
): { monster: MonsterState; damage: number }[] {
  return state.monsters.flatMap((monster) => {
    const damage = monster.hp > 0 ? meteorDamage(target, monster.position, attackDamage) : undefined;
    return damage === undefined ? [] : [{ monster, damage }];
  });
}

/** Why a meteor can't be carried out. */
export type MeteorProblem =
  | "out of range" // further away than the longest meteor
  | "out of sight" // a wall, pillar, closed door or created wall blocks the line to the target hex
  | "no monster in area"; // no living monster within 2 hexes of the target hex

/**
 * Why a caster on `from` can't call a meteor on `target` in `state`, or
 * `undefined` when it can: the hex must be in range and in the looser line
 * of sight (characters don't block it), and a living monster must be in the
 * area. Line of sight only counts for the target hex.
 */
export function meteorProblem(state: GameState, from: Hex, target: Hex): MeteorProblem | undefined {
  if (!inMeteorRange(from, target)) return "out of range";
  if (!inLooseLineOfSight(state, from, target)) return "out of sight";
  if (meteorHits(state, target, 0).length === 0) return "no monster in area";
  return undefined;
}
