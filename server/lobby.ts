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
//
// The host (the player who created the game, or took it over) chooses the
// dungeon and the difficulty, but a party only goes where everyone in it can
// play (design.md, Unlocking dungeons): the host can only choose what every
// player can play, and a player can only join a game whose choice they can
// play. The wins are in the database; the lobby asks for them through
// `winsOf` every time, so a win is counted at once.
//
// The host also sets the turn order: the order in which all the party's
// characters will act (design.md, Setting up the track). A character that
// joins the party is put at the end of it.
//
// A creator can make a game private with a password (design.md, Private
// games); anyone joining has to give it. And the host can remove (kick) any
// other player from the party before the start.

import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import {
  MAX_CHARACTERS_PER_PLAYER,
  type LobbyCharacter,
  type LobbyGame,
  type LobbyMessage,
  type TurnOrderEntry,
} from "../shared/protocol.ts";
import {
  canPlay,
  DEFAULT_DIFFICULTY,
  defaultChoice,
  DIFFICULTIES,
  type DifficultyId,
  type DungeonChoice,
  type DungeonWin,
} from "../shared/rules/difficulties.ts";
import { DUNGEONS, FIRST_DUNGEON, type Dungeon, type DungeonId } from "../shared/rules/dungeon-map.ts";
import { DEFAULT_TURN_DURATION, type TurnDurationId } from "../shared/turn-durations.ts";
import { RateLimiter } from "./rate-limit.ts";

/** Wrong game passwords an account may give per minute; more are refused unchecked. */
const WRONG_PASSWORDS_PER_MINUTE = 5;

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

/** A character in the turn order: whose it is, and its number within that account. */
export interface OrderedCharacter {
  accountId: number;
  number: number;
}

interface Game {
  id: string;
  /** In the order they joined; the first one is the creator. */
  players: Member[];
  /**
   * Every chosen character of every player, in the order they will act.
   * Kept up to date with the players' choices: always exactly their
   * characters, each once.
   */
  turnOrder: OrderedCharacter[];
  /** Chosen by the host; a new game starts with the host's next dungeon to clear. */
  dungeonId: DungeonId;
  /** Chosen by the host together with the dungeon. */
  difficulty: DifficultyId;
  /** Chosen by the creator when creating the game; it doesn't change after that. */
  turnDuration: TurnDurationId;
  /**
   * For a private game: the SHA-256 hash of its password; `undefined` for a
   * game anyone can join. Chosen by the creator; it doesn't change after that.
   */
  passwordHash: Buffer | undefined;
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
  /** The dungeons an account has won, per difficulty. */
  private readonly winsOf: (accountId: number) => readonly DungeonWin[];
  /** The real dungeons, unless a test passes its own (for example with a lower max characters). */
  private readonly dungeons: Record<DungeonId, Dungeon>;
  /**
   * Wrong game passwords per account. Without a limit, a script could try
   * thousands of passwords a minute over a few connections.
   */
  private readonly wrongPasswords = new RateLimiter(WRONG_PASSWORDS_PER_MINUTE, 60_000);

  constructor(
    isOnline: (accountId: number) => boolean,
    winsOf: (accountId: number) => readonly DungeonWin[],
    dungeons: Record<DungeonId, Dungeon> = DUNGEONS,
  ) {
    this.isOnline = isOnline;
    this.winsOf = winsOf;
    this.dungeons = dungeons;
  }

  create(
    player: LobbyPlayer,
    characters: readonly LobbyCharacter[],
    turnDuration: TurnDurationId = DEFAULT_TURN_DURATION,
    password = "",
  ): Refusal {
    if (this.gameOfAccount.has(player.accountId)) return "You are already in a game.";
    const game: Game = {
      id: randomUUID(),
      players: [],
      turnOrder: [],
      ...defaultChoice(this.winsOf(player.accountId)),
      turnDuration,
      // An empty password: a game anyone can join.
      passwordHash: password === "" ? undefined : hashPassword(password),
      started: false,
    };
    // The characters must fit in the dungeon the game starts with.
    const refusal = this.checkChoice(game, characters);
    if (refusal !== undefined) return refusal;
    game.players.push({ ...player, characters });
    addToTurnOrder(game, player.accountId, characters);
    this.games.set(game.id, game);
    this.gameOfAccount.set(player.accountId, game);
    return undefined;
  }

