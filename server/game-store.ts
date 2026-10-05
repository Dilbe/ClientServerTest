// The event store: running games in the database, so they survive a restart
// or a deploy (architecture.md, Event store for running games).
//
// ## Event sourcing
//
// The usual way to store something is to keep its current state in a row
// and overwrite it on every change, like a `Games` table with an `UPDATE`
// after each turn. Event sourcing turns that around: we store *what
// happened*, one row per change, and never change or delete a row. The
// current state isn't stored at all: it is worked out by starting from
// nothing and applying every event in order, like a bank account whose
// balance is the sum of its transactions.
//
// For this game that means:
//
// - The game's history is the data. Every turn is kept, so a game can be
//   replayed, debugged or used for balancing later.
// - Writing is just appending a row, which can't leave half an update behind.
// - The events are *results* ("monster 2 moved to 1,3"), not inputs ("the
//   player planned a move"). Rebuilding a game only applies them
//   (`applyEvent`) and never runs the rules, so a rule change in a deploy
//   can't change what already happened in a running game.
//
// The game manager keeps the current state of each game in memory (the
// working copy) and only reads the events on startup.
//
// ## What is stored
//
// - `game_events`: per game, numbered 1, 2, 3, ...:
//   - `gameStarted`: the state at the start, with the initiative track as
//     it was set up (the result of the shuffle, not a random seed), and the
//     time of each character's first turn.
//   - `planChanged`: a player set or cleared a plan, so plans survive too.
//   - `turnResolved`: everything that happened in one turn, and when the
//     character that acted is due again. The turn that ends the game is
//     saved together with its rewards (see `append`).
//   - `gameClosed`: the game is over and its last player has left (or it
//     broke). Closed games aren't loaded again, but they are kept.
// - `game_members`: who each character number stands for (account and
//   character record), and whether they have gone back to the lobby. Kept
//   apart from the events so the events only hold game-local numbers.
// - `server_clock`: the server time (see game-manager.ts, Time).
//
// Everything here is synchronous (better-sqlite3), so saving a turn needs no
// `await` and can't be interrupted halfway (architecture.md, Saving a turn).

import { z } from "zod";
import { gameEvent, gameStateSchema, oneTimeReward, planSchema } from "../shared/protocol.ts";
import { DUNGEON_IDS, type DungeonId, type OneTimeReward } from "../shared/rules/dungeon-map.ts";
import { maxXp } from "../shared/rules/advancement.ts";
import { addSilver } from "./accounts.ts";
import { nameOfCharacter } from "../shared/characters.ts";
import { addXp, loadCharacterData } from "./characters.ts";
import type { Db } from "./database.ts";
import { recordFirstWin } from "./dungeons-won.ts";

const characterId = z.number().int().positive();
/** A time on the game's own clock, in milliseconds since the game started. */
const gameTime = z.number();

/**
 * The events of a stored game. Like messages from a client, they are
 * checked when they are read: a row written by an older version of the
 * server, or changed by hand, is caught at once instead of causing odd
 * behaviour later. If the shape of an event ever changes, add a new type or
 * an upgrade step (`upgradeEvent` below), as for characters (characters.ts).
 */
const storedEvent = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("gameStarted"),
    state: gameStateSchema,
    /** When each character on the track first acts, in game time. */
    turnTimes: z.array(z.object({ characterId, at: gameTime })),
    /** The server time at the start: the game's time 0. */
    startedAt: z.number(),
    /** The length of one turn cycle: the turn duration the creator chose, fixed at the start. */
    cycleMs: z.number().positive(),
    /** What every player gets when the game is won, fixed at the start. */
    silverReward: z.number().int().nonnegative(),
    /**
     * The dungeon, to record who has won it. `null` for a game started
     * before issue #31: its win isn't recorded and gives no one-time rewards.
     */
    dungeonId: z.enum(DUNGEON_IDS).nullable(),
    /** What a player gets on their first win of the dungeon, fixed at the start. */
    oneTimeRewards: z.array(oneTimeReward),
    /**
     * The characters whose player hadn't won this dungeon yet when the game
     * started: on a win, those players get the one-time rewards. Fixed at
     * the start, because an account is in one game at a time, so nothing
     * else can win the dungeon for it before this game ends.
     */
    firstWinCharacters: z.array(characterId),
  }),
  z.object({ type: z.literal("planChanged"), characterId, plan: planSchema.nullable() }),
  z.object({
    type: z.literal("turnResolved"),
    characterId,
    events: z.array(gameEvent),
    /** When the character that acted is due again, in game time. */
    nextTurnAt: gameTime,
    /**
     * The plan the character that acted starts its next turn with (the
     * rules' `followUpPlan`). Left out when it has none, and in turns
     * stored before issue #72.
     */
    nextPlan: planSchema.optional(),
  }),
  z.object({ type: z.literal("gameClosed"), reason: z.enum(["finished", "abandoned", "failed"]) }),
]);
export type StoredEvent = z.infer<typeof storedEvent>;

