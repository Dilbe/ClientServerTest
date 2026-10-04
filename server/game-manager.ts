// The game manager: the running games and their clocks (architecture.md,
// Server process and Turn timing). It sits between the pure rules layer
// (shared/rules) and the edges (websocket.ts): the rules decide what happens
// in a turn, the game manager decides *when* a turn happens and who hears
// about it.
//
// For now games live only in memory: a server restart loses them. Saving
// them in the event store comes with issue #23.
//
// ## Time
//
// Each game keeps its own **game time**: the milliseconds that have passed in
// that game since it started. Game time only moves forward when `advance` is
// called, and that is the only place where turns fire. The game manager never
// looks at a clock itself; turn-timer.ts calls `advance` once a second with
// the real time that has passed. That has two advantages:
//
// - Tests don't have to wait: they call `advance(10_000)` to skip 10 seconds.
// - Once games are stored (#23), downtime can pause a game simply by not
//   advancing it while the server is down.
//
// ## Turn times
//
// Every character on the track has its own next turn time, in game time.
// With a cycle of C and n characters, character i (0-based, in track order)
// first acts at C + i·C/n: one full cycle after the start, then spread evenly
// over the cycle. After each turn its time moves on by C. A dead character
// leaves the track, and with it its turn time, so its slot leaves a gap
// instead of making the others act more often (design.md, When a player dies).

import { FIRST_DUNGEON_MAP } from "../shared/rules/dungeon-map.ts";
import type { CharacterId, GameState, MonsterId } from "../shared/rules/game-state.ts";
import { createTrack } from "../shared/rules/track.ts";
import { gameResult, newGameState, resolveTurn, type NewCharacter } from "../shared/rules/turn.ts";
import type { GameMessage, TurnMessage } from "../shared/protocol.ts";

/** A player's character as it enters a game. */
export interface GameCharacter extends NewCharacter {
  displayName: string;
}

interface RunningGame {
  id: string;
  state: GameState;
  /** Milliseconds since the game started; only moves while the server runs. */
  gameTime: number;
  /** The next turn of each character on the track, in game time. */
  turnTimes: Map<CharacterId, number>;
  /** The number of the last resolved turn: 0 before the first one. */
  sequence: number;
  displayNames: Map<CharacterId, string>;
}

export interface GameManagerOptions {
  cycleMs: number;
  /** Called after each resolved turn, to send it to the game's players. */
  onTurn: (message: TurnMessage) => void;
  /** Returns a number in [0, 1), like `Math.random`. Tests pass their own. */
  random?: () => number;
}

export class GameManager {
  private readonly games = new Map<string, RunningGame>();
  private readonly cycleMs: number;
  private readonly onTurn: (message: TurnMessage) => void;
  private readonly random: () => number;

  constructor(options: GameManagerOptions) {
    this.cycleMs = options.cycleMs;
    this.onTurn = options.onTurn;
    this.random = options.random ?? Math.random;
  }

  /**
   * Starts a game in the first dungeon. Setting up the initiative track is
   * the only random step of the whole game (design.md, Setting up the track):
   * the players are shuffled, and the monsters are dealt over them as evenly
   * as possible.
   */
  start(gameId: string, characters: readonly GameCharacter[]): void {
    if (this.games.has(gameId)) throw new Error(`Game ${gameId} is already running.`);
    if (characters.length === 0) throw new Error("A game needs at least one character.");

    const order = shuffle(characters.map((c) => c.id), this.random);
    const monsterIds = FIRST_DUNGEON_MAP.monsters.map((_, id) => id);
    const track = createTrack(order, dealMonsters(monsterIds, order, this.random));
    // Only what the rules need goes into the state; the display names stay here.
    const state = newGameState(
      FIRST_DUNGEON_MAP,
      characters.map(({ id, accountId, stats }) => ({ id, accountId, stats })),
      track,
    );

    const turnTimes = new Map(order.map((id, i) => [id, this.cycleMs + (i * this.cycleMs) / order.length]));
    this.games.set(gameId, {
      id: gameId,
      state,
      gameTime: 0,
      turnTimes,
      sequence: 0,
      displayNames: new Map(characters.map((c) => [c.id, c.displayName])),
    });
  }

