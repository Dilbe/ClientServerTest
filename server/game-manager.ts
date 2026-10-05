// The game manager: the running games and their clocks (architecture.md,
// Server process and Turn timing). It sits between the pure rules layer
// (shared/rules) and the edges (websocket.ts): the rules decide what happens
// in a turn, the game manager decides *when* a turn happens and who hears
// about it.
//
// Every change to a game is saved in the event store (game-store.ts) before
// it is made in memory, and on startup `restore` rebuilds every game that was
// still going from its events. So a restart or a deploy doesn't end a game.
//
// A won or lost game stays here, its clock stopped, so players can still get
// its snapshot with the result. It is removed when its last player has gone
// back to the lobby (websocket.ts, "leave-game").
//
// ## Time
//
// The game manager keeps one **server time**: the milliseconds the server
// has been running, summed over all its runs. It only moves forward when
// `advance` is called, and that is the only place where turns fire. The game
// manager never looks at a clock itself; turn-timer.ts calls `advance` once a
// second with the real time that has passed. Tests don't have to wait: they
// call `advance(10_000)` to skip 10 seconds.
//
// Each game keeps its own **game time**: the milliseconds since it started,
// which is the server time minus the server time at its start. Turn times
// are stored in game time.
//
// The server time is saved every few seconds (the heartbeat), on shutdown,
// and together with every start and turn. After a restart it goes on from
// the saved value, so the time the server was down simply never happened:
// every game continues with the same time left until the next turn
// (architecture.md, Downtime pauses the game clock). After a crash, the
// time since the last save is lost, at most CLOCK_SAVE_MS. Saving the clock
// with each turn makes sure that it never goes back to before a turn that
// was already resolved.
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
// ## Rewards
//
// During the game, the XP each character gains is part of the game state
// (the rules' `xpGained` events); the character records aren't touched
// (architecture.md, Characters). The turn that ends the game is saved
// together with the rewards: the XP goes to the character records, won or
// lost, and on a win every player gets the dungeon's silver. Because that
// happens in one transaction with the turn, a crash can't lose the rewards
// or pay them twice: after a restart the game is rebuilt from its events,
// which never pays out again.
//
// ## Plans
//
// Between turns, players plan what their characters do next (design.md,
// Planning). The game manager keeps the current plan of each character and
// hands them to the rules when a turn fires. It only checks *who* sets a
// plan and *how long* it is: a player may plan only for their own
// characters, only while the character is still in the game, and no more
// actions than the character's actions stat. The first check uses the
// account of the connection's session, never anything the client says about
// itself. Whether each action can be carried out is the rules' job when the
// turn fires: by then the situation may have changed anyway.

import { FIRST_DUNGEON } from "../shared/rules/dungeon-map.ts";
import type { CharacterId, GameState, MonsterId } from "../shared/rules/game-state.ts";
import { createTrack } from "../shared/rules/track.ts";
import type { Stats } from "../shared/rules/stats.ts";
import { gameResult, newGameState, resolveTurn, type Plan } from "../shared/rules/turn.ts";
import { applyEvents } from "../shared/rules/events.ts";
import type { GameMessage, TurnMessage } from "../shared/protocol.ts";
import {
  NO_STORE,
  type GameStarted,
  type GameStore,
  type Rewards,
  type StoredEvent,
  type StoredGame,
} from "./game-store.ts";

/** How often the server time is saved, in server time (the heartbeat). */
export const CLOCK_SAVE_MS = 5000;

/** A player's character as it enters a game. */
export interface GameCharacter {
  /** The id of the character's database record. */
  recordId: number;
  accountId: number;
  displayName: string;
  /** The name the character goes by (see nameOfCharacter in shared/characters.ts). */
  characterName: string;
  stats: Stats;
  /** The most XP it can gain in the game: what its max level needs, minus the XP it has. */
  maxXpGain: number;
}

/** Who a character number in a game stands for. Never sent to clients. */
interface Member {
  recordId: number;
  accountId: number;
  displayName: string;
  characterName: string;
  /** Gone back to the lobby. The character stays in the game. */
  left: boolean;
}

