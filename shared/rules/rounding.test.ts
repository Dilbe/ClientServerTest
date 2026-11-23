import { test } from "node:test";
import assert from "node:assert/strict";
import { roundHalfToEven } from "./rounding.ts";

test("roundHalfToEven rounds a half to the even neighbour, and anything else to the nearest", () => {
  const cases: [value: number, rounded: number][] = [
    [0, 0],
    [0.5, 0],
    [1.5, 2],
    [2.5, 2],
    [3.5, 4],
    [7.5, 8],
    [12.5, 12],
    [2.4, 2],
    [2.6, 3],
    [5, 5],
    [-2.5, -2],
    [-3.5, -4],
  ];
  for (const [value, rounded] of cases) assert.equal(roundHalfToEven(value), rounded, `${value}`);
});

test("over a run of halves it rounds up as often as down", () => {
  const halves = [1, 3, 5, 7, 9, 11, 13, 15].map((n) => n * 2.5);
  const sum = halves.reduce((a, b) => a + b, 0);
  const rounded = halves.map(roundHalfToEven).reduce((a, b) => a + b, 0);
  assert.equal(rounded, sum);
});
