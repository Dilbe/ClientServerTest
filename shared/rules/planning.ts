// Where a plan leaves a character (design.md, Planning). The client
// highlights what the next tap can do from there and fills its action menu,
// and the server checks a charge from there (design.md, Charge). Only the character's own actions
// count: what the others and the monsters do is up to the preview.

import { chargeMaxDistance, chargePath } from "./charge.ts";
import type { CharacterId, GameState } from "./game-state.ts";
import { hexKey, type Hex } from "./hex.ts";
import type { Plan, PlannedAction } from "./turn.ts";

/**
 * Where a planned action leaves a character that stood at `from`, if it goes
 * through. A charge stops next to its target hex; when that hex isn't in
 * line from `from` (at most `chargeDistance` hexes away), the charge would
 * be cancelled and the character stays where it is. Whether a monster
 * stands there or the path is free may still change before the turn fires,
 * so a charge that is in line counts as going through: the preview shows
 * whether it really does.
 */
export function positionAfter(from: Hex | null, action: PlannedAction, chargeDistance: number): Hex | null {
  switch (action.type) {
    case "place":
      return action.hex;
    case "move":
      return action.to;
    case "charge": {
      const path = from && chargePath(from, action.target, chargeDistance);
      return path ? path.at(-1)! : from;
    }
    case "attack":
    case "heavyStrike":
    case "cleave":
    case "stun":
    case "openDoor":
      return from;
  }
}

/**
 * `state` as the character's planned actions leave it: the character on the
 * hex they take it to, and the doors they open open. Everything else is as
 * in `state`.
 */
export function stateAfterPlan(state: GameState, characterId: CharacterId, plan: Plan): GameState {
  const character = state.characters.find((c) => c.id === characterId);
  if (!character) return state;
  const chargeDistance = chargeMaxDistance(character.abilityUpgrades);
  const position = plan.reduce((from, action) => positionAfter(from, action, chargeDistance), character.position);
  const opens = plan.flatMap((a) => (a.type === "openDoor" ? [hexKey(a.door)] : []));
  return {
    ...state,
    characters: state.characters.map((c) => (c.id === characterId ? { ...c, position } : c)),
    closedDoors: state.closedDoors.filter((d) => !opens.includes(hexKey(d))),
  };
}
