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
import { abilitiesOf } from "../shared/rules/abilities.ts";
import { levelFromXp, maxLevel, maxXp } from "../shared/rules/advancement.ts";
import { dungeonXpPercent, killsIn } from "../shared/rules/diminishing-returns.ts";
import { DUNGEONS } from "../shared/rules/dungeon-map.ts";
import { restFromNow, restState } from "../shared/rules/rest.ts";
import { abilityUpgradeCounts, statsWithUpgrades, type BoughtUpgrade } from "../shared/rules/upgrades.ts";
import { clearFirstGamePending, findAccount, firstGamePending, type Account } from "./accounts.ts";
import { charactersOfAccount, type Character } from "./characters.ts";
import { readCookie, SESSION_COOKIE } from "./cookies.ts";
import type { Db } from "./database.ts";
import { dungeonWinsOf, hasWon } from "./dungeons-won.ts";
import { GameManager, type GameCharacter, type InGameProgress } from "./game-manager.ts";
import { SqliteGameStore } from "./game-store.ts";
import type { Lobby, Refusal } from "./lobby.ts";
import { logError } from "./log.ts";
import { isAllowedOrigin } from "./origin.ts";
import { RateLimiter } from "./rate-limit.ts";
import { useSession } from "./sessions.ts";
import { startTurnTimer } from "./turn-timer.ts";
import { settleJobs } from "./village.ts";

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

/** What attachWebSocket gives the rest of the server. */
export interface WebSocketEndpoint {
  /**
   * For a normal shutdown: stops the timers and saves the server time, so
   * the downtime that follows doesn't count as game time.
   */
  stopGames: () => void;
  /** What the character page needs to know about games and parties. */
  characterGames: CharacterGames;
}

/**
 * The character page and the games (issue #153). The page is HTTP (api.ts),
 * the lobby and the games live here, so this is how they meet.
 */
export interface CharacterGames {
  /** Which of the account's characters are in a game, open or running (see `inGameCheck` below). */
  inGameCheck: (accountId: number) => (character: Character) => boolean;
  /** Where a character record is in a game that hasn't ended, with what it got there so far. */
  progressInGame: (recordId: number) => InGameProgress | undefined;
  /**
   * Adds an upgrade to a running game and tells its players. Returns why
   * it was refused, or `undefined`.
   */
  upgradeInGame: (progress: InGameProgress, upgrade: BoughtUpgrade) => string | undefined;
  /**
   * The account's characters changed on the character page: brings its open
   * party's choice up to date and sends everyone the new lobby.
   */
  charactersChanged: (accountId: number) => void;
}