  /** Stops and forgets a game. */
  remove(gameId: string): void {
    this.games.delete(gameId);
  }

  isRunning(gameId: string): boolean {
    return this.games.has(gameId);
  }

  /**
   * Moves the clock of every game forward by `elapsedMs` and resolves every
   * turn that has become due, in the order they were due.
   *
   * This is synchronous on purpose: there is no `await` anywhere in here.
   * Node runs all JavaScript on one thread, and other work (an incoming
   * WebSocket message, the next timer tick) can only run when this function
   * has returned. So nothing can slip in between finding that a turn is due,
   * resolving it and storing the new state (architecture.md, Server process).
   */
  advance(elapsedMs: number): void {
    for (const game of this.games.values()) {
      if (gameResult(game.state) !== null) continue; // Over: its clock stops.
      game.gameTime += elapsedMs;
      try {
        // A loop, not a single check: after a long pause (a slow tick, a
        // debugger) several turns may be due at once. They fire in order.
        for (let due = nextDue(game); due !== undefined; due = nextDue(game)) {
          this.resolve(game, due);
        }
      } catch (error) {
        // A bug in the rules shouldn't stop every other game: an exception
        // thrown from a timer callback ends the whole Node process, like an
        // unhandled exception on a .NET background thread. The broken game
        // is dropped; it would only fail again on the next tick.
        console.error(`Game ${game.id} failed and was stopped:`, error);
        this.games.delete(game.id);
      }
    }
  }

  /** The whole game as it is now, for a player who (re)connects. */
  snapshot(gameId: string): GameMessage | undefined {
    const game = this.games.get(gameId);
    if (!game) return undefined;
    return {
      type: "game",
      gameId,
      sequence: game.sequence,
      state: game.state,
      players: [...game.displayNames].map(([characterId, displayName]) => ({ characterId, displayName })),
      nextTurns: nextTurns(game),
      result: gameResult(game.state),
    };
  }

  private resolve(game: RunningGame, characterId: CharacterId): void {
    // No plans yet (#21): every character is placed automatically on its
    // first turn and does nothing after that.
    const { newState, events } = resolveTurn(game.state, characterId, new Map());
    game.state = newState;
    game.sequence++;
    game.turnTimes.set(characterId, game.turnTimes.get(characterId)! + this.cycleMs);
    this.onTurn({
      type: "turn",
      gameId: game.id,
      sequence: game.sequence,
      characterId,
      events,
      nextTurns: nextTurns(game),
    });
  }
}

/** The character whose turn is due now (the earliest if several are), if any. */
function nextDue(game: RunningGame): CharacterId | undefined {
  if (gameResult(game.state) !== null) return undefined;
  const first = upcoming(game)[0];
  return first !== undefined && first.at <= game.gameTime ? first.characterId : undefined;
}

/** The characters still on the track with their next turn time, soonest first. */
function upcoming(game: RunningGame): { characterId: CharacterId; at: number }[] {
  return game.state.track
    .map((slot) => ({ characterId: slot.characterId, at: game.turnTimes.get(slot.characterId)! }))
    .sort((a, b) => a.at - b.at);
}

function nextTurns(game: RunningGame): GameMessage["nextTurns"] {
  if (gameResult(game.state) !== null) return [];
  return upcoming(game).map(({ characterId, at }) => ({
    characterId,
    inSeconds: Math.max(0, at - game.gameTime) / 1000,
  }));
}

/**
 * A random order of the items (the Fisher–Yates shuffle): every order is
 * equally likely. The usual shortcut `items.sort(() => random() - 0.5)` is
 * not: some orders come up much more often than others.
 */
export function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

/**
 * Spreads the monsters over the characters as evenly as possible, at random:
 * the monsters are shuffled and then dealt like cards, one each in a random
 * order of the characters. When they don't divide evenly, the characters at
 * the front of that order get one more.
 */
export function dealMonsters(
  monsterIds: readonly MonsterId[],
  characterIds: readonly CharacterId[],
  random: () => number,
): Map<MonsterId, CharacterId> {
  const monsters = shuffle(monsterIds, random);
  const characters = shuffle(characterIds, random);
  return new Map(monsters.map((monsterId, i) => [monsterId, characters[i % characters.length]!]));
}
