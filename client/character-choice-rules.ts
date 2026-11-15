// The rules of the party's list of places and the character picker
// (design.md, Parties and the lobby; issues #387 and #402), without the page.
// lobby.ts puts them on the page.
//
// This file uses no browser features (no `document`), so Node can run its
// tests like the server's, without a browser.

import { MAX_CHARACTERS_PER_PLAYER, type LobbyGame } from "../shared/protocol.ts";
import { DUNGEONS } from "../shared/rules/dungeon-map.ts";
import { maxLevel } from "../shared/rules/advancement.ts";
import type { ClassId } from "../shared/rules/classes.ts";

/**
 * How many characters the player can bring: at most 3, and in a party no
 * more than the dungeon has room for next to the other players' characters.
 * `game`: the player's open game, or null outside a party. The server checks
 * this too (Lobby.checkChoice); the client only uses it to know whether the
 * player can add a character.
 */
export function roomForPlayer(game: LobbyGame | null, myName: string): number {
  if (game === null) return MAX_CHARACTERS_PER_PLAYER;
  const others = game.players
    .filter((p) => p.displayName !== myName)
    .reduce((sum, p) => sum + p.characters.length, 0);
  return Math.min(MAX_CHARACTERS_PER_PLAYER, DUNGEONS[game.dungeonId].maxCharacters - others);
}

/**
 * The empty rows of the party's list of places (design.md, Parties and the
 * lobby; issue #402): the dungeon has `places`, of which `chosen` are
 * filled, `mine` of them by this player. The empty places the player can
 * still fill (up to their 3) are "+ Add a character" rows; the rest are
 * "Room for another player". Never below 0, also for a party that is (for
 * a moment) bigger than the dungeon.
 */
export function emptyRows(places: number, chosen: number, mine: number): { add: number; other: number } {
  const empty = Math.max(0, places - chosen);
  const add = Math.min(empty, Math.max(0, MAX_CHARACTERS_PER_PLAYER - mine));
  return { add, other: empty - add };
}

/** What the character picker is for: adding a character, or swapping (or taking out) one the player brings. */
export type PickerTarget = { kind: "add" } | { kind: "swap"; number: number };

/**
 * The picker an address asks for: `#/choose-characters/add`, or
 * `#/choose-characters/5` for the player's character 5. Anyone can type any
 * address, so only "add" and whole positive numbers count; anything else is
 * undefined, and the party is shown instead.
 */
export function pickerTarget(text: string): PickerTarget | undefined {
  if (text === "add") return { kind: "add" };
  if (/^[1-9]\d{0,8}$/.test(text)) return { kind: "swap", number: Number(text) };
  return undefined;
}

/** The address of a picker, the other way round from `pickerTarget`. */
export function pickerAddress(target: PickerTarget): string {
  return `#/choose-characters/${target.kind === "add" ? "add" : target.number}`;
}

/**
 * Whether the picker fits the party: adding needs room (`room`, see
 * `roomForPlayer`), and swapping a character the player brings.
 */
export function canPick(target: PickerTarget | undefined, choice: readonly number[], room: number): boolean {
  if (target === undefined) return false;
  if (target.kind === "add") return choice.length < room;
  return choice.includes(target.number);
}

/**
 * The choice after picking `character`: a swap puts it in the place of the
 * character it replaces (the server keeps that place in the turn order
 * too); adding puts it at the end. A character the player already brings
 * can't be picked: unchanged then.
 */
export function pick(choice: readonly number[], target: PickerTarget, character: number): number[] {
  if (choice.includes(character)) return [...choice];
  if (target.kind === "swap") return choice.map((n) => (n === target.number ? character : n));
  return [...choice, character];
}

/**
 * The choice after taking a character out. Never the last one: a player
 * always brings at least 1, so the choice is unchanged then.
 */
export function takeOut(choice: readonly number[], character: number): number[] {
  if (choice.length <= 1) return [...choice];
  return choice.filter((n) => n !== character);
}

/**
 * The character chosen by default outside a party (issue #373): the first
 * one in `sorted` (the character-page order) that `ready` allows and that is
 * below the max level of its rank, because one at its max level gains no XP.
 * When every ready character is at its max level, the first ready one, so
 * there is still a default. undefined when none is ready.
 */
export function defaultChoice<C extends { number: number; class: ClassId; rank: number; level: number }>(
  sorted: readonly C[],
  ready: (n: number) => boolean,
): C | undefined {
  const candidates = sorted.filter((c) => ready(c.number));
  return candidates.find((c) => c.level < maxLevel(c.class, c.rank)) ?? candidates[0];
}