/**
 * Brings an event written by an older version of the server up to date,
 * before it is checked. A deploy must not end the games that are running,
 * so their stored events have to keep loading. Each step only adds what is
 * missing, so an event that is already up to date passes unchanged.
 *
 * - Issue #43, the actions stat: characters' stats get `actions: 1` (the
 *   only value there was), a plan of a single action becomes a list of one,
 *   and a cancelled plan is about its first (and only) action.
 * - Issue #27, rewards: characters have gained no XP yet and can gain up to
 *   what a rank 1 character's max level needs (nobody had any XP before),
 *   and the game pays the first dungeon's 10 silver when it is won.
 * - Issue #31, one-time rewards: the game doesn't know its dungeon, so its
 *   win isn't recorded and nobody gets one-time rewards from it.
 * - Issue #70, turn durations: the cycle length was a server setting then.
 *   The first character acted one full cycle after the start, so the
 *   earliest first turn time is the cycle the game was started with.
 */
function upgradeEvent(event: any): unknown {
  switch (event?.type) {
    case "gameStarted":
      for (const c of event.state?.characters ?? []) {
        if (c?.stats && c.stats.actions === undefined) c.stats.actions = 1;
        if (c && c.xpGained === undefined) c.xpGained = 0;
        if (c && c.maxXpGain === undefined) c.maxXpGain = maxXp(1);
      }
      if (event.silverReward === undefined) event.silverReward = 10;
      if (event.dungeonId === undefined) event.dungeonId = null;
      if (event.oneTimeRewards === undefined) event.oneTimeRewards = [];
      if (event.firstWinCharacters === undefined) event.firstWinCharacters = [];
      if (event.cycleMs === undefined && Array.isArray(event.turnTimes)) {
        event.cycleMs = Math.min(...event.turnTimes.map((t: any) => t?.at));
      }
      return event;
    case "planChanged":
      if (event.plan && !Array.isArray(event.plan)) event.plan = [event.plan];
      return event;
    case "turnResolved":
      for (const e of event.events ?? []) {
        if (e?.type === "planCancelled" && e.action === undefined) e.action = 0;
      }
      return event;
    default:
      return event;
  }
}
export type GameStarted = Extract<StoredEvent, { type: "gameStarted" }>;

/** A character number in a stored game, with who it stands for. */
export interface StoredMember {
  characterId: number;
  accountId: number;
  recordId: number;
  /** The account's current display name. */
  displayName: string;
  /** The character's current name. */
  characterName: string;
  /** Whether the player has gone back to the lobby. */
  left: boolean;
}

/**
 * What a finished game pays out (design.md, Rewards): XP per character
 * record, and when it was won, silver per account and the one-time rewards
 * for the accounts that won the dungeon for the first time.
 */
export interface Rewards {
  xp: { recordId: number; xp: number }[];
  silver: { accountId: number; silver: number }[];
  firstWins: { accountId: number; dungeonId: DungeonId; rewards: OneTimeReward[] }[];
}

/** A member as it is saved when the game starts. */
export type NewMember = Pick<StoredMember, "characterId" | "accountId" | "recordId">;

/** A game that wasn't closed when the server stopped. */
export interface StoredGame {
  id: string;
  members: StoredMember[];
  /** In the order they happened; the first is always `gameStarted`. */
  events: StoredEvent[];
}

/**
 * What the game manager needs from storage. The game manager only knows
 * this interface, not SQLite; tests that are only about the game itself use
 * `NO_STORE`.
 */
export interface GameStore {
  /** Saves a new game: its members and its `gameStarted` event, together. */
  saveStart(gameId: string, members: readonly NewMember[], event: GameStarted, clock: number): void;
  /**
   * Adds an event to a game. With `clock`, the server time is saved in the
   * same transaction (see game-manager.ts, Time). With `rewards` (the turn
   * that ended the game), they are written to the character records and
   * accounts in that transaction too: the game can't end without paying
   * out, nor pay out without ending.
   */
  append(gameId: string, event: StoredEvent, clock?: number, rewards?: Rewards): void;
  /** Notes that an account's player has gone back to the lobby. */
  markLeft(gameId: string, accountId: number): void;
  saveClock(clock: number): void;
  /**
   * The saved server time (0 for a new database) and every game that wasn't
   * closed. A game with a stored event that doesn't pass its check is
   * closed instead of returned.
   */
  load(): { clock: number; games: StoredGame[] };
}

/** Stores nothing: for tests of the game manager that don't need a database. */
export const NO_STORE: GameStore = {
  saveStart() {},
  append() {},
  markLeft() {},
  saveClock() {},
  load: () => ({ clock: 0, games: [] }),
};

export class SqliteGameStore implements GameStore {
  private readonly db: Db;
  private readonly now: () => number;

