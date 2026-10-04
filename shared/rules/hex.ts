// Hex grid maths for flat-topped hexes (a flat side at the top).
//
// Positions use *axial* coordinates (q, r):
//
// - q is the column: it goes up by 1 for each step to the right.
// - r goes up by 1 for each step straight down. Because every column is
//   shifted half a hex compared with its neighbour, "straight right" is not
//   a direction on this grid: a step to the right goes either up-right
//   (q + 1, r - 1) or down-right (q + 1, r).
//
// With these two numbers the neighbours are always the same six offsets, and
// the distance is a short formula. That is why the rules use them.
//
// Maps are easier to describe as columns and rows (like a spreadsheet), so
// `fromOffset` and `toOffset` convert between the two. In that "offset"
// layout the odd columns (1, 3, 5, ...) are shifted half a hex down.
//
// Background reading: https://www.redblobgames.com/grids/hexagons/

export interface Hex {
  readonly q: number;
  readonly r: number;
}

export function hex(q: number, r: number): Hex {
  return { q, r };
}

/**
 * A string that is the same for every Hex with the same q and r, for use as
 * a key in a `Map` or `Set`. JavaScript compares objects by reference (like
 * a C# class without its own Equals), so two separate `{ q: 1, r: 2 }`
 * objects are different keys; their strings "1,2" are the same key.
 */
export function hexKey(h: Hex): string {
  return `${h.q},${h.r}`;
}

export function hexEquals(a: Hex, b: Hex): boolean {
  return a.q === b.q && a.r === b.r;
}

/**
 * The six directions, clockwise, starting at straight up. Monsters try their
 * moves in this order (design.md, Monsters), so the order is a game rule.
 */
export const DIRECTIONS = [
  { name: "up", dq: 0, dr: -1 },
  { name: "up-right", dq: 1, dr: -1 },
  { name: "down-right", dq: 1, dr: 0 },
  { name: "down", dq: 0, dr: 1 },
  { name: "down-left", dq: -1, dr: 1 },
  { name: "up-left", dq: -1, dr: 0 },
] as const;

export type Direction = (typeof DIRECTIONS)[number]["name"];

export function neighbour(h: Hex, direction: Direction): Hex {
  const d = DIRECTIONS.find((dir) => dir.name === direction)!;
  return hex(h.q + d.dq, h.r + d.dr);
}

/** All six neighbours, in direction order: clockwise, starting at straight up. */
export function neighbours(h: Hex): Hex[] {
  return DIRECTIONS.map((d) => hex(h.q + d.dq, h.r + d.dr));
}

/**
 * The number of steps between two hexes on an open grid (no walls). Two
 * neighbours are 1 apart; a hex is 0 from itself.
 */
export function distance(a: Hex, b: Hex): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

export function areNeighbours(a: Hex, b: Hex): boolean {
  return distance(a, b) === 1;
}

/**
 * Converts a column and row (odd columns shifted half a hex down) to axial
 * coordinates. Column 0, row 0 is the top-left hex and is (0, 0) in both.
 */
export function fromOffset(col: number, row: number): Hex {
  return hex(col, row - (col - (col & 1)) / 2);
}

export function toOffset(h: Hex): { col: number; row: number } {
  return { col: h.q, row: h.r + (h.q - (h.q & 1)) / 2 };
}

/** All hexes of a rectangle `width` columns wide and `height` rows high, column by column. */
export function rectangle(width: number, height: number): Hex[] {
  const hexes: Hex[] = [];
  for (let col = 0; col < width; col++) {
    for (let row = 0; row < height; row++) {
      hexes.push(fromOffset(col, row));
    }
  }
  return hexes;
}

/**
 * A breadth-first search: the fewest steps from `start` to every hex that can
 * be reached by walking only over hexes for which `canEnter` is true. The
 * result maps `hexKey`s to step counts; `start` itself is 0 steps away, and a
 * hex that can't be reached is not in the map at all.
 *
 * The search goes outwards in rings: first every hex 1 step away, then every
 * hex 2 steps away, and so on. A hex is counted the first time it is seen, and
 * because the rings are visited in order, that first time is always along a
 * shortest route. Walls and occupied hexes simply never get entered, so a
 * route around them is found automatically.
 */
export function stepsFrom(start: Hex, canEnter: (h: Hex) => boolean): Map<string, number> {
  const steps = new Map([[hexKey(start), 0]]);
  // A queue: hexes are added at the end and handled from the front. Reading
  // with an index is cheaper than `queue.shift()`, which moves every element.
  const queue: Hex[] = [start];
  for (let i = 0; i < queue.length; i++) {
    const h = queue[i]!;
    const next = steps.get(hexKey(h))! + 1;
    for (const n of neighbours(h)) {
      if (steps.has(hexKey(n)) || !canEnter(n)) continue;
      steps.set(hexKey(n), next);
      queue.push(n);
    }
  }
  return steps;
}
