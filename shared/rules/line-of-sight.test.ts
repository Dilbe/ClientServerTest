import { test } from "node:test";
import assert from "node:assert/strict";
import type { GameState } from "./game-state.ts";
import { hex, hexKey, type Hex } from "./hex.ts";
import { inLineOfSight } from "./line-of-sight.ts";
import { baseStats } from "./stats.ts";

// These tests use axial coordinates (see hex.ts) on a hexagon-shaped room
// around 0,0. Most look along the line from 0,0 straight down to 0,3, which
// passes 0,1 and 0,2. The edge case looks from 0,0 to 1,-2: that line runs
// exactly along the border between 0,-1 and 1,-1.

const FROM = hex(0, 0);
const TO = hex(0, 3);
const EDGE_TO = hex(1, -2);

/** Every hex at most `radius` steps from 0,0. */
function hexagon(radius: number): Hex[] {
  const hexes: Hex[] = [];
  for (let q = -radius; q <= radius; q++) {
    for (let r = -radius; r <= radius; r++) {
      if (Math.abs(q + r) <= radius) hexes.push(hex(q, r));
    }
  }
  return hexes;
}

interface Setup {
  /** Hexes taken out of the room: walls, or pillars inside it. */
  walls?: Hex[];
  closedDoors?: Hex[];
  /** Where living characters stand. */
  characters?: Hex[];
  /** Where dead characters lie. */
  dead?: Hex[];
  monsters?: Hex[];
}

function room({ walls = [], closedDoors = [], characters = [], dead = [], monsters = [] }: Setup = {}): GameState {
  const wallKeys = new Set(walls.map(hexKey));
  const character = (position: Hex, i: number, hp: number) => ({
    id: i + 1,
    stats: baseStats(),
    hp,
    position,
    xpGained: 0,
    maxXpGain: 450,
  });
  return {
    map: { hexes: hexagon(4).filter((h) => !wallKeys.has(hexKey(h))), startHexes: [], doors: closedDoors, monsters: [] },
    characters: [...characters.map((h, i) => character(h, i, 10)), ...dead.map((h, i) => character(h, 100 + i, 0))],
    monsters: monsters.map((position, id) => ({ id, type: "basic", hp: 3, position, asleep: false })),
    track: [],
    closedDoors,
  };
}

test("in an empty room, every hex is in line of sight", () => {
  const state = room();
  for (const h of hexagon(4)) assert.ok(inLineOfSight(state, FROM, h), hexKey(h));
});

test("a wall blocks line of sight", () => {
  assert.ok(!inLineOfSight(room({ walls: [hex(0, 2)] }), FROM, TO));
});

test("a pillar (a hole inside the room) blocks line of sight", () => {
  // A pillar is a hex that isn't part of the map, like a wall: the room goes on around it.
  const state = room({ walls: [hex(0, 1)] });
  assert.ok(!inLineOfSight(state, FROM, TO));
  // Next to the pillar, the view is clear.
  assert.ok(inLineOfSight(state, FROM, hex(2, 1)));
});

test("a closed door blocks line of sight, an open door doesn't", () => {
  const closed = room({ closedDoors: [hex(0, 1)] });
  assert.ok(!inLineOfSight(closed, FROM, TO));
  const open: GameState = { ...closed, closedDoors: [] };
  assert.ok(inLineOfSight(open, FROM, TO));
});

test("a living character blocks line of sight, a dead one doesn't", () => {
  assert.ok(!inLineOfSight(room({ characters: [hex(0, 2)] }), FROM, TO));
  assert.ok(inLineOfSight(room({ dead: [hex(0, 2)] }), FROM, TO));
});

test("monsters don't block line of sight", () => {
  assert.ok(inLineOfSight(room({ monsters: [hex(0, 1), hex(0, 2)] }), FROM, TO));
});

test("the hexes at both ends never block: the shooter and the target stand there", () => {
  assert.ok(inLineOfSight(room({ characters: [FROM, TO] }), FROM, TO));
});

test("neighbours always see each other", () => {
  assert.ok(inLineOfSight(room({ walls: hexagon(4).filter((h) => h.q !== 0) }), FROM, hex(0, 1)));
});

test("edge case: a line along the border between two hexes is blocked only when both block it", () => {
  // From 0,0 to 1,-2 the line runs exactly between 0,-1 and 1,-1.
  assert.ok(inLineOfSight(room(), FROM, EDGE_TO));
  // One of the two blocks: the line just grazes it, and gets through.
  assert.ok(inLineOfSight(room({ walls: [hex(0, -1)] }), FROM, EDGE_TO));
  assert.ok(inLineOfSight(room({ walls: [hex(1, -1)] }), FROM, EDGE_TO));
  assert.ok(inLineOfSight(room({ characters: [hex(0, -1)] }), FROM, EDGE_TO));
  // Both block, each in its own way: blocked.
  assert.ok(!inLineOfSight(room({ walls: [hex(0, -1)], characters: [hex(1, -1)] }), FROM, EDGE_TO));
  assert.ok(!inLineOfSight(room({ walls: [hex(0, -1), hex(1, -1)] }), FROM, EDGE_TO));
  assert.ok(!inLineOfSight(room({ closedDoors: [hex(0, -1)], walls: [hex(1, -1)] }), FROM, EDGE_TO));
});

test("line of sight is the same both ways", () => {
  const states = [room({ walls: [hex(0, -1)] }), room({ walls: [hex(1, 0)], characters: [hex(1, 1)] }), room()];
  for (const state of states) {
    for (const a of hexagon(4)) {
      for (const b of hexagon(2)) {
        assert.equal(inLineOfSight(state, a, b), inLineOfSight(state, b, a), `${hexKey(a)} and ${hexKey(b)}`);
      }
    }
  }
});
