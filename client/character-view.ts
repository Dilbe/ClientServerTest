// The rules of the character page's three screens (design.md, The character
// page; issue #386): which screen an address asks for, which characters can
// rank up together, and the short texts on the list. Kept apart from
// characters.ts, which draws the page, so they can be tested without a
// browser: they only turn data into answers.

import type { CharacterSummary } from "../shared/characters.ts";
import { canMakeAdvancedClassWith, canRankUpWith } from "../shared/rules/advancement.ts";
import { restState } from "../shared/rules/rest.ts";

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
 * The characters that `character` can rank up with (design.md, Class and
 * rank; issue #406), in the order given: what the server checks too. The
 * rank-up starts on the character that ranks up, so these are the extra
 * characters it would use up: normally of its class and one rank lower.
 * Neither may be in a running game (issue #153) or working in the village
 * (issue #408). `receivedAt` is when the page arrived, by `Date.now()`, as
 * for the rests on it (see rest.ts).
 */
export function rankUpPartners(
  character: CharacterSummary,
  all: readonly CharacterSummary[],
  receivedAt: number,
  now = Date.now(),
): CharacterSummary[] {
  return all.filter((other) => usable(character, other, receivedAt, now) && canRankUpWith(character, other));
}

/**
 * The characters that `character`, a rank 5 adventurer, can make an
 * advanced class with (design.md, Advanced classes; issue #406), in the
 * order given: rank 4 adventurers at their max level. What the server
 * checks too. `receivedAt` and `now` as for `rankUpPartners`.
 */
export function advancedClassPartners(
  character: CharacterSummary,
  all: readonly CharacterSummary[],
  receivedAt: number,
  now = Date.now(),
): CharacterSummary[] {
  return all.filter(
    (other) => usable(character, other, receivedAt, now) && canMakeAdvancedClassWith(character, other),
  );
}

/**
 * Whether two characters may be used up together at all: two different
 * ones, neither in a running game nor working in the village. The server
 * refuses both too (issue #153, #408); this only keeps them off the list.
 * A healing or resting character may be used up: it just isn't ready for
 * a dungeon.
 */
function usable(a: CharacterSummary, b: CharacterSummary, receivedAt: number, now: number): boolean {
  return a.number !== b.number && [a, b].every((c) => !c.inRunningGame && !working(c, receivedAt, now));
}

/** Whether it works in the village at `now`, from a page that arrived at `receivedAt` (see rest.ts). */
function working(character: CharacterSummary, receivedAt: number, now: number): boolean {
  const rest = {
    workingUntil: receivedAt + character.workDoneInMs,
    healingUntil: receivedAt + character.healedInMs,
    restingUntil: receivedAt + character.readyInMs,
  };
  return restState(rest, now) === "working";
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