interface RunningGame {
  id: string;
  state: GameState;
  /** The server time when the game started: its game time 0. */
  startedAt: number;
  /** The next turn of each character on the track, in game time. */
  turnTimes: Map<CharacterId, number>;
  /** The number of the last resolved turn: 0 before the first one. */
  sequence: number;
  members: Map<CharacterId, Member>;
  /** The current plan of each character that has one. */
  plans: Map<CharacterId, Plan>;
  /** What every player gets when the game is won. */
  silverReward: number;
}

export interface GameManagerOptions {
  cycleMs: number;
  /** Called after each resolved turn, to send it to the game's players. */
  onTurn: (message: TurnMessage) => void;
  /** Returns a number in [0, 1), like `Math.random`. Tests pass their own. */
  random?: () => number;
  /** Where games are saved. Without one, games live only in memory. */
  store?: GameStore;
}

/** A started game that `restore` brought back, for the lobby. */
export interface RestoredGame {
  gameId: string;
  /** The players who haven't gone back to the lobby yet. */
  players: { accountId: number; displayName: string }[];
}

export class GameManager {
  private readonly games = new Map<string, RunningGame>();
  private readonly cycleMs: number;
  private readonly onTurn: (message: TurnMessage) => void;
  private readonly random: () => number;
  private readonly store: GameStore;
  /** See Time above. */
  private clock = 0;
  private clockSavedAt = 0;

  constructor(options: GameManagerOptions) {
    this.cycleMs = options.cycleMs;
    this.onTurn = options.onTurn;
    this.random = options.random ?? Math.random;
    this.store = options.store ?? NO_STORE;
  }

  /**
   * Loads the saved server time and rebuilds every game that was still
   * going from its stored events. Called once on startup, before the turn
   * timer starts. Returns the games, so the lobby can put their players back.
   */
  restore(): RestoredGame[] {
    const { clock, games } = this.store.load();
    this.clock = clock;
    this.clockSavedAt = clock;
    const restored: RestoredGame[] = [];
    for (const stored of games) {
      try {
        const game = rebuild(stored);
        const players = [...game.members.values()].filter((m) => !m.left);
        if (players.length === 0) {
          // Everybody had gone back to the lobby, or their accounts have
          // been deleted since: nobody is left to play or watch it.
          this.store.append(game.id, { type: "gameClosed", reason: closeReason(game) });
          continue;
        }
        this.games.set(game.id, game);
        restored.push({
          gameId: game.id,
          players: players.map((m) => ({ accountId: m.accountId, displayName: m.displayName })),
        });
      } catch (error) {
        // Events that pass their checks but don't fit together (a bug, or a
        // row changed by hand). As in game-store.ts: close it, don't crash.
        console.error(`Game ${stored.id} could not be restored and was closed:`, error);
        this.store.append(stored.id, { type: "gameClosed", reason: "failed" });
      }
    }
    return restored;
  }

  /** Saves the server time now: on shutdown, so no time is lost. */
  saveClock(): void {
    this.store.saveClock(this.clock);
    this.clockSavedAt = this.clock;
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
    const monsterIds = FIRST_DUNGEON.map.monsters.map((_, id) => id);
    const track = createTrack(order, dealMonsters(monsterIds, order, this.random));
    const state = newGameState(
      FIRST_DUNGEON.map,
      shuffled.map((c, i) => ({ id: order[i]!, stats: c.stats, maxXpGain: c.maxXpGain })),
      track,
    );

    const started: GameStarted = {
      type: "gameStarted",
      state,
      turnTimes: order.map((characterId, i) => ({ characterId, at: this.cycleMs + (i * this.cycleMs) / order.length })),
      startedAt: this.clock,
      silverReward: FIRST_DUNGEON.silverReward,
    };
    const members = shuffled.map((c, i) => ({ characterId: order[i]!, accountId: c.accountId, recordId: c.recordId }));
    // Saved first: if that fails, the game doesn't start at all.
    this.store.saveStart(gameId, members, started, this.clock);
    this.games.set(
      gameId,
      startGame(
        gameId,
        started,
        shuffled.map((c, i) => ({
          ...members[i]!,
          displayName: c.displayName,
          characterName: c.characterName,
          left: false,
        })),
      ),
    );
  }