  join(player: LobbyPlayer, gameId: string, characters: readonly LobbyCharacter[], password = ""): Refusal {
    if (this.gameOfAccount.has(player.accountId)) return "You are already in a game.";
    const game = this.games.get(gameId);
    if (!game) return "That game no longer exists.";
    // Nobody joins after the start (design.md). For a different group,
    // create a new game.
    if (game.started) return "That game has already started.";
    // Before the password: someone who can't play the dungeon can't join
    // anyway, so a wrong password from them shouldn't count.
    if (!canPlay(this.winsOf(player.accountId), game)) {
      const dungeon = this.dungeonOf(game);
      return `You can't play ${dungeon.name} on ${DIFFICULTIES[game.difficulty].name} yet, so you can't join this game.`;
    }
    if (game.passwordHash) {
      const key = String(player.accountId);
      this.wrongPasswords.prune();
      const wait = this.wrongPasswords.retryAfter(key);
      if (wait > 0) return `Too many wrong passwords. Try again in ${Math.ceil(wait / 1000)} seconds.`;
      if (!timingSafeEqual(hashPassword(password), game.passwordHash)) {
        this.wrongPasswords.record(key);
        return password === "" ? "This game is private: enter its password to join." : "Wrong password.";
      }
    }
    const refusal = this.checkChoice(game, characters);
    if (refusal !== undefined) return refusal;
    game.players.push({ ...player, characters });
    addToTurnOrder(game, player.accountId, characters);
    this.gameOfAccount.set(player.accountId, game);
    return undefined;
  }

