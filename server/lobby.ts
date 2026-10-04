// The lobby: games that players create, join and start.
//
// Everything is in memory: a server restart empties the lobby. That is
// acceptable for forming a party (see architecture.md). Once a game has
// started, the game manager (game-manager.ts) runs it and stores it; the
// lobby only remembers who is in it. After a restart the game manager tells
// the lobby who was in each stored game (`restoreStarted`).
//
// This class only holds the rules and the state. It knows nothing about
// WebSockets: websocket.ts calls it and sends the results, which keeps the
// rules easy to test.

import { randomUUID } from "node:crypto";
import type { LobbyGame, LobbyMessage } from "../shared/protocol.ts";

/**
 * Players per game. Each player brings one character for now, and the first
 * dungeon allows at most 4 characters (design.md, The dungeons). Once
 * dungeons are data (#28), this becomes the chosen dungeon's limit.
 */
export const MAX_PLAYERS = 4;

export interface LobbyPlayer {
  accountId: number;
  displayName: string;
}

interface Game {
  id: string;
  /** In the order they joined; the first one is the creator. */
  players: LobbyPlayer[];
  started: boolean;
}

/** `undefined` when the action was done, otherwise the reason it was refused. */
export type Refusal = string | undefined;

export class Lobby {
  /** In creation order, so the list shows the oldest game first. */
  private readonly games = new Map<string, Game>();
  /** Which game each account is in. An account is in at most one game. */
  private readonly gameOfAccount = new Map<number, Game>();
  private readonly isOnline: (accountId: number) => boolean;

  constructor(isOnline: (accountId: number) => boolean) {
    this.isOnline = isOnline;
  }

  create(player: LobbyPlayer): Refusal {
    if (this.gameOfAccount.has(player.accountId)) return "You are already in a game.";
    const game: Game = { id: randomUUID(), players: [player], started: false };
    this.games.set(game.id, game);
    this.gameOfAccount.set(player.accountId, game);
    return undefined;
  }

  join(player: LobbyPlayer, gameId: string): Refusal {
    if (this.gameOfAccount.has(player.accountId)) return "You are already in a game.";
    const game = this.games.get(gameId);
    if (!game) return "That game no longer exists.";
    // Nobody joins after the start (design.md). For a different group,
    // create a new game.
    if (game.started) return "That game has already started.";
    if (game.players.length >= MAX_PLAYERS) return `That game is full: at most ${MAX_PLAYERS} players.`;
    game.players.push(player);
    this.gameOfAccount.set(player.accountId, game);
    return undefined;
  }

  /**
   * Leaves the player's game. When the creator leaves, the next player
   * becomes the creator; the last one to leave removes the game.
   */
  leave(accountId: number): Refusal {
    const game = this.gameOfAccount.get(accountId);
    if (!game) return "You are not in a game.";
    game.players = game.players.filter((p) => p.accountId !== accountId);
    this.gameOfAccount.delete(accountId);
    if (game.players.length === 0) this.games.delete(game.id);
    return undefined;
  }

  start(accountId: number): Refusal {
    const game = this.gameOfAccount.get(accountId);
    if (!game) return "You are not in a game.";
    if (game.started) return "The game has already started.";
    if (game.players[0]!.accountId !== accountId) return "Only the player who created the game can start it.";
    game.started = true;
    return undefined;
  }

  /**
   * Puts a started game back after a restart, with the players who were
   * still in it. A player who is somehow in a game already is left out: an
   * account is in at most one game.
   */
  restoreStarted(gameId: string, players: readonly LobbyPlayer[]): void {
    const game: Game = { id: gameId, players: [], started: true };
    for (const player of players) {
      if (this.gameOfAccount.has(player.accountId)) continue;
      game.players.push(player);
      this.gameOfAccount.set(player.accountId, game);
    }
    if (game.players.length > 0) this.games.set(gameId, game);
  }

  /** The id of the game the account is in, open or started. */
  gameIdOf(accountId: number): string | undefined {
    return this.gameOfAccount.get(accountId)?.id;
  }

  /** The players of a game, the creator first; empty when the game doesn't exist. */
  playersOf(gameId: string): readonly LobbyPlayer[] {
    return this.games.get(gameId)?.players ?? [];
  }

  /** The lobby as one player sees it. */
  snapshotFor(accountId: number): LobbyMessage {
    const mine = this.gameOfAccount.get(accountId);
    return {
      type: "lobby",
      openGames: [...this.games.values()].filter((g) => !g.started).map((g) => this.describe(g)),
      myGame: mine ? this.describe(mine) : null,
    };
  }

  private describe(game: Game): LobbyGame {
    return {
      id: game.id,
      creator: game.players[0]!.displayName,
      players: game.players.map((p) => ({ displayName: p.displayName, online: this.isOnline(p.accountId) })),
      started: game.started,
    };
  }
}
