// The rules for all the healer's heals (design.md, The healer, Abilities).
//
// Healing touch, renew and ward target a character, not a hex: attacks
// target a hex because monsters move, but a heal follows the ally it was
// meant for, also when that ally moved in its own turn. The target must be
// next to the healer when the heal is carried out, or be the healer itself.
// A heal never goes above the target's max hit points.

import type { CancelReason } from "./events.ts";
import type { CharacterId, CharacterState, GameState } from "./game-state.ts";
import { areNeighbours, type Hex } from "./hex.ts";

/** The healer's healing power: 0 for a character without it (design.md, The healer). */
export function healingPower(character: CharacterState): number {
  return character.stats.healingPower ?? 0;
}

/** The hit points a heal of `amount` restores: never above the target's max hit points. */
export function healAmount(target: CharacterState, amount: number): number {
  return Math.max(0, Math.min(amount, target.stats.hitPoints - target.hp));
}

/**
 * The character a heal by `healerId`, standing on `position`, can target
 * now, or why it can't: the target has to be a living character on the map
 * (of any player), next to `position` or the healer itself.
 */
export function healTarget(
  state: GameState,
  healerId: CharacterId,
  position: Hex,
  targetId: CharacterId,
): CharacterState | CancelReason {
  const target = state.characters.find((c) => c.id === targetId);
  if (!target || target.hp === 0 || target.position === null) return "no ally";
  if (target.id !== healerId && !areNeighbours(position, target.position)) return "not a neighbour";
  return target;
}
