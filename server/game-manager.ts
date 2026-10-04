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
//
// ## Character numbers
//
// Inside a game, characters are known only by their number within that game:
// 1, 2, 3, ... (like the monsters). The rules, the events and every message
// use these numbers; database ids and account ids never leave the server
// (architecture.md, Characters). The game manager keeps the link from each
// number to its character record and account, for the server's own use.
//
// ## Plans
//
// Between turns, players plan what their characters do next (design.md,
// Planning). The game manager keeps the current plan of each character and
// hands them to the rules when a turn fires. It only checks *who* sets a
// plan: a player may plan only for their own characters, and only while the
// character is still in the game. That check uses the account of the
// connection's session, never anything the client says about itself.
// Whether the plan can be carried out is the rules' job when the turn fires:
// by then the situation may have changed anyway.

import { FIRST_DUNGEON_MAP } from "../shared/rules/dungeon-map.ts";
import type { CharacterId, GameState, MonsterId } from "../shared/rules/game-state.ts";
import { createTrack } from "../shared/rules/track.ts";
import type { Stats } from "../shared/rules/stats.ts";
import { gameResult, newGameState, resolveTurn, type Plan } from "../shared/rules/turn.ts";
import type { GameMessage, TurnMessage } from "../shared/protocol.ts";

/** A player's character as it enters a game. */
export interface GameCharacter {
  /** The id of the character's database record. */
  recordId: number;
  accountId: number;
  displayName: string;
  stats: Stats;
}

/** Who a character number in a game stands for. Never sent to clients. */
interface Member {
  recordId: number;
  accountId: number;
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
  members: Map<CharacterId, Member>;
  /** The current plan of each character that has one. */
  plans: Map<CharacterId, Plan>;
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
   * as possible. The characters are numbered 1, 2, 3, ... in that shuffled
   * order, so the numbers say nothing about who joined first.
   */
  start(gameId: string, characters: readonly GameCharacter[]): void {
    if (this.games.has(gameId)) throw new Error(`Game ${gameId} is already running.`);
    if (characters.length === 0) throw new Error("A game needs at least one character.");

    const shuffled = shuffle(characters, this.random);
    const order = shuffled.map((_, i) => i + 1);
    const monsterIds = FIRST_DUNGEON_MAP.monsters.map((_, id) => id);
    const track = createTrack(order, dealMonsters(monsterIds, order, this.random));
    const state = newGameState(
      FIRST_DUNGEON_MAP,
      shuffled.map((c, i) => ({ id: order[i]!, stats: c.stats })),
      track,
    );

    const turnTimes = new Map(order.map((id, i) => [id, this.cycleMs + (i * this.cycleMs) / order.length]));
    this.games.set(gameId, {
      id: gameId,
      state,
      gameTime: 0,
      turnTimes,
      sequence: 0,
      members: new Map(
        shuffled.map((c, i) => [order[i]!, { recordId: c.recordId, accountId: c.accountId, displayName: c.displayName }]),
      ),
      plans: new Map(),
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

  /**
   * Sets (or, with `null`, clears) the plan of a character. Returns why it
   * was refused, or `undefined` when it was accepted.
   */
  setPlan(gameId: string, accountId: number, characterId: CharacterId, plan: Plan | null): string | undefined {
    const game = this.games.get(gameId);
    if (!game) return "You are not in a running game.";
    if (gameResult(game.state) !== null) return "The game is over.";
    // The same answer whether the character is someone else's or doesn't
    // exist at all: there is nothing to learn by trying numbers.
    if (game.members.get(characterId)?.accountId !== accountId) return "That is not your character.";
    if (!game.state.track.some((s) => s.characterId === characterId)) return "That character is dead.";

    if (plan === null) game.plans.delete(characterId);
    else game.plans.set(characterId, plan);
    return undefined;
  }

  /**
   * The whole game as it is now, as the given account sees it: the same for
   * everyone, except that each player is told which characters are theirs.
   */
  snapshot(gameId: string, accountId: number): GameMessage | undefined {
    const game = this.games.get(gameId);
    if (!game) return undefined;
    return {
      type: "game",
      gameId,
      sequence: game.sequence,
      state: game.state,
      players: [...game.members].map(([characterId, m]) => ({ characterId, displayName: m.displayName })),
      yourCharacters: [...game.members].filter(([, m]) => m.accountId === accountId).map(([id]) => id),
      nextTurns: nextTurns(game),
      plans: [...game.plans].map(([characterId, plan]) => ({ characterId, plan })),
      result: gameResult(game.state),
    };
  }

  private resolve(game: RunningGame, characterId: CharacterId): void {
    const { newState, events } = resolveTurn(game.state, characterId, game.plans);
    game.state = newState;
    // The plan of the character that acted is used up, whether it was
    // carried out or cancelled. Characters that died lose theirs too. The
    // client does the same when the turn arrives (client/game.ts), so no
    // separate "plan cleared" messages are needed.
    game.plans.delete(characterId);
    for (const id of game.plans.keys()) {
      if (!newState.track.some((s) => s.characterId === id)) game.plans.delete(id);
    }
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
