import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DIRECTIONS,
  areNeighbours,
  distance,
  fromOffset,
  hex,
  hexKey,
  neighbour,
  neighbours,
  rectangle,
  toOffset,
} from "./hex.ts";

test("neighbours come clockwise, starting at straight up", () => {
  assert.deepEqual(
    DIRECTIONS.map((d) => d.name),
    ["up", "up-right", "down-right", "down", "down-left", "up-left"],
  );
  assert.deepEqual(neighbours(hex(2, 3)), [hex(2, 2), hex(3, 2), hex(3, 3), hex(2, 4), hex(1, 4), hex(1, 3)]);
});

test("neighbour in one direction", () => {
  assert.deepEqual(neighbour(hex(0, 0), "up"), hex(0, -1));
  assert.deepEqual(neighbour(hex(0, 0), "down-right"), hex(1, 0));
});

test("going in opposite directions comes back to the start", () => {
  const start = hex(1, 1);
  assert.deepEqual(neighbour(neighbour(start, "up-right"), "down-left"), start);
  assert.deepEqual(neighbour(neighbour(start, "down"), "up"), start);
});

test("every neighbour is 1 away", () => {
  const center = hex(-2, 5);
  for (const n of neighbours(center)) {
    assert.equal(distance(center, n), 1);
    assert.ok(areNeighbours(center, n));
  }
  assert.ok(!areNeighbours(center, center));
});

test("distance", () => {
  assert.equal(distance(hex(0, 0), hex(0, 0)), 0);
  assert.equal(distance(hex(0, 0), hex(0, 3)), 3); // straight down
  assert.equal(distance(hex(0, 0), hex(3, 0)), 3); // down-right three times
  assert.equal(distance(hex(0, 0), hex(3, -3)), 3); // up-right three times
  assert.equal(distance(hex(0, 0), hex(2, 2)), 4);
  assert.equal(distance(hex(2, 2), hex(0, 0)), 4);
});

test("distance across a 6 by 4 room", () => {
  // From the top-left to the bottom-right hex: 5 steps right, and the
  // remaining rows straight down.
  assert.equal(distance(fromOffset(0, 0), fromOffset(5, 3)), 6);
  // Straight across, from the left column to the right column on the same row.
  assert.equal(distance(fromOffset(0, 1), fromOffset(5, 1)), 5);
});

test("offset columns and rows: odd columns are shifted half a hex down", () => {
  assert.deepEqual(fromOffset(0, 0), hex(0, 0));
  // Column 1 sits lower, so its row 0 is down-right of column 0, row 0 ...
  assert.deepEqual(fromOffset(1, 0), neighbour(fromOffset(0, 0), "down-right"));
  // ... and column 2, row 0 is up-right of column 1, row 0: back at the top.
  assert.deepEqual(fromOffset(2, 0), neighbour(fromOffset(1, 0), "up-right"));
  assert.deepEqual(fromOffset(2, 0), hex(2, -1));
});

test("offset conversion goes both ways", () => {
  for (const h of rectangle(7, 5)) {
    const { col, row } = toOffset(h);
    assert.deepEqual(fromOffset(col, row), h);
  }
});

test("a rectangle has width times height distinct hexes", () => {
  const hexes = rectangle(6, 4);
  assert.equal(hexes.length, 24);
  assert.equal(new Set(hexes.map(hexKey)).size, 24);
  for (const h of hexes) {
    const { col, row } = toOffset(h);
    assert.ok(col >= 0 && col < 6 && row >= 0 && row < 4);
  }
});

test("hexKey is the same for equal hexes", () => {
  assert.equal(hexKey(hex(1, -2)), hexKey({ q: 1, r: -2 }));
  assert.notEqual(hexKey(hex(1, 2)), hexKey(hex(2, 1)));
});
