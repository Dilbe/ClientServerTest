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
import {
  MAX_CHARACTERS_PER_PLAYER,
  type LobbyCharacter,
  type LobbyGame,
  type LobbyMessage,
} from "../shared/protocol.ts";
import { DUNGEONS, FIRST_DUNGEON, type Dungeon, type DungeonId } from "../shared/rules/dungeon-map.ts";

export interface LobbyPlayer {
  accountId: number;
  displayName: string;
}

/** A player in a game, with the characters they bring. */
interface Member extends LobbyPlayer {
  /**
   * The characters the player chose. websocket.ts has already checked that
   * they are the player's own; the lobby only checks how many there are.
   */
  characters: readonly LobbyCharacter[];
}

interface Game {
  id: string;
  /** In the order they joined; the first one is the creator. */
  players: Member[];
  /** Chosen by the creator; a new game starts with the first dungeon. */
  dungeonId: DungeonId;
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
  /** The real dungeons, unless a test passes its own (for example with a lower max characters). */
  private readonly dungeons: Record<DungeonId, Dungeon>;

  constructor(isOnline: (accountId: number) => boolean, dungeons: Record<DungeonId, Dungeon> = DUNGEONS) {
    this.isOnline = isOnline;
    this.dungeons = dungeons;
  }

  create(player: LobbyPlayer, characters: readonly LobbyCharacter[]): Refusal {
    if (this.gameOfAccount.has(player.accountId)) return "You are already in a game.";
    const game: Game = { id: randomUUID(), players: [], dungeonId: FIRST_DUNGEON.id, started: false };
    // A new game starts in the first dungeon, so the choice must fit there.
    const refusal = this.checkChoice(game, characters);
    if (refusal !== undefined) return refusal;
    game.players.push({ ...player, characters });
    this.games.set(game.id, game);
    this.gameOfAccount.set(player.accountId, game);
    return undefined;
  }

  join(player: LobbyPlayer, gameId: string, characters: readonly LobbyCharacter[]): Refusal {
    if (this.gameOfAccount.has(player.accountId)) return "You are already in a game.";
    const game = this.games.get(gameId);
    if (!game) return "That game no longer exists.";
    // Nobody joins after the start (design.md). For a different group,
    // create a new game.
    if (game.started) return "That game has already started.";
    const refusal = this.checkChoice(game, characters);
    if (refusal !== undefined) return refusal;
    game.players.push({ ...player, characters });
    this.gameOfAccount.set(player.accountId, game);
    return undefined;
  }

  /**
   * Changes which characters the player brings, until the game starts. Like
   * joining, a choice that takes the party over the dungeon's limit is
   * refused; the old choice then stays.
   */
  chooseCharacters(accountId: number, characters: readonly LobbyCharacter[]): Refusal {
    const game = this.gameOfAccount.get(accountId);
    if (!game) return "You are not in a game.";
    if (game.started) return "The game has already started.";
    const member = game.players.find((p) => p.accountId === accountId)!;
    const refusal = this.checkChoice(game, characters, member);
    if (refusal !== undefined) return refusal;
    member.characters = characters;
    return undefined;
  }

  /**
   * Whether a player can bring these characters into the game: 1 to 3 of
   * them, and no more than the dungeon allows together with the others'.
   * `replacing` is the player's own current choice, which the new one replaces.
   * The message schema already checks the number of characters; checking it
   * here too keeps the rule in one place for anyone calling the lobby.
   */
  private checkChoice(game: Game, characters: readonly LobbyCharacter[], replacing?: Member): Refusal {
    if (characters.length < 1 || characters.length > MAX_CHARACTERS_PER_PLAYER) {
      return `Choose 1 to ${MAX_CHARACTERS_PER_PLAYER} characters.`;
    }
    if (new Set(characters.map((c) => c.number)).size !== characters.length) {
      return "A character can be chosen only once.";
    }
    const max = this.dungeonOf(game).maxCharacters;
    const others = characterCount(game) - (replacing?.characters.length ?? 0);
    if (others + characters.length > max) {
      return `Too many characters: the dungeon allows at most ${max}, and the others bring ${others}.`;
    }
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

  /**
   * The creator chooses the dungeon of their open game. A dungeon that
   * allows fewer characters than the party already has is refused: nobody
   * would know whom to send away.
   */
  chooseDungeon(accountId: number, dungeonId: DungeonId): Refusal {
    const game = this.gameOfAccount.get(accountId);
    if (!game) return "You are not in a game.";
    if (game.started) return "The game has already started.";
    if (game.players[0]!.accountId !== accountId) return "Only the player who created the game can choose the dungeon.";
    const dungeon = this.dungeons[dungeonId];
    if (characterCount(game) > dungeon.maxCharacters) {
      return `${dungeon.name} allows at most ${dungeon.maxCharacters} characters, and the party has ${characterCount(game)}.`;
    }
    game.dungeonId = dungeonId;
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
    // The lobby no longer needs the dungeon or the characters: the game
    // manager has them, and the client doesn't show the lobby's dungeon or
    // characters for a started game.
    const game: Game = { id: gameId, players: [], dungeonId: FIRST_DUNGEON.id, started: true };
    for (const player of players) {
      if (this.gameOfAccount.has(player.accountId)) continue;
      game.players.push({ ...player, characters: [] });
      this.gameOfAccount.set(player.accountId, game);
    }
    if (game.players.length > 0) this.games.set(gameId, game);
  }

  /** The id of the game the account is in, open or started. */
  gameIdOf(accountId: number): string | undefined {
    return this.gameOfAccount.get(accountId)?.id;
  }

  /**
   * The players of a game with the characters they chose, the creator
   * first; empty when the game doesn't exist.
   */
  playersOf(gameId: string): readonly (LobbyPlayer & { characters: readonly LobbyCharacter[] })[] {
    return this.games.get(gameId)?.players ?? [];
  }

  /** The dungeon chosen for a game; `undefined` when the game doesn't exist. */
  dungeonOfGame(gameId: string): Dungeon | undefined {
    const game = this.games.get(gameId);
    return game && this.dungeonOf(game);
  }

  private dungeonOf(game: Game): Dungeon {
    return this.dungeons[game.dungeonId];
  }

  /**
   * The lobby as one player sees it. The dungeons the player has won and
   * their characters are stored in the database, not in the lobby:
   * websocket.ts adds them.
   */
  snapshotFor(accountId: number): Omit<LobbyMessage, "dungeonsWon" | "yourCharacters"> {
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
      players: game.players.map((p) => ({
        displayName: p.displayName,
        online: this.isOnline(p.accountId),
        characters: [...p.characters],
      })),
      dungeonId: game.dungeonId,
      started: game.started,
    };
  }
}

/** The characters a game will start with: everyone's choices together. */
function characterCount(game: Game): number {
  return game.players.reduce((sum, p) => sum + p.characters.length, 0);
}
