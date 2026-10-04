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
//     character that acted is due again.
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
import { gameEvent, gameStateSchema, planSchema } from "../shared/protocol.ts";
import type { Db } from "./database.ts";

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
  }),
  z.object({ type: z.literal("planChanged"), characterId, plan: planSchema.nullable() }),
  z.object({
    type: z.literal("turnResolved"),
    characterId,
    events: z.array(gameEvent),
    /** When the character that acted is due again, in game time. */
    nextTurnAt: gameTime,
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
 */
function upgradeEvent(event: any): unknown {
  switch (event?.type) {
    case "gameStarted":
      for (const c of event.state?.characters ?? []) {
        if (c?.stats && c.stats.actions === undefined) c.stats.actions = 1;
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
  /** Whether the player has gone back to the lobby. */
  left: boolean;
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
   * same transaction (see game-manager.ts, Time).
   */
  append(gameId: string, event: StoredEvent, clock?: number): void;
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

  append(gameId: string, event: StoredEvent, clock?: number): void {
    this.db.transaction(() => {
      this.insertEvent(gameId, event);
      if (clock !== undefined) this.writeClock(clock);
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
          `SELECT m.character_id, m.account_id, m.character_record_id, m.left_game, a.display_name
           FROM game_members m JOIN accounts a ON a.id = m.account_id
           WHERE m.game_id = ? ORDER BY m.character_id`,
        )
        .all(id) as {
        character_id: number;
        account_id: number;
        character_record_id: number;
        left_game: number;
        display_name: string;
      }[];
      const rows = this.db
        .prepare("SELECT type, data FROM game_events WHERE game_id = ? ORDER BY sequence")
        .all(id) as { type: string; data: string }[];
      let events: StoredEvent[];
      try {
        events = rows.map((row) => storedEvent.parse(upgradeEvent({ ...JSON.parse(row.data), type: row.type })));
      } catch (error) {
        // A bad stored game shouldn't keep the server from starting, nor
        // fail again on every restart.
        console.error(`Game ${id} has a bad stored event and was closed:`, error);
        this.append(id, { type: "gameClosed", reason: "failed" });
        continue;
      }
      games.push({
        id,
        members: members.map((m) => ({
          characterId: m.character_id,
          accountId: m.account_id,
          recordId: m.character_record_id,
          displayName: m.display_name,
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
