// The rules of ticking and unticking on "Choose your characters" (design.md,
// Sessions; issue #331), without the page. lobby.ts puts them on the page.
//
// This file uses no browser features (no `document`), so Node can run its
// tests like the server's, without a browser.

import { MAX_CHARACTERS_PER_PLAYER, type LobbyGame } from "../shared/protocol.ts";
import { DUNGEONS } from "../shared/rules/dungeon-map.ts";

/**
 * How many characters the player can bring: at most 3, and in a party no
 * more than the dungeon has room for next to the other players' characters.
 * `game`: the player's open game, or null outside a party. The server checks
 * this too (Lobby.checkChoice); the client only uses it to decide whether
 * ticking a character swaps it for the old one.
 */
export function roomForPlayer(game: LobbyGame | null, myName: string): number {
  if (game === null) return MAX_CHARACTERS_PER_PLAYER;
  const others = game.players
    .filter((p) => p.displayName !== myName)
    .reduce((sum, p) => sum + p.characters.length, 0);
  return Math.min(MAX_CHARACTERS_PER_PLAYER, DUNGEONS[game.dungeonId].maxCharacters - others);
}

/**
 * The choice after ticking or unticking one character. Ticking adds it, but
 * when there is room for only 1 and 1 is already chosen, the new one
 * replaces the old one (issue #331): otherwise the player would have to
 * leave the game to switch. Unticking takes it out.
 */
export function nextChoice(choice: readonly number[], character: number, ticked: boolean, room: number): number[] {
  if (!ticked) return choice.filter((n) => n !== character);
  if (room <= 1 && choice.length === 1) return [character];
  return [...choice, character].sort((a, b) => a - b);
}
