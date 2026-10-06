// The WebSocket endpoint: one long-lived connection per open browser tab,
// only for logged-in players. It carries the lobby and the running games.

import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import {
  clientMessage,
  MAX_MESSAGE_BYTES,
  parseMessage,
  type ClientMessage,
  type LobbyCharacter,
  type LobbyGame,
  type ServerMessage,
} from "../shared/protocol.ts";
import { nameOfCharacter } from "../shared/characters.ts";
import { levelFromXp, maxLevel, maxXp } from "../shared/rules/advancement.ts";
import { dungeonXpPercent, killsIn } from "../shared/rules/diminishing-returns.ts";
import { DUNGEONS } from "../shared/rules/dungeon-map.ts";
import { statsWithUpgrades } from "../shared/rules/upgrades.ts";
import { findAccount, type Account } from "./accounts.ts";
import { charactersOfAccount, type Character } from "./characters.ts";
import { readCookie, SESSION_COOKIE } from "./cookies.ts";
import type { Db } from "./database.ts";
import { dungeonWinsOf, hasWon } from "./dungeons-won.ts";
import { GameManager, type GameCharacter } from "./game-manager.ts";
import { SqliteGameStore } from "./game-store.ts";
import type { Lobby, Refusal } from "./lobby.ts";
import { isAllowedOrigin } from "./origin.ts";
import { RateLimiter } from "./rate-limit.ts";
import { useSession } from "./sessions.ts";
import { startTurnTimer } from "./turn-timer.ts";

export const WEBSOCKET_PATH = "/ws";
/** How often the server checks that each connection is still alive. */
const HEARTBEAT_MS = 30_000;
/** Messages per connection per second; more are dropped. */
const MESSAGES_PER_SECOND = 20;

export interface WebSocketOptions {
  db: Db;
  /** The version of the client files being served. */
  version: () => string;
  publicOrigin: string | undefined;
  /** Only for tests: every game gets this cycle length instead of its turn duration (see game-manager.ts). */
  turnCycleMs?: number;
}

interface Client {
  ws: WebSocket;
  account: Account;
  tokenHash: string;
}

/** The open connections, so logging out can close them and the lobby knows who is online. */
export class Connections {
  private readonly clients = new Set<Client>();

  add(client: Client): void {
    this.clients.add(client);
  }

  remove(client: Client): void {
    this.clients.delete(client);
  }

  all(): Iterable<Client> {
    return this.clients;
  }

  isOnline(accountId: number): boolean {
    for (const client of this.clients) if (client.account.id === accountId) return true;
    return false;
  }

  closeSession(tokenHash: string): void {
    for (const client of this.clients) if (client.tokenHash === tokenHash) client.ws.close(4001, "logged out");
  }
}

/**
 * Sets up the WebSocket endpoint, the lobby and the running games. Returns a
 * function for a normal shutdown: it stops the timers and saves the server
 * time, so the downtime that follows doesn't count as game time.
 */
