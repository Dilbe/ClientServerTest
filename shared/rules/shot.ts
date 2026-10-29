// Shots (design.md, Ranged attacks for characters): the attack of a character
// whose range isn't 1 to 1, such as the ranger, which hits a monster 2 to 3
// hexes away, in line of sight, but not one next to it. The geometry lives
// here, so the rules, the server's plan check and the client's taps and
// action menu all give the same answer to "can it shoot there?".

import { attackRange, isRangedAttack, type AttackRange } from "./classes.ts";
import { fireballArea, monstersIn } from "./fireball.ts";
import { monsterAt, type CharacterId, type CharacterState, type GameState } from "./game-state.ts";
import { distance, type Hex } from "./hex.ts";
import { inCharacterLineOfSight } from "./line-of-sight.ts";
import { stateAfterPlan } from "./planning.ts";
import type { Plan, PlannedAction } from "./turn.ts";

/** Whether the character's attacks are shots: its range isn't 1 to 1. */
export function shoots(character: Pick<CharacterState, "stats" | "shortestRange">): boolean {
  return isRangedAttack(attackRange(character));
}

/** Why a hex isn't within a range: nearer than its shortest distance, or further than its longest. */
export type RangeProblem = "too close" | "out of range";

/** Why `target` isn't within `range` of `from`, or `undefined` when it is. */
export function rangeProblem(range: AttackRange, from: Hex, target: Hex): RangeProblem | undefined {
  const d = distance(from, target);
  if (d < range.shortest) return "too close";
  if (d > range.longest) return "out of range";
  return undefined;
}

/** Why a shot can't be carried out. */
export type ShotProblem =
  | RangeProblem
  | "out of sight" // a wall, pillar, closed door, created wall or monster is in the way
  | "target gone"; // no living monster on the hex (any more)

/**
 * Why a character on `from` with this range can't shoot the monster on
 * `target` in `state`, or `undefined` when it can: the hex must be within
 * its range, in line of sight from a character's side (monsters block it,
 * characters don't), and a living monster must stand there.
 */
export function shotProblem(state: GameState, from: Hex, target: Hex, range: AttackRange): ShotProblem | undefined {
  const problem = rangeProblem(range, from, target);
  if (problem) return problem;
  if (!inCharacterLineOfSight(state, from, target)) return "out of sight";
  if (!monsterAt(state, target)) return "target gone";
  return undefined;
}

/** Why a volley can't be carried out. */
export type VolleyProblem = RangeProblem | "out of sight" | "no monster in area";

/**
 * Why a ranger on `from` with this range can't loose a volley at `target`
 * in `state`, or `undefined` when it can (design.md, Volley): the hex must
 * be within its range and in line of sight, as for a shot, and a living
 * monster must stand on it or on the 6 hexes around it, like a fireball's
 * area. The hex itself may be empty, and the area may include monsters next
 * to the ranger: the arrows come down from above.
 */
export function volleyProblem(state: GameState, from: Hex, target: Hex, range: AttackRange): VolleyProblem | undefined {
  const problem = rangeProblem(range, from, target);
  if (problem) return problem;
  if (!inCharacterLineOfSight(state, from, target)) return "out of sight";
  if (monstersIn(state, fireballArea(target)).length === 0) return "no monster in area";
  return undefined;
}

/** The planned actions that are shots for this character: its attacks, if it shoots. */
function isShot(character: CharacterState, action: PlannedAction): action is Extract<PlannedAction, { type: "attack" }> {
  return action.type === "attack" && shoots(character);
}

/**
 * Why a plan can't be carried out on the character's next turn because of
 * its shots, or `undefined` when it can. Each shot's hex must be within the
 * character's range, seen from where the actions before it take the
 * character (design.md, Ranged attacks for characters). Whether it is in
 * line of sight and a monster stands there is checked when it is carried
 * out: either may change before the turn fires.
 *
 * Security: the hex comes from the client, so it is never trusted to be in
 * range. A shot at a hex 10 hexes away is refused, though the client's own
 * menu never offers one.
 */
export function planShotProblem(state: GameState, characterId: CharacterId, plan: Plan): string | undefined {
  const character = state.characters.find((c) => c.id === characterId);
  if (!character) return "That character isn't in this game.";
  const range = attackRange(character);
  for (let index = 0; index < plan.length; index++) {
    const action = plan[index]!;
    if (!isShot(character, action)) continue;
    const position = stateAfterPlan(state, characterId, plan.slice(0, index)).characters.find(
      (c) => c.id === characterId,
    )!.position;
    if (position === null) return "Attack can't be planned: the character isn't on the map yet.";
    if (rangeProblem(range, position, action.target) !== undefined) {
      return `Attack can't be planned: the hex isn't ${range.shortest} to ${range.longest} hexes away.`;
    }
  }
  return undefined;
}
