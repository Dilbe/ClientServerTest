// Line of sight (design.md, Line of sight): whether a ranged attack from one
// hex can reach another.
//
// The line runs from the centre of one hex to the centre of the other. It is
// blocked when it passes a hex that blocks sight: a wall or pillar (a hex
// that isn't on the map), a closed door, a created wall, or a character. Monsters don't block
// it, so archers can shoot past the brutes that protect them. The two end
// hexes never block: the shooter and the target stand there.
//
// The edge case: when the line runs exactly along the border between two
// hexes, it only counts as blocked when *both* of them block sight. A line
// that just grazes a pillar, or runs along the wall at the edge of a room,
// still gets through. The rule works the same both ways, so if a monster
// can see a character, that character's hex can see the monster's too.
//
// A character's shot (design.md, Ranged attacks for characters) uses the same
// rule with the sides swapped: monsters block it, characters don't.

import { isOnMap } from "./dungeon-map.ts";
import { isClosedDoor, isCreatedWall, type GameState } from "./game-state.ts";
import { hexEquals, hexesBetween, type Hex } from "./hex.ts";

/** Whether `h` blocks a line passing it: a wall or pillar, a closed door, a created wall, or a living character. */
export function blocksSight(state: GameState, h: Hex): boolean {
  return (
    !isOnMap(state.map, h) ||
    isClosedDoor(state, h) ||
    isCreatedWall(state, h) ||
    state.characters.some((c) => c.hp > 0 && c.position !== null && hexEquals(c.position, h))
  );
}

/** Whether nothing blocks the straight line between the centres of `from` and `to`. Neighbours always see each other. */
export function inLineOfSight(state: GameState, from: Hex, to: Hex): boolean {
  // Every step must get through: a single hex that doesn't block, or, on a
  // border, at least one of the two hexes that doesn't block.
  return hexesBetween(from, to).every((step) => step.some((h) => !blocksSight(state, h)));
}

/**
 * Whether `h` blocks the looser line of sight of a meteor (design.md,
 * Meteor): only walls, pillars, closed doors and created walls; characters
 * don't, so it can be cast over the heads of allies.
 */
export function blocksTerrainSight(state: GameState, h: Hex): boolean {
  return !isOnMap(state.map, h) || isClosedDoor(state, h) || isCreatedWall(state, h);
}

/** Like `inLineOfSight`, but only walls, pillars, closed doors and created walls block it. */
export function inLooseLineOfSight(state: GameState, from: Hex, to: Hex): boolean {
  return hexesBetween(from, to).every((step) => step.some((h) => !blocksTerrainSight(state, h)));
}

/**
 * Whether `h` blocks a character's shot passing it (design.md, Ranged
 * attacks for characters): a wall or pillar, a closed door, a created wall,
 * or a living monster. Characters don't, so a ranger shoots past the tank in
 * front of it, and a monster gives the ones behind it cover.
 */
export function blocksCharacterSight(state: GameState, h: Hex): boolean {
  return blocksTerrainSight(state, h) || state.monsters.some((m) => m.hp > 0 && hexEquals(m.position, h));
}

/** Like `inLineOfSight`, from a character's side: monsters block it, characters don't. The same edge case rule. */
export function inCharacterLineOfSight(state: GameState, from: Hex, to: Hex): boolean {
  return hexesBetween(from, to).every((step) => step.some((h) => !blocksCharacterSight(state, h)));
}
