// The rules of the character slots in the party and the picker that fills
// them (design.md, Parties and the lobby; issue #387), without the page.
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
 * this too (Lobby.checkChoice); the client only uses it to show which slots
 * have room.
 */
export function roomForPlayer(game: LobbyGame | null, myName: string): number {
  if (game === null) return MAX_CHARACTERS_PER_PLAYER;
  const others = game.players
    .filter((p) => p.displayName !== myName)
    .reduce((sum, p) => sum + p.characters.length, 0);
  return Math.min(MAX_CHARACTERS_PER_PLAYER, DUNGEONS[game.dungeonId].maxCharacters - others);
}

/**
 * What each of the player's 3 slots on their party card is (design.md,
 * Parties and the lobby; issue #387): the chosen characters fill the first
 * slots, in the order chosen; an empty slot after them is open while the
 * party has room for it, and otherwise has no room.
 */
export type SlotState = "filled" | "open" | "noRoom";

export function slotStates(chosen: number, room: number): SlotState[] {
  return Array.from({ length: MAX_CHARACTERS_PER_PLAYER }, (_, slot) =>
    slot < chosen ? "filled" : slot < room ? "open" : "noRoom",
  );
}

/**
 * The slot an address asks for, 0 to 2, from its number as the player sees
 * it ("1" to "3" in `#/choose-characters/2`), or -1 for anything else.
 */
export function slotFromAddress(text: string): number {
  return /^[1-3]$/.test(text) ? Number(text) - 1 : -1;
}

/**
 * Whether the character picker can open for a slot: a filled one (to swap
 * or take out its character) or an open one. The slot comes from the
 * address, which anyone can type, so anything else shows the party instead.
 */
export function canPickForSlot(slot: number, chosen: number, room: number): boolean {
  // Indexing with -1, 1.5 or NaN gives undefined, like an index past the end.
  const state = slotStates(chosen, room)[slot];
  return state === "filled" || state === "open";
}

/**
 * The choice after picking `character` for `slot`: on a filled slot it takes
 * the place of the character there (a swap, so it works in a full party, as
 * issue #331 did for a party with room for 1); on an open slot it is added.
 * A character already in another slot can't be picked: unchanged then.
 */
export function pickForSlot(choice: readonly number[], slot: number, character: number): number[] {
  if (choice.some((n, i) => n === character && i !== slot)) return [...choice];
  if (slot < choice.length) return choice.map((n, i) => (i === slot ? character : n));
  return [...choice, character];
}

/**
 * The choice after taking the character in `slot` out. Never the last one:
 * a player always brings at least 1, so the choice is unchanged then.
 */
export function takeOutOfSlot(choice: readonly number[], slot: number): number[] {
  if (choice.length <= 1) return [...choice];
  return choice.filter((_, i) => i !== slot);
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