  /** `now` is the wall clock, only used for the `created_at` and `saved_at` columns. */
  constructor(db: Db, now: () => number = Date.now) {
    this.db = db;
    this.now = now;
  }

  saveStart(gameId: string, members: readonly NewMember[], event: GameStarted, clock: number): void {
    // A transaction: the members and the first event are saved together, or
    // (on an error) neither is. Like a TransactionScope in .NET, but
    // better-sqlite3's version is synchronous: the function runs, then
    // commits.
    this.db.transaction(() => {
      const insert = this.db.prepare(
        "INSERT INTO game_members (game_id, character_id, account_id, character_record_id) VALUES (?, ?, ?, ?)",
      );
      for (const m of members) insert.run(gameId, m.characterId, m.accountId, m.recordId);
      this.insertEvent(gameId, event);
      this.writeClock(clock);
    })();
  }

  append(gameId: string, event: StoredEvent, clock?: number, rewards?: Rewards): void {
    this.db.transaction(() => {
      this.insertEvent(gameId, event);
      if (clock !== undefined) this.writeClock(clock);
      for (const { recordId, xp } of rewards?.xp ?? []) addXp(this.db, recordId, xp, this.now());
      for (const { accountId, silver } of rewards?.silver ?? []) addSilver(this.db, accountId, silver);
      for (const win of rewards?.firstWins ?? []) {
        recordFirstWin(this.db, win.accountId, win.dungeonId, win.rewards, this.now());
      }
    })();
  }

  markLeft(gameId: string, accountId: number): void {
    this.db.prepare("UPDATE game_members SET left_game = 1 WHERE game_id = ? AND account_id = ?").run(gameId, accountId);
  }

  saveClock(clock: number): void {
    this.writeClock(clock);
  }

  load(): { clock: number; games: StoredGame[] } {
    const clockRow = this.db.prepare("SELECT running_ms FROM server_clock WHERE id = 1").get() as
      | { running_ms: number }
      | undefined;

    const gameIds = this.db
      .prepare(
        `SELECT DISTINCT game_id FROM game_events
         WHERE game_id NOT IN (SELECT game_id FROM game_events WHERE type = 'gameClosed')`,
      )
      .pluck()
      .all() as string[];

    const games: StoredGame[] = [];
    for (const id of gameIds) {
      const members = this.db
        .prepare(
          `SELECT m.character_id, m.account_id, m.character_record_id, m.left_game, a.display_name,
                  c.number, c.data
           FROM game_members m
           JOIN accounts a ON a.id = m.account_id
           JOIN characters c ON c.id = m.character_record_id
           WHERE m.game_id = ? ORDER BY m.character_id`,
        )
        .all(id) as {
        character_id: number;
        account_id: number;
        character_record_id: number;
        left_game: number;
        display_name: string;
        number: number;
        data: string;
      }[];
      const rows = this.db
        .prepare("SELECT type, data FROM game_events WHERE game_id = ? ORDER BY sequence")
        .all(id) as { type: string; data: string }[];
      let events: StoredEvent[];
      let characterNames: string[];
      try {
        events = rows.map((row) => storedEvent.parse(upgradeEvent({ ...JSON.parse(row.data), type: row.type })));
        characterNames = members.map((m) => nameOfCharacter({ ...loadCharacterData(m.data), number: m.number }));
      } catch (error) {
        // A bad stored game shouldn't keep the server from starting, nor
        // fail again on every restart.
        console.error(`Game ${id} has a bad stored event or character and was closed:`, error);
        this.append(id, { type: "gameClosed", reason: "failed" });
        continue;
      }
      games.push({
        id,
        members: members.map((m, i) => ({
          characterId: m.character_id,
          accountId: m.account_id,
          recordId: m.character_record_id,
          displayName: m.display_name,
          characterName: characterNames[i]!,
          left: m.left_game === 1,
        })),
        events,
      });
    }
    return { clock: clockRow?.running_ms ?? 0, games };
  }

  private insertEvent(gameId: string, event: StoredEvent): void {
    const { type, ...data } = event;
    // The next sequence number of this game. Safe without a lock: Node runs
    // one thing at a time and this is synchronous, and the primary key would
    // refuse a duplicate anyway.
    this.db
      .prepare(
        `INSERT INTO game_events (game_id, sequence, type, data, created_at)
         VALUES (?, (SELECT COALESCE(MAX(sequence), 0) + 1 FROM game_events WHERE game_id = ?), ?, ?, ?)`,
      )
      .run(gameId, gameId, type, JSON.stringify(data), this.now());
  }

  private writeClock(clock: number): void {
    // An "upsert": insert the one row, or update it when it is already there.
    this.db
      .prepare(
        `INSERT INTO server_clock (id, running_ms, saved_at) VALUES (1, ?, ?)
         ON CONFLICT (id) DO UPDATE SET running_ms = excluded.running_ms, saved_at = excluded.saved_at`,
      )
      .run(Math.round(clock), this.now());
  }
}