  /**
   * Changes which characters the player brings, until the game starts. Like
   * joining, a choice that takes the party over the dungeon's limit is
   * refused; the old choice then stays. In the turn order, the characters
   * the player keeps stay where they are, the ones they leave out are taken
   * out, and new ones go to the end.
   */
  chooseCharacters(accountId: number, characters: readonly LobbyCharacter[]): Refusal {
    const game = this.gameOfAccount.get(accountId);
    if (!game) return "You are not in a game.";
    if (game.started) return "The game has already started.";
    const member = game.players.find((p) => p.accountId === accountId)!;
    const refusal = this.checkChoice(game, characters, member);
    if (refusal !== undefined) return refusal;
    member.characters = characters;
    const kept = new Set(characters.map((c) => c.number));
    game.turnOrder = game.turnOrder.filter((o) => o.accountId !== accountId || kept.has(o.number));
    addToTurnOrder(game, accountId, characters);
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
   * Leaves the player's game. When the host leaves, the next player becomes
   * the host; the last one to leave removes the game. The choice of dungeon
   * and difficulty stays: everyone in the party could play it, so the new
   * host can too (wins are never taken away).
   */
  leave(accountId: number): Refusal {
    const game = this.gameOfAccount.get(accountId);
    if (!game) return "You are not in a game.";
    game.players = game.players.filter((p) => p.accountId !== accountId);
    game.turnOrder = game.turnOrder.filter((o) => o.accountId !== accountId);
    this.gameOfAccount.delete(accountId);
    if (game.players.length === 0) this.games.delete(game.id);
    return undefined;
  }

  /**
   * The host removes another player from their open game (design.md,
   * Private games), as if that player had left. The player is named by
   * their index in the game's `players` (the client never learns account
   * ids) and their display name: if the party changed while the host was
   * clicking, the index may point at someone else, and the name catches
   * that. Nothing else happens to the removed player: they may even join
   * again.
   */
  kick(accountId: number, player: number, displayName: string): Refusal {
    const game = this.gameOfAccount.get(accountId);
    if (!game) return "You are not in a game.";
    if (game.started) return "The game has already started.";
    if (game.players[0]!.accountId !== accountId) return "Only the player who created the game can remove players.";
    const target = game.players[player];
    if (!target || target.displayName !== displayName) return "The party changed in the meantime. Please try again.";
    if (target.accountId === accountId) return "You can't remove yourself. Use Leave instead.";
    return this.leave(target.accountId);
  }

  /**
   * The host chooses the dungeon and the difficulty of their open game. The
   * client only offers what everyone in the party can play, but anyone can
   * send any message to a public server, so it is checked here, against
   * every player's wins. A dungeon that allows fewer characters than the
   * party already has is refused too: nobody would know whom to send away.
   */
  chooseDungeon(accountId: number, choice: DungeonChoice): Refusal {
    const game = this.gameOfAccount.get(accountId);
    if (!game) return "You are not in a game.";
    if (game.started) return "The game has already started.";
    if (game.players[0]!.accountId !== accountId) return "Only the player who created the game can choose the dungeon.";
    const dungeon = this.dungeons[choice.dungeonId];
    const where = `${dungeon.name} on ${DIFFICULTIES[choice.difficulty].name}`;
    for (const player of game.players) {
      if (canPlay(this.winsOf(player.accountId), choice)) continue;
      return player.accountId === accountId
        ? `You can't play ${where} yet.`
        : `${player.displayName} can't play ${where} yet.`;
    }
    if (characterCount(game) > dungeon.maxCharacters) {
      return `${dungeon.name} allows at most ${dungeon.maxCharacters} characters, and the party has ${characterCount(game)}.`;
    }
    game.dungeonId = choice.dungeonId;
    game.difficulty = choice.difficulty;
    return undefined;
  }

  /**
   * The host sets the turn order of their open game. The new order must
   * have exactly the party's characters, each once: anything else (a client
   * that sent nonsense, or a party that changed while the host was moving
   * a character) is refused, and the order stays as it was.
   */
  setTurnOrder(accountId: number, order: readonly TurnOrderEntry[]): Refusal {
    const game = this.gameOfAccount.get(accountId);
    if (!game) return "You are not in a game.";
    if (game.started) return "The game has already started.";
    if (game.players[0]!.accountId !== accountId) return "Only the player who created the game can set the turn order.";
    const changed = "The party changed in the meantime. Please try again.";
    const next: OrderedCharacter[] = [];
    for (const { player, number } of order) {
      const member = game.players[player];
      if (!member) return changed;
      next.push({ accountId: member.accountId, number });
    }
    const key = (o: OrderedCharacter) => `${o.accountId}:${o.number}`;
    const current = new Set(game.turnOrder.map(key));
    const wanted = new Set(next.map(key));
    if (next.length !== game.turnOrder.length || wanted.size !== next.length || ![...wanted].every((k) => current.has(k))) {
      return changed;
    }
    game.turnOrder = next;
    return undefined;
  }

  start(accountId: number): Refusal {
    const game = this.gameOfAccount.get(accountId);
    if (!game) return "You are not in a game.";
    if (game.started) return "The game has already started.";
    if (game.players[0]!.accountId !== accountId) return "Only the player who created the game can start it.";
    // Can happen when a new host got their own next dungeon, which allows
    // fewer characters than the party has (not with today's dungeons).
    const dungeon = this.dungeonOf(game);
    if (characterCount(game) > dungeon.maxCharacters) {
      return `${dungeon.name} allows at most ${dungeon.maxCharacters} characters, and the party has ${characterCount(game)}.`;
    }
    game.started = true;
    return undefined;
  }

  /**
   * Puts a started game back after a restart, with the players who were
   * still in it. A player who is somehow in a game already is left out: an
   * account is in at most one game.
   */
  restoreStarted(gameId: string, players: readonly LobbyPlayer[]): void {
    // The lobby no longer needs the dungeon, the difficulty, the turn
    // duration or the characters: the game manager has them, and the client
    // doesn't show the lobby's copies for a started game.
    const game: Game = {
      id: gameId,
      players: [],
      turnOrder: [],
      dungeonId: FIRST_DUNGEON.id,
      difficulty: DEFAULT_DIFFICULTY,
      turnDuration: DEFAULT_TURN_DURATION,
      passwordHash: undefined,
      started: true,
    };
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
   * The numbers of the characters the account chose in its open game, or
   * none outside one. A started game's characters come from the game
   * manager (`recordsInPlay`): the lobby forgets them after a restart.
   */
  charactersInParty(accountId: number): number[] {
    const game = this.gameOfAccount.get(accountId);
    if (!game || game.started) return [];
    return game.players.find((p) => p.accountId === accountId)?.characters.map((c) => c.number) ?? [];
  }

  /**
   * The players of a game with the characters they chose, the creator
   * first; empty when the game doesn't exist.
   */
  playersOf(gameId: string): readonly (LobbyPlayer & { characters: readonly LobbyCharacter[] })[] {
    return this.games.get(gameId)?.players ?? [];
  }

  /** The characters of a game in the order they will act; empty when the game doesn't exist. */
  turnOrderOf(gameId: string): readonly OrderedCharacter[] {
    return this.games.get(gameId)?.turnOrder ?? [];
  }

  /** The turn duration chosen for a game; `undefined` when the game doesn't exist. */
  turnDurationOfGame(gameId: string): TurnDurationId | undefined {
    return this.games.get(gameId)?.turnDuration;
  }

  /** The dungeon chosen for a game; `undefined` when the game doesn't exist. */
  dungeonOfGame(gameId: string): Dungeon | undefined {
    const game = this.games.get(gameId);
    return game && this.dungeonOf(game);
  }

  /** The difficulty chosen for a game; `undefined` when the game doesn't exist. */
  difficultyOfGame(gameId: string): DifficultyId | undefined {
    return this.games.get(gameId)?.difficulty;
  }

  private dungeonOf(game: Game): Dungeon {
    return this.dungeons[game.dungeonId];
  }

  /**
   * The lobby as one player sees it. The dungeons the player has won and
   * their characters are stored in the database, not in the lobby:
   * websocket.ts adds them.
   */
  snapshotFor(accountId: number): Omit<LobbyMessage, "dungeonWins" | "yourCharacters"> {
    const mine = this.gameOfAccount.get(accountId);
    return {
      type: "lobby",
      openGames: [...this.games.values()].filter((g) => !g.started).map((g) => this.describe(g)),
      myGame: mine ? this.describe(mine, !mine.started) : null,
    };
  }

  /**
   * `withWins`: add every player's wins, for the player's own open game, so
   * the host's dungeon map can show what the whole party can play. Players
   * in the same party see each other's progress; nobody else does.
   */
  private describe(game: Game, withWins = false): LobbyGame {
    return {
      id: game.id,
      creator: game.players[0]!.displayName,
      players: game.players.map((p) => ({
        displayName: p.displayName,
        online: this.isOnline(p.accountId),
        characters: [...p.characters],
        ...(withWins ? { dungeonWins: [...this.winsOf(p.accountId)] } : {}),
      })),
      turnOrder: game.turnOrder.map((o) => ({
        player: game.players.findIndex((p) => p.accountId === o.accountId),
        number: o.number,
      })),
      dungeonId: game.dungeonId,
      difficulty: game.difficulty,
      turnDuration: game.turnDuration,
      // Only whether there is a password: the password itself never leaves the server.
      private: game.passwordHash !== undefined,
      started: game.started,
    };
  }
}

/**
 * The game password's SHA-256 hash. Comparing hashes rather than the
 * passwords themselves gives two values of the same length, which
 * timingSafeEqual needs: it takes equally long however many characters
 * match, so the time of a wrong answer gives nothing away. A fast hash is
 * enough here: the hash is only in memory, for as long as the open game.
 */
function hashPassword(password: string): Buffer {
  return createHash("sha256").update(password).digest();
}

/** Puts the player's characters that aren't in the turn order yet at its end. */
function addToTurnOrder(game: Game, accountId: number, characters: readonly LobbyCharacter[]): void {
  for (const { number } of characters) {
    if (!game.turnOrder.some((o) => o.accountId === accountId && o.number === number)) {
      game.turnOrder.push({ accountId, number });
    }
  }
}

/** The characters a game will start with: everyone's choices together. */
function characterCount(game: Game): number {
  return game.players.reduce((sum, p) => sum + p.characters.length, 0);
}
