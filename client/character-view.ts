// The rules of the character page's three screens (design.md, The character
// page; issue #386): which screen an address asks for, which characters can
// rank up together, and the short texts on the list. Kept apart from
// characters.ts, which draws the page, so they can be tested without a
// browser: they only turn data into answers.

import type { CharacterSummary } from "../shared/characters.ts";
import { canMakeAdvancedClass, canRankUp } from "../shared/rules/advancement.ts";

/** The list, the buying screen, or one character's screen. */
export type CharacterView = { kind: "list" } | { kind: "buy" } | { kind: "character"; number: number };

/**
 * The screen an address asks for: `#/characters` is the list,
 * `#/characters/buy` the buying screen and `#/characters/3` character 3.
 * `rest` is what comes after "/characters/", or null when nothing does.
 *
 * Anyone can type any address, so this is untrusted input, like a query
 * string in a web request. Only whole positive numbers of at most 9 digits
 * name a character: no "3.5", "-1", "1e3" or " 3", which Number() would
 * accept or round. Anything else shows the list. Whether the player has that
 * character is checked when the page arrives; the server checks every action
 * anyway, whatever the address says.
 */
export function characterView(rest: string | null): CharacterView {
  if (rest === null || rest === "") return { kind: "list" };
  if (rest === "buy") return { kind: "buy" };
  if (/^[1-9]\d{0,8}$/.test(rest)) return { kind: "character", number: Number(rest) };
  return { kind: "list" };
}

/** The address of a screen, the other way round from `characterView`. */
export function characterViewAddress(view: CharacterView): string {
  if (view.kind === "buy") return "#/characters/buy";
  if (view.kind === "character") return `#/characters/${view.number}`;
  return "#/characters";
}

/**
 * Whether two characters can rank up together: what the server checks too.
 * Neither may be in a running game (issue #153).
 */
export function canRankUpTogether(a: CharacterSummary, b: CharacterSummary): boolean {
  return (
    a.number !== b.number &&
    !a.inRunningGame &&
    !b.inRunningGame &&
    a.class === b.class &&
    a.rank === b.rank &&
    canRankUp(a.xp, a.class, a.rank) &&
    canRankUp(b.xp, b.class, b.rank)
  );
}

/**
 * Whether two characters can make an advanced class together: what the
 * server checks too. Neither may be in a running game (issue #153).
 */
export function canMakeAdvancedClassTogether(a: CharacterSummary, b: CharacterSummary): boolean {
  return (
    a.number !== b.number &&
    !a.inRunningGame &&
    !b.inRunningGame &&
    canMakeAdvancedClass(a.xp, a.class, a.rank) &&
    canMakeAdvancedClass(b.xp, b.class, b.rank)
  );
}

/** The characters `character` can rank up with, in the order given. */
export function rankUpPartners(character: CharacterSummary, all: readonly CharacterSummary[]): CharacterSummary[] {
  return all.filter((other) => canRankUpTogether(character, other));
}

/** The characters `character` can make an advanced class with, in the order given. */
export function advancedClassPartners(
  character: CharacterSummary,
  all: readonly CharacterSummary[],
): CharacterSummary[] {
  return all.filter((other) => canMakeAdvancedClassTogether(character, other));
}

/**
 * The character a rank-up or an advanced class just made: the one number
 * that is new. Numbers are never reused (design.md, Characters), so a new
 * number is a new character. Undefined unless exactly one is new.
 */
export function newCharacterNumber(before: readonly number[], after: readonly number[]): number | undefined {
  const added = after.filter((number) => !before.includes(number));
  return added.length === 1 ? added[0] : undefined;
}

/** "4 points to spend", "1 point to spend", or "" with none, for the list's short cards. */
export function pointsToSpendText(points: number): string {
  if (points <= 0) return "";
  return `${points} ${points === 1 ? "point" : "points"} to spend`;
}
