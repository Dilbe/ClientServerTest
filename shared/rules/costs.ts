// Upgrade costs (design.md, Upgrade points and Ability upgrades): every stat
// and ability upgrade has a cost formula, a function that gives the cost of
// the n-th upgrade (n = 1 for the first). Any formula fits; these helpers
// cover the common shape and the rounding.

/** A formula for the n-th upgrade's cost, before rounding. */
export type CostFormula = (n: number) => number;

/**
 * first upgrade cost × n^exponent: with an exponent of 0 every upgrade
 * costs the same, with 1 the cost rises in equal steps, with 2 it rises
 * faster and faster. All the adventurer's costs have this shape.
 */
export function powerCost(firstUpgradeCost: number, exponent: number): CostFormula {
  return (n) => firstUpgradeCost * n ** exponent;
}

/**
 * What the n-th upgrade costs with this formula: rounded up, and at least 1,
 * so a cost is always a whole number of points and never free.
 *
 * Powers with a fractional exponent are calculated with floating point,
 * which can be a hair off: 32^1.6 comes out as 256.00000000000006 instead
 * of 256. Rounding that up would charge one point too many, so a result
 * within a tiny margin of a whole number counts as that whole number.
 */
export function costOf(formula: CostFormula, n: number): number {
  return Math.max(1, Math.ceil(formula(n) - 1e-9));
}