/** Sets up the WebSocket endpoint, the lobby and the running games. */
export function attachWebSocket(
  httpServer: Server,
  connections: Connections,
  lobby: Lobby,
  options: WebSocketOptions,
): WebSocketEndpoint {
  // noServer: we decide ourselves which upgrade requests become our
  // WebSockets. Others are left alone (in development Vite uses one too).
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  const games = new GameManager({
    cycleMs: options.turnCycleMs,
    onTurn: (message) => {
      sendToGame(message.gameId, message);
      // The characters are out of the game and resting now. Everyone gets a
      // new lobby, also players who left the game before it ended: their
      // characters were still in it until now.
      if (message.events.some((e) => e.type === "gameEnded")) broadcastLobby();
    },
    // A game is empty when none of its players has a connection open. A
    // player who went back to the lobby isn't in it any more (`gameIdOf`).
    hasPlayersConnected: (gameId) => [...connections.all()].some((c) => lobby.gameIdOf(c.account.id) === gameId),
    // Nobody is connected to tell; they see the loss when they come back.
    // The lobby changes for everyone, as when a game ends with a turn.
    onAbandoned: () => broadcastLobby(),
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

  /**
   * Which of the account's characters are in a game (design.md, Character
   * filters): chosen in its open party, or in a game that hasn't ended yet,
   * also one the player has left. Made once per account and list of
   * characters, so it doesn't go through every game for every character.
   */
  function inGameCheck(accountId: number): (character: Character) => boolean {
    const inParty = new Set(lobby.charactersInParty(accountId));
    const inPlay = games.recordsInPlay(accountId);
    return (character) => inParty.has(character.number) || inPlay.has(character.id);
  }

  /** The lobby as one player sees it, with the dungeons they have won and their characters. */
  function lobbyFor(accountId: number): ServerMessage {
    const snapshot = lobby.snapshotFor(accountId);
    const inGame = inGameCheck(accountId);
    // Training that has ended gives its XP first (design.md, The training house).
    settleJobs(options.db, accountId, Date.now());
    const myGame = snapshot.myGame && !snapshot.myGame.started ? withXpShown(snapshot.myGame) : snapshot.myGame;
    return {
      ...snapshot,
      myGame,
      dungeonWins: dungeonWinsOf(options.db, accountId),
      yourCharacters: charactersOfAccount(options.db, accountId).map((c) => ({
        ...describeCharacter(c),
        class: c.data.class,
        rank: c.data.rank,
        level: levelFromXp(c.data.xp, c.data.class, c.data.rank),
        ...restFromNow(c.rest, Date.now()),
        workplace: c.workplace,
        inGame: inGame(c),
      })),
    };
  }

  /**
   * Adds to each chosen character of an open game its rank and level, and
   * the XP it would get from the chosen dungeon and difficulty (design.md,
   * Diminishing returns). It is worked out from the character records every
   * time the lobby is sent, so it follows every change of dungeon,
   * difficulty or characters. The lobby's players are in the same order as
   * in the snapshot.
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
            const { xp, class: classId, rank, kills } = character.data;
            const level = levelFromXp(xp, classId, rank);
            if (level >= maxLevel(classId, rank)) return { ...chosen, rank, level, xp: "maxLevel" as const };
            const earlierKills = killsIn(kills, game.dungeonId, game.difficulty);
            return { ...chosen, rank, level, xp: dungeonXpPercent(map, game.difficulty, earlierKills) };
          }),
        };
      }),
    };
  }

  /**
   * Looks up the characters a player chose, by their numbers within the
   * player's own account. A number the account doesn't have is refused:
   * the session decides whose characters these are, never the client.
   * So is a character that is still resting (design.md, Resting), or still
   * in a game that hasn't ended, also one the player has left (issue #195):
   * the client greys those out, but only this check counts. A character in
   * the player's own open party isn't in a game for this: choosing it again
   * keeps it in the choice.
   * Returns the characters, or the reason they were refused.
   */
  function ownCharacters(accountId: number, numbers: readonly number[]): LobbyCharacter[] | string {
    const own = charactersOfAccount(options.db, accountId);
    // A player in a running game can't choose at all, and the lobby says
    // so: "the game has already started" is the better answer then.
    const gameId = lobby.gameIdOf(accountId);
    const inPlay = gameId !== undefined && games.isRunning(gameId) ? new Set() : games.recordsInPlay(accountId);
    const chosen: LobbyCharacter[] = [];
    for (const number of numbers) {
      const character = own.find((c) => c.number === number);
      // The same answer whether the number is someone else's or nobody's.
      if (!character) return "That is not your character.";
      const described = describeCharacter(character);
      if (inPlay.has(character.id)) return `${described.name} is still in a game and can't go into another one until it ends.`;
      const state = restState(character.rest, Date.now());
      if (state !== "ready") return `${described.name} is still ${state} and can't go into a dungeon yet.`;
      chosen.push(described);
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
    // A new account goes straight into its first dungeon, before it sees
    // anything else (design.md, The first game). Before this connection is
    // added, so the game's snapshot comes once, with the rest below.
    startFirstGame(account);

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
        else if (message.type === "create-game") {
          refusal = lobby.create(player, characters, message.turnDuration, message.password);
        } else if (message.type === "join-game") {
          refusal = lobby.join(player, message.gameId, characters, message.password);
        }
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
      case "set-turn-order":
        refusal = lobby.setTurnOrder(player.accountId, message.order);
        break;
      case "kick-player": {
        const gameId = lobby.gameIdOf(player.accountId);
        const kicked = gameId === undefined ? undefined : lobby.playersOf(gameId)[message.player];
        refusal = lobby.kick(player.accountId, message.player, message.displayName);
        if (refusal !== undefined) break;
        // The removed player first gets the lobby without their game, then
        // the reason, so the client can show it on "Find a game".
        broadcastLobby();
        for (const other of connections.all()) {
          if (other.account.id === kicked!.accountId) send(other.ws, { type: "kicked", by: player.displayName });
        }
        return;
      }
      case "start-game":
        refusal = startGame(player.accountId);
        break;
      case "unpause-game": {
        // Only the player's own game: the session decides, not the client.
        const gameId = lobby.gameIdOf(player.accountId);
        const problem = gameId === undefined ? "You are not in a running game." : games.unpause(gameId, player.accountId);
        if (problem !== undefined) {
          send(client.ws, { type: "refused", reason: problem });
          return;
        }
        // Everyone in it gets a new snapshot, with the clock running.
        for (const other of connections.all()) {
          if (lobby.gameIdOf(other.account.id) === gameId) send(other.ws, games.snapshot(gameId!, other.account.id)!);
        }
        return;
      }
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

  /**
   * The automatic first game of a new account (design.md, The first game;
   * issue #190): on its first connection, a solo game in the first dungeon
   * on Normal with its first character, paused until the player presses
   * Start. It happens once: the account's flag is cleared whether it works
   * or not, so a problem can't start a game on every connect. Synchronous,
   * like everything in the lobby, so a second tab connecting at the same
   * moment can't start a second game.
   */
  function startFirstGame(account: Account): void {
    if (!firstGamePending(options.db, account.id)) return;
    clearFirstGamePending(options.db, account.id);
    if (lobby.gameIdOf(account.id) !== undefined) return;
    const first = charactersOfAccount(options.db, account.id)[0];
    if (!first) return;
    const player = { accountId: account.id, displayName: account.displayName };
    const refusal = lobby.create(player, [describeCharacter(first)]) ?? startGame(account.id, true);
    if (refusal !== undefined) {
      logError(`The first game of account ${account.id} could not start: ${refusal}`);
      // Back to "Find a game": a party left open would only confuse a new player.
      if (lobby.gameIdOf(account.id) !== undefined) lobby.leave(account.id);
    }
  }

  /**
   * Starts the player's game: the lobby marks it started, the game manager
   * runs it. `paused`: it waits for its player to press Start (see
   * `startFirstGame`).
   */
  function startGame(accountId: number, paused = false): Refusal {
    const gameId = lobby.gameIdOf(accountId);
    const dungeon = gameId === undefined ? undefined : lobby.dungeonOfGame(gameId);
    const difficulty = gameId === undefined ? undefined : lobby.difficultyOfGame(gameId);
    const turnDuration = gameId === undefined ? undefined : lobby.turnDurationOfGame(gameId);
    // Each player brings the characters they chose in the lobby (design.md,
    // Characters), in the turn order the host set (design.md, Setting up the
    // track). They are read from the database again now: the lobby only
    // keeps their numbers and names.
    const players = gameId === undefined ? [] : lobby.playersOf(gameId);
    const characters: GameCharacter[] = [];
    for (const { accountId: ownerId, number } of gameId === undefined ? [] : lobby.turnOrderOf(gameId)) {
      const player = players.find((p) => p.accountId === ownerId)!;
      // With the XP of training that has ended (design.md, The training house).
      settleJobs(options.db, ownerId, Date.now());
      const character = charactersOfAccount(options.db, ownerId).find((c) => c.number === number);
      // Can't happen today: a rank-up in an open party takes the characters
      // it uses up out of the choice (`charactersChanged`). Refusing is
      // still better than starting without it.
      if (!character) return `A character of ${player.displayName} is no longer there.`;
      // The stats as they are now. Upgrades bought during the game go to
      // the game, not to the record, until it ends (see game-manager.ts,
      // Upgrades).
      characters.push({
        recordId: character.id,
        accountId: ownerId,
        displayName: player.displayName,
        characterName: describeCharacter(character).name,
        class: character.data.class,
        rank: character.data.rank,
        stats: statsWithUpgrades(character.data.class, character.data.upgrades),
        // Never below 0: a character can have more XP than its max level
        // needs, from before the XP curve was changed (issue #93).
        maxXpGain: Math.max(0, maxXp(character.data.class, character.data.rank) - character.data.xp),
        earlierKills: killsIn(character.data.kills, dungeon!.id, difficulty!),
        abilities: abilitiesOf(character.data.class, character.data.rank),
        abilityUpgrades: abilityUpgradeCounts(character.data.upgrades),
        wonDungeonBefore: hasWon(options.db, ownerId, dungeon!.id, difficulty!),
      });
    }

    const refusal = lobby.start(accountId);
    if (refusal !== undefined) return refusal;
    games.start(gameId!, characters, dungeon!, turnDuration!, difficulty!, paused);
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

  return {
    stopGames: () => {
      stopped = true;
      stopTurnTimer();
      clearInterval(heartbeat);
      games.saveClock();
    },
    characterGames: {
      inGameCheck,
      progressInGame: (recordId) => games.progressInGame(recordId),
      upgradeInGame: ({ gameId, characterId }, upgrade) => {
        const problem = games.upgrade(gameId, characterId, upgrade);
        if (problem !== undefined) return problem;
        // Only what was bought, not what it cost: that is the player's own business.
        const choice = "stat" in upgrade ? { stat: upgrade.stat } : { ability: upgrade.ability, upgrade: upgrade.upgrade };
        sendToGame(gameId, { type: "upgraded", gameId, characterId, upgrade: choice });
        return undefined;
      },
      charactersChanged: (accountId) => {
        lobby.updateCharacters(accountId, charactersOfAccount(options.db, accountId).map(describeCharacter));
        broadcastLobby();
      },
    },
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