  /**
   * Notes that a player has gone back to the lobby. Their characters stay in
   * the game; after a restart the player isn't put back in it.
   */
  leave(gameId: string, accountId: number): void {
    const game = this.games.get(gameId);
    if (!game) return;
    this.store.markLeft(gameId, accountId);
    for (const member of game.members.values()) if (member.accountId === accountId) member.left = true;
  }

  /** Stops and forgets a game. It stays in the database, closed. */
  remove(gameId: string): void {
    const game = this.games.get(gameId);
    if (!game) return;
    this.store.append(gameId, { type: "gameClosed", reason: closeReason(game) });
    this.games.delete(gameId);
  }

  isRunning(gameId: string): boolean {
    return this.games.has(gameId);
  }

  /**
   * Moves the server time forward by `elapsedMs` and resolves every
   * turn that has become due, in the order they were due.
   *
   * This is synchronous on purpose: there is no `await` anywhere in here.
   * Node runs all JavaScript on one thread, and other work (an incoming
   * WebSocket message, the next timer tick) can only run when this function
   * has returned. So nothing can slip in between finding that a turn is due,
   * resolving it and storing the new state (architecture.md, Server process).
   */
  advance(elapsedMs: number): void {
    this.clock += elapsedMs;
    if (this.clock - this.clockSavedAt >= CLOCK_SAVE_MS) this.saveClock();
    for (const game of this.games.values()) {
      if (gameResult(game.state) !== null) continue; // Over: its clock stops.
      try {
        // A loop, not a single check: after a long pause (a slow tick, a
        // debugger) several turns may be due at once. They fire in order.
        const gameTime = this.clock - game.startedAt;
        for (let due = nextDue(game, gameTime); due !== undefined; due = nextDue(game, gameTime)) {
          this.resolve(game, due);
        }
      } catch (error) {
        // A bug in the rules shouldn't stop every other game: an exception
        // thrown from a timer callback ends the whole Node process, like an
        // unhandled exception on a .NET background thread. The broken game
        // is dropped; it would only fail again on the next tick.
        console.error(`Game ${game.id} failed and was stopped:`, error);
        this.games.delete(game.id);
        try {
          this.store.append(game.id, { type: "gameClosed", reason: "failed" });
        } catch (storeError) {
          // The database itself may be what failed. The game then comes
          // back after a restart, which is the best we can do.
          console.error(`Game ${game.id} could not be closed:`, storeError);
        }
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
    // A modified client could send more actions than the character has. The
    // rules would ignore the extra ones, but they would still be stored and
    // shown to everyone.
    const actions = game.state.characters.find((c) => c.id === characterId)!.stats.actions;
    if (plan !== null && plan.length > actions) return `That character has only ${actions} action(s) per turn.`;

    const event = { type: "planChanged", characterId, plan } as const;
    this.store.append(gameId, event);
    applyStored(game, event);
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
      players: [...game.members].map(([characterId, m]) => ({
        characterId,
        displayName: m.displayName,
        characterName: m.characterName,
      })),
      yourCharacters: [...game.members].filter(([, m]) => m.accountId === accountId).map(([id]) => id),
      nextTurns: nextTurns(game, this.clock - game.startedAt),
      plans: [...game.plans].map(([characterId, plan]) => ({ characterId, plan })),
      result: gameResult(game.state),
      silverReward: game.silverReward,
    };
  }

  /**
   * Resolves one turn, following architecture.md, Saving a turn: the rules
   * work out what happens, the events are saved, and only then is the state
   * in memory changed and are the players told. If saving throws, nothing
   * has changed: the turn didn't happen.
   */
  private resolve(game: RunningGame, characterId: CharacterId): void {
    // Only the events change the game: `applyStored` builds the new state
    // from them, exactly as `restore` does after a restart. One way of
    // changing the state means the game in memory and the game rebuilt from
    // the database can't drift apart. (resolveTurn's own new state is the
    // same, since it is built with the same `applyEvent`; it is only read
    // here to work out the rewards before saving.)
    const { newState, events } = resolveTurn(game.state, characterId, game.plans);
    const nextTurnAt = game.turnTimes.get(characterId)! + this.cycleMs;
    const event = { type: "turnResolved", characterId, events, nextTurnAt } as const;
    const ended = events.find((e) => e.type === "gameEnded");
    this.store.append(game.id, event, this.clock, ended && rewards(game, newState, ended.result));
    applyStored(game, event);
    this.onTurn({
      type: "turn",
      gameId: game.id,
      sequence: game.sequence,
      characterId,
      events,
      nextTurns: nextTurns(game, this.clock - game.startedAt),
    });
  }
}

/**
 * What a game that just ended pays out (design.md, Rewards). The XP each
 * character gained is kept, won or lost; it is already limited to what its
 * max level needs. Silver only comes with a win: once per player, however
 * many characters they brought, also for players who left the game early.
 */
function rewards(game: RunningGame, state: GameState, result: "won" | "lost"): Rewards {
  const xp = state.characters
    .filter((c) => c.xpGained > 0)
    .map((c) => ({ recordId: game.members.get(c.id)!.recordId, xp: c.xpGained }));
  const accounts = new Set([...game.members.values()].map((m) => m.accountId));
  const silver = result === "won" ? [...accounts].map((accountId) => ({ accountId, silver: game.silverReward })) : [];
  return { xp, silver };
}

/** A game as it is right after its `gameStarted` event. */
function startGame(
  id: string,
  started: GameStarted,
  members: readonly (Member & { characterId: CharacterId })[],
): RunningGame {
  return {
    id,
    state: started.state,
    startedAt: started.startedAt,
    turnTimes: new Map(started.turnTimes.map((t) => [t.characterId, t.at])),
    sequence: 0,
    members: new Map(members.map(({ characterId, ...member }) => [characterId, member])),
    plans: new Map(),
    silverReward: started.silverReward,
  };
}

/** Rebuilds a stored game by applying its events in order, without running any rules. */
function rebuild(stored: StoredGame): RunningGame {
  const [first, ...rest] = stored.events;
  if (first?.type !== "gameStarted") throw new Error("The first event isn't gameStarted.");
  const game = startGame(stored.id, first, stored.members);
  for (const event of rest) applyStored(game, event);
  return game;
}

/**
 * Changes a game in memory by one stored event. Used both while the game
 * runs (right after the event is saved) and when it is rebuilt on startup.
 */
function applyStored(game: RunningGame, event: StoredEvent): void {
  switch (event.type) {
    case "gameStarted":
      throw new Error("A game can only start once.");
    case "planChanged":
      if (event.plan === null) game.plans.delete(event.characterId);
      else game.plans.set(event.characterId, event.plan);
      return;
    case "turnResolved": {
      const state = applyEvents(game.state, event.events);
      game.state = state;
      // The plan of the character that acted is used up, whether it was
      // carried out or cancelled. Characters that died lose theirs too. The
      // client does the same when the turn arrives (client/game.ts), so no
      // separate "plan cleared" messages are needed.
      game.plans.delete(event.characterId);
      for (const id of game.plans.keys()) {
        if (!state.track.some((s) => s.characterId === id)) game.plans.delete(id);
      }
      game.sequence++;
      game.turnTimes.set(event.characterId, event.nextTurnAt);
      return;
    }
    case "gameClosed":
      // `load` never returns closed games, so this can't come up.
      throw new Error("The game is closed.");
  }
}

function closeReason(game: RunningGame): "finished" | "abandoned" {
  return gameResult(game.state) !== null ? "finished" : "abandoned";
}

/** The character whose turn is due now (the earliest if several are), if any. */
function nextDue(game: RunningGame, gameTime: number): CharacterId | undefined {
  if (gameResult(game.state) !== null) return undefined;
  const first = upcoming(game)[0];
  return first !== undefined && first.at <= gameTime ? first.characterId : undefined;
}

/** The characters still on the track with their next turn time, soonest first. */
function upcoming(game: RunningGame): { characterId: CharacterId; at: number }[] {
  return game.state.track
    .map((slot) => ({ characterId: slot.characterId, at: game.turnTimes.get(slot.characterId)! }))
    .sort((a, b) => a.at - b.at);
}

function nextTurns(game: RunningGame, gameTime: number): GameMessage["nextTurns"] {
  if (gameResult(game.state) !== null) return [];
  return upcoming(game).map(({ characterId, at }) => ({
    characterId,
    inSeconds: Math.max(0, at - gameTime) / 1000,
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
