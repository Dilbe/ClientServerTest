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
 * The hexes a straight line from the centre of `a` to the centre of `b`
 * passes on the way, without `a` and `b` themselves (design.md, Line of
 * sight). One entry per step, in order from `a`: `distance(a, b) - 1`
 * entries, so none for neighbours.
 *
 * An entry is usually one hex. When the line runs exactly along the border
 * between two hexes at that step, the entry holds both, and the caller
 * decides what that means. There are never three: a step never lands on a
 * corner where three hexes meet. (Along the coordinate that changes the
 * most, q, r or s, every step moves exactly 1, so that coordinate is always
 * a whole number, and a corner has none.)
 *
 * How it works: walk along the line in `distance` equal steps, and round each
 * point to the hex it lies in. A point exactly on a border rounds either way
 * depending on tiny floating-point errors, so each point is rounded twice,
 * nudged a tiny bit to one side and then to the other. If both give the same
 * hex the point is clearly inside it; if not, it is on the border between
 * them. (Red Blob Games, "Line drawing", uses the same nudge.)
 */
export function hexesBetween(a: Hex, b: Hex): Hex[][] {
  const steps = distance(a, b);
  const result: Hex[][] = [];
  for (let i = 1; i < steps; i++) {
    const q = a.q + ((b.q - a.q) * i) / steps;
    const r = a.r + ((b.r - a.r) * i) / steps;
    // Nudging q and r by different amounts moves the point off every border
    // direction, so the two nudges always land on opposite sides of a border.
    const one = roundHex(q + NUDGE, r + 2 * NUDGE);
    const other = roundHex(q - NUDGE, r - 2 * NUDGE);
    result.push(hexEquals(one, other) ? [one] : [one, other]);
  }
  return result;
}

/** Far smaller than any real distance between points on a line, far larger than rounding errors. */
const NUDGE = 1e-6;

/**
 * The hex a point lies in, for a point given in axial coordinates that aren't
 * whole numbers. Rounding q and r on their own can give the wrong hex near
 * corners, so this rounds all three cube coordinates (q, r and s = -q - r,
 * which always add up to 0) and then fixes the one that moved the most.
 */
function roundHex(q: number, r: number): Hex {
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  const rs = Math.round(s);
  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  // `+ 0` turns -0 into 0: Math.round(-0.2) is -0, which tests that compare
  // with Object.is (like assert.deepStrictEqual) see as a different number.
  return hex(rq + 0, rr + 0);
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
