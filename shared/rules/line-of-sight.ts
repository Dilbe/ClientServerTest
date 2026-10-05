// Line of sight (design.md, Line of sight): whether a ranged attack from one
// hex can reach another.
//
// The line runs from the centre of one hex to the centre of the other. It is
// blocked when it passes a hex that blocks sight: a wall or pillar (a hex
// that isn't on the map), a closed door, or a character. Monsters don't block
// it, so archers can shoot past the brutes that protect them. The two end
// hexes never block: the shooter and the target stand there.
//
// The edge case: when the line runs exactly along the border between two
// hexes, it only counts as blocked when *both* of them block sight. A line
// that just grazes a pillar, or runs along the wall at the edge of a room,
// still gets through. The rule works the same both ways, so if a monster
// can see a character, that character's hex can see the monster's too.

import { isOnMap } from "./dungeon-map.ts";
import { isClosedDoor, type GameState } from "./game-state.ts";
import { hexEquals, hexesBetween, type Hex } from "./hex.ts";

/** Whether `h` blocks a line passing it: a wall or pillar, a closed door, or a living character. */
export function blocksSight(state: GameState, h: Hex): boolean {
  return (
    !isOnMap(state.map, h) ||
    isClosedDoor(state, h) ||
    state.characters.some((c) => c.hp > 0 && c.position !== null && hexEquals(c.position, h))
  );
}

/** Whether nothing blocks the straight line between the centres of `from` and `to`. Neighbours always see each other. */
export function inLineOfSight(state: GameState, from: Hex, to: Hex): boolean {
  // Every step must get through: a single hex that doesn't block, or, on a
  // border, at least one of the two hexes that doesn't block.
  return hexesBetween(from, to).every((step) => step.some((h) => !blocksSight(state, h)));
}
