// Rounding helpers for the rules.
//
// JavaScript's Math.round always rounds .5 up (2.5 becomes 3, 3.5 becomes 4).
// .NET's Math.Round rounds .5 to the even neighbour by default
// (MidpointRounding.ToEven, "banker's rounding"); JavaScript has nothing
// built in for that, so it is here.

/**
 * Rounds to the nearest whole number, and a value exactly halfway to the
 * even one: 2.5 becomes 2, 3.5 becomes 4, 7.5 becomes 8, 12.5 becomes 12.
 * Over a run of halves it rounds up as often as down, so the rounding
 * doesn't add up in one direction (design.md, Levels).
 */
export function roundHalfToEven(value: number): number {
  const below = Math.floor(value);
  const fraction = value - below;
  if (fraction < 0.5) return below;
  if (fraction > 0.5) return below + 1;
  return below % 2 === 0 ? below : below + 1;
}