export function attachWebSocket(
  httpServer: Server,
  connections: Connections,
  lobby: Lobby,
  options: WebSocketOptions,
): () => void {
  // noServer: we decide ourselves which upgrade requests become our
  // WebSockets. Others are left alone (in development Vite uses one too).
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  const games = new GameManager({
    cycleMs: options.turnCycleMs,
    onTurn: (message) => sendToGame(message.gameId, message),
    store: new SqliteGameStore(options.db),
  });
  // Games that were running when the server stopped go on where they were.
  // Their players are put back in the lobby, so they find their game again
  // when they reconnect.
  for (const { gameId, players } of games.restore()) lobby.restoreStarted(gameId, players);
  const stopTurnTimer = startTurnTimer(games);
  httpServer.on("close", stopTurnTimer);
  /** Connections that answered the last heartbeat ping (see below). */
  const answeredPing = new WeakSet<WebSocket>();

  /** The lobby as one player sees it, with the dungeons they have won and their characters. */
  function lobbyFor(accountId: number): ServerMessage {
    const snapshot = lobby.snapshotFor(accountId);
    const myGame = snapshot.myGame && !snapshot.myGame.started ? withXpShown(snapshot.myGame) : snapshot.myGame;
    return {
      ...snapshot,
      myGame,
      dungeonWins: dungeonWinsOf(options.db, accountId),
      yourCharacters: charactersOfAccount(options.db, accountId).map((c) => ({
        ...describeCharacter(c),
        level: levelFromXp(c.data.xp, c.data.rank),
      })),
    };
  }

  /**
   * Adds to each chosen character of an open game the XP it would get from
   * the chosen dungeon and difficulty (design.md, Diminishing returns). It
   * is worked out from the character records every time the lobby is sent,
   * so it follows every change of dungeon, difficulty or characters. The
   * lobby's players are in the same order as in the snapshot.
   */
  function withXpShown(game: LobbyGame): LobbyGame {
    const players = lobby.playersOf(game.id);
    const map = DUNGEONS[game.dungeonId].map;
    return {
      ...game,
      players: game.players.map((player, i) => {
        const own = charactersOfAccount(options.db, players[i]!.accountId);
        return {
          ...player,
          characters: player.characters.map((chosen) => {
            const character = own.find((c) => c.number === chosen.number);
            if (!character) return chosen;
            const { xp, rank, kills } = character.data;
            if (levelFromXp(xp, rank) >= maxLevel(rank)) return { ...chosen, xp: "maxLevel" as const };
            const earlierKills = killsIn(kills, game.dungeonId, game.difficulty);
            return { ...chosen, xp: dungeonXpPercent(map, game.difficulty, earlierKills) };
          }),
        };
      }),
    };
  }

  /**
   * Looks up the characters a player chose, by their numbers within the
   * player's own account. A number the account doesn't have is refused:
   * the session decides whose characters these are, never the client.
   * Returns the characters, or the reason they were refused.
   */
  function ownCharacters(accountId: number, numbers: readonly number[]): LobbyCharacter[] | string {
    const own = charactersOfAccount(options.db, accountId);
    const chosen: LobbyCharacter[] = [];
    for (const number of numbers) {
      const character = own.find((c) => c.number === number);
      // The same answer whether the number is someone else's or nobody's.
      if (!character) return "That is not your character.";
      chosen.push(describeCharacter(character));
    }
    return chosen;
  }

  /**
   * Set by the shutdown function below. Connections still close after it,
   * and their "close" handlers mustn't read the database, which may be
   * closed by then.
   */
  let stopped = false;

  /** Sends every connected player the lobby as they see it. */
  function broadcastLobby(): void {
    if (stopped) return;
    for (const client of connections.all()) send(client.ws, lobbyFor(client.account.id));
  }

  /** Sends a message to every connected player in the game. */
  function sendToGame(gameId: string, message: ServerMessage): void {
    for (const client of connections.all()) {
      if (lobby.gameIdOf(client.account.id) === gameId) send(client.ws, message);
    }
  }

  httpServer.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (new URL(request.url ?? "/", "http://placeholder").pathname !== WEBSOCKET_PATH) return;

    // Check before accepting: a refused connection never becomes a WebSocket.
    if (!isAllowedOrigin(request, options.publicOrigin)) return refuse(socket, 403, "Forbidden");
    const token = readCookie(request, SESSION_COOKIE);
    const session = token === undefined ? undefined : useSession(options.db, token);
    const account = session && findAccount(options.db, session.accountId);
    if (!session || !account) return refuse(socket, 401, "Unauthorized");

    wss.handleUpgrade(request, socket, head, (ws) => {
      onConnection({ ws, account, tokenHash: session.tokenHash });
    });
  });

  function onConnection(client: Client): void {
    const { ws, account } = client;
    const wasOnline = connections.isOnline(account.id);
    connections.add(client);
    answeredPing.add(ws);
    ws.on("pong", () => answeredPing.add(ws));

    // Every (re)connect starts with a full snapshot, so a reconnect after a
    // dropped connection or a server restart works the same as a first visit.
    send(ws, { type: "hello", version: options.version(), displayName: account.displayName });
    if (wasOnline) send(ws, lobbyFor(account.id));
    else broadcastLobby(); // the others see this player come online
    const gameId = lobby.gameIdOf(account.id);
    const game = gameId === undefined ? undefined : games.snapshot(gameId, account.id);
    if (game) send(ws, game);

    const limiter = new RateLimiter(MESSAGES_PER_SECOND, 1000);
    ws.on("message", (data, isBinary) => {
      // Too many messages are dropped, like invalid ones, so a misbehaving
      // client can't keep the server busy.
      if (limiter.retryAfter("") > 0) return;
      limiter.record("");
      // Every message is checked against its schema; anything else is dropped.
      // The connection stays open, so a client bug doesn't disconnect the player.
      const message = isBinary ? undefined : parseMessage(clientMessage, data.toString());
      if (message === undefined) return;
      handleMessage(client, message);
    });

    ws.on("close", () => {
      connections.remove(client);
      // Disconnecting doesn't leave the game: on a phone that happens all the
      // time. The others only see the player go offline.
      if (!connections.isOnline(account.id)) broadcastLobby();
    });

    // Without an "error" listener, an error on one socket would crash the
    // whole process (an unhandled error event, like an unhandled exception).
    ws.on("error", () => ws.terminate());
  }

  function handleMessage(client: Client, message: ClientMessage): void {
    const player = { accountId: client.account.id, displayName: client.account.displayName };
    let refusal: Refusal;
    switch (message.type) {
      case "ping":
        send(client.ws, { type: "pong", id: message.id });
        return;
      case "create-game":
      case "join-game":
      case "choose-characters": {
        const characters = ownCharacters(player.accountId, message.characters);
        if (typeof characters === "string") refusal = characters;
        else if (message.type === "create-game") refusal = lobby.create(player, characters, message.turnDuration);
        else if (message.type === "join-game") refusal = lobby.join(player, message.gameId, characters);
        else refusal = lobby.chooseCharacters(player.accountId, characters);
        break;
      }
      case "get-lobby":
        // Only to this connection: nothing changed for anyone else.
        send(client.ws, lobbyFor(player.accountId));
        return;
      case "leave-game": {
        const gameId = lobby.gameIdOf(player.accountId);
        refusal = lobby.leave(player.accountId);
        if (gameId !== undefined) {
          games.leave(gameId, player.accountId);
          // The last player left a started game: nobody is left to play it,
          // or (after a win or loss) to look at the result. Remove it.
          if (lobby.playersOf(gameId).length === 0) games.remove(gameId);
        }
        break;
      }
      case "choose-dungeon":
        refusal = lobby.chooseDungeon(player.accountId, { dungeonId: message.dungeonId, difficulty: message.difficulty });
        break;
      case "start-game":
        refusal = startGame(player.accountId);
        break;
      case "set-plan":
      case "clear-plan": {
        // Only for the player's own game, and the game manager checks that
        // the character is theirs: the session decides, not the client.
        const gameId = lobby.gameIdOf(player.accountId);
        const plan = message.type === "set-plan" ? message.plan : null;
        const problem =
          gameId === undefined
            ? "You are not in a running game."
            : games.setPlan(gameId, player.accountId, message.characterId, plan);
        if (problem !== undefined) send(client.ws, { type: "refused", reason: problem });
        else sendToGame(gameId!, { type: "plan", gameId: gameId!, characterId: message.characterId, plan });
        return;
      }
      case "get-game": {
        // Only the player's own game: the session decides, not the client.
        const gameId = lobby.gameIdOf(player.accountId);
        const game = gameId === undefined ? undefined : games.snapshot(gameId, player.accountId);
        if (game) send(client.ws, game);
        else send(client.ws, { type: "refused", reason: "You are not in a running game." });
        // Nothing in the lobby changed, so no lobby update.
        return;
      }
    }
    if (refusal !== undefined) send(client.ws, { type: "refused", reason: refusal });
    else broadcastLobby();
  }

  /** Starts the player's game: the lobby marks it started, the game manager runs it. */
  function startGame(accountId: number): Refusal {
    const gameId = lobby.gameIdOf(accountId);
    const dungeon = gameId === undefined ? undefined : lobby.dungeonOfGame(gameId);
    const difficulty = gameId === undefined ? undefined : lobby.difficultyOfGame(gameId);
    const turnDuration = gameId === undefined ? undefined : lobby.turnDurationOfGame(gameId);
    // Each player brings the characters they chose in the lobby (design.md,
    // Characters). They are read from the database again now: the lobby only
    // keeps their numbers and names.
    const characters: GameCharacter[] = [];
    for (const player of gameId === undefined ? [] : lobby.playersOf(gameId)) {
      const own = charactersOfAccount(options.db, player.accountId);
      const wonDungeonBefore = hasWon(options.db, player.accountId, dungeon!.id, difficulty!);
      for (const { number } of player.characters) {
        const character = own.find((c) => c.number === number);
        // Can't happen today: characters can't be used up while the account
        // is in a game. Refusing is still better than starting without it.
        if (!character) return `A character of ${player.displayName} is no longer there.`;
        // The stats as they are now: they can't change during the game,
        // because upgrading is refused while the account is in one.
        characters.push({
          recordId: character.id,
          accountId: player.accountId,
          displayName: player.displayName,
          characterName: describeCharacter(character).name,
          stats: statsWithUpgrades(character.data.upgrades),
          // Never below 0: a character can have more XP than its max level
          // needs, from before the XP curve was changed (issue #93).
          maxXpGain: Math.max(0, maxXp(character.data.rank) - character.data.xp),
          earlierKills: killsIn(character.data.kills, dungeon!.id, difficulty!),
          wonDungeonBefore,
        });
      }
    }

    const refusal = lobby.start(accountId);
    if (refusal !== undefined) return refusal;
    games.start(gameId!, characters, dungeon!, turnDuration!, difficulty!);
    // Each player gets their own snapshot: it says which characters are theirs.
    for (const client of connections.all()) {
      if (lobby.gameIdOf(client.account.id) === gameId) send(client.ws, games.snapshot(gameId!, client.account.id)!);
    }
    return undefined;
  }

  // Heartbeat: a phone that loses its network often doesn't close the
  // connection properly; it just goes quiet. Every 30 seconds the server
  // sends a WebSocket ping, which browsers answer automatically with a pong.
  // A connection that didn't answer the previous ping is closed.
  const heartbeat = setInterval(() => {
    for (const { ws } of connections.all()) {
      if (!answeredPing.has(ws)) {
        ws.terminate();
        continue;
      }
      answeredPing.delete(ws);
      ws.ping();
    }
  }, HEARTBEAT_MS);
  heartbeat.unref();
  httpServer.on("close", () => clearInterval(heartbeat));

  return () => {
    stopped = true;
    stopTurnTimer();
    clearInterval(heartbeat);
    games.saveClock();
  };
}

/** A character as the lobby shows it: its number and the name it goes by. */
function describeCharacter(character: Character): LobbyCharacter {
  return { number: character.number, name: nameOfCharacter({ ...character.data, number: character.number }) };
}

/** Answers the upgrade request with an HTTP error and closes the connection. */
function refuse(socket: Duplex, status: number, text: string): void {
  socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

function send(ws: WebSocket, message: ServerMessage): void {
  ws.send(JSON.stringify(message));
}
