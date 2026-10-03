// The lobby: games that players create, join and start.
//
// Everything is in memory: a server restart empties the lobby. That is
// acceptable for forming a party; running games will be stored in the event
// store once there is a real game (see architecture.md).
//
// This class only holds the rules and the state. It knows nothing about
// WebSockets: websocket.ts calls it and sends the results, which keeps the
// rules easy to test.

import { randomUUID } from "node:crypto";
import type { LobbyGame, LobbyMessage } from "../shared/protocol.ts";

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
