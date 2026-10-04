// The messages that travel over the WebSocket, in both directions.
//
// Each message is JSON with a `type` field. The shapes are defined once, as
// Zod schemas, and the TypeScript types are derived from them. The server
// uses the schemas to check every incoming message at runtime: TypeScript
// types disappear when the code runs, and a message from the internet can
// contain anything.

import { z } from "zod";
import type { GameEvent } from "./rules/events.ts";
import type { GameState } from "./rules/game-state.ts";
import { MONSTER_TYPE_IDS } from "./rules/stats.ts";
import type { Plan } from "./rules/turn.ts";

/** Largest WebSocket message the server accepts, in bytes. */
export const MAX_MESSAGE_BYTES = 4096;

// ---- Client -> server ----

const ping = z.object({
  type: z.literal("ping"),
  /** Echoed back in the pong, so the client can match them up. */
  id: z.number().int().nonnegative(),
});

const gameId = z.string().max(64);

const createGame = z.object({ type: z.literal("create-game") });
const joinGame = z.object({ type: z.literal("join-game"), gameId });
/**
 * Leave the game you are in: an open one, a finished one (back to the lobby
 * after the result), or (for now) a running one.
 */
const leaveGame = z.object({ type: z.literal("leave-game") });
/** Only the game's creator may start it. */
const startGame = z.object({ type: z.literal("start-game") });
/**
 * Asks for a new snapshot of the running game the player is in, after the
 * client missed a turn. It carries no game id: the server sends the game of
 * the logged-in account, so nobody can ask for someone else's game.
 */
const getGame = z.object({ type: z.literal("get-game") });

// Used by the client messages below and by the running game further down.
const hexSchema = z.object({ q: z.number().int(), r: z.number().int() });
const characterId = z.number().int().positive();
const monsterId = z.number().int().nonnegative();

/** What a player plans for their character's next turn (see Plan in shared/rules/turn.ts). */
const planSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("place"), hex: hexSchema }),
  z.object({ type: z.literal("move"), to: hexSchema }),
  z.object({ type: z.literal("attack"), monsterId }),
]);

/**
 * Sets the plan of one of the player's own characters, replacing its old
 * plan. The server only checks that the character is the player's and still
 * in the game: whether the plan can be carried out is decided when the turn
 * fires (design.md, Planning).
 */
const setPlan = z.object({ type: z.literal("set-plan"), characterId, plan: planSchema });
/** Takes away the plan of one of the player's own characters: it does nothing on its turn. */
const clearPlan = z.object({ type: z.literal("clear-plan"), characterId });

export const clientMessage = z.discriminatedUnion("type", [
  ping,
  createGame,
  joinGame,
  leaveGame,
  startGame,
  getGame,
  setPlan,
  clearPlan,
]);
export type ClientMessage = z.infer<typeof clientMessage>;

// ---- Server -> client ----

const hello = z.object({
  type: z.literal("hello"),
  /** The version of the client files this server serves. */
  version: z.string(),
  /** The logged-in player's display name. */
  displayName: z.string(),
});

const pong = z.object({
  type: z.literal("pong"),
  id: z.number().int().nonnegative(),
});

const lobbyPlayer = z.object({
  displayName: z.string(),
  /** Whether the player has the game open right now. */
  online: z.boolean(),
});

const lobbyGame = z.object({
  id: gameId,
  /** Display name of the player who can start the game. */
  creator: z.string(),
  players: z.array(lobbyPlayer),
  started: z.boolean(),
});
export type LobbyGame = z.infer<typeof lobbyGame>;

/**
 * The whole lobby as this player sees it. Sent on connect and after every
 * change: the lobby is small, so a full snapshot each time is simpler than
 * sending only what changed, and a client can never get out of step.
 */
const lobby = z.object({
  type: z.literal("lobby"),
  /** Games that haven't started yet, oldest first. */
  openGames: z.array(lobbyGame),
  /** The game this player is in, open or started, or null. */
  myGame: lobbyGame.nullable(),
});
export type LobbyMessage = z.infer<typeof lobby>;

/** A request the server refused, with the reason to show. */
const refused = z.object({
  type: z.literal("refused"),
  reason: z.string(),
});

// ---- The running game ----
//
// These schemas describe the rules layer's own types (shared/rules), so the
// client can check what it receives. The `satisfies` checks at the bottom of
// this file make the compiler complain when the two drift apart.

const statsSchema = z.object({ movement: z.number(), attackDamage: z.number(), hitPoints: z.number() });

const gameStateSchema = z.object({
  map: z.object({
    hexes: z.array(hexSchema),
    startHexes: z.array(hexSchema),
    monsters: z.array(z.object({ type: z.enum(MONSTER_TYPE_IDS), position: hexSchema })),
  }),
  characters: z.array(
    z.object({
      id: characterId,
      stats: statsSchema,
      hp: z.number(),
      position: hexSchema.nullable(),
    }),
  ),
  monsters: z.array(
    z.object({ id: monsterId, type: z.enum(MONSTER_TYPE_IDS), hp: z.number(), position: hexSchema }),
  ),
  track: z.array(z.object({ characterId, monsterIds: z.array(monsterId) })),
});

const actor = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("character"), id: characterId }),
  z.object({ kind: z.literal("monster"), id: monsterId }),
]);

const gameEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("placed"), characterId, position: hexSchema }),
  z.object({ type: z.literal("notPlaced"), characterId }),
  z.object({ type: z.literal("moved"), actor, from: hexSchema, to: hexSchema }),
  z.object({ type: z.literal("attacked"), attacker: actor, target: actor, damage: z.number() }),
  z.object({ type: z.literal("died"), who: actor }),
  z.object({
    type: z.literal("planCancelled"),
    characterId,
    reason: z.enum([
      "already placed",
      "not placed",
      "not a start hex",
      "hex taken",
      "not a neighbour",
      "not on the map",
      "target gone",
    ]),
  }),
  z.object({ type: z.literal("gameEnded"), result: z.enum(["won", "lost"]) }),
]);

/**
 * When the characters on the track act next, soonest first. Sent as "in N
 * seconds" rather than as a clock time, because phone clocks can be off: the
 * client counts down from the moment the message arrives.
 */
const nextTurns = z.array(z.object({ characterId, inSeconds: z.number().nonnegative() }));

/** The current plan of every character that has one. */
const plans = z.array(z.object({ characterId, plan: planSchema }));

/**
 * The whole running game: sent on every connect and when the game starts.
 * `sequence` is the number of the last turn included in `state` (0 before
 * the first turn), so the client knows which "turn" message comes next.
 */
const game = z.object({
  type: z.literal("game"),
  gameId,
  sequence: z.number().int().nonnegative(),
  state: gameStateSchema,
  /** The display name of each character's player: the game itself only knows characters. */
  players: z.array(z.object({ characterId, displayName: z.string() })),
  /** This player's own characters. Each player gets their own copy of the snapshot. */
  yourCharacters: z.array(characterId),
  nextTurns,
  plans,
  /** `null` while the game is still going. */
  result: z.enum(["won", "lost"]).nullable(),
});
export type GameMessage = z.infer<typeof game>;

/**
 * One resolved turn: what happened, in order. Each turn's `sequence` is one
 * higher than the previous one; a client that sees a gap has missed a turn
 * and needs a new snapshot.
 */
const turn = z.object({
  type: z.literal("turn"),
  gameId,
  sequence: z.number().int().positive(),
  /** The character whose turn fired (its linked monsters acted after it). */
  characterId,
  events: z.array(gameEvent),
  nextTurns,
});
export type TurnMessage = z.infer<typeof turn>;

/**
 * A character's plan changed: sent live to every player in the game, the
 * player who changed it included, so everyone sees the same plans. A turn
 * uses up the plan of the character that acted; clients clear that plan
 * themselves when the "turn" message arrives, without a "plan" message.
 */
const planChanged = z.object({
  type: z.literal("plan"),
  gameId,
  characterId,
  /** `null`: the character has no plan any more. */
  plan: planSchema.nullable(),
});
export type PlanMessage = z.infer<typeof planChanged>;

export const serverMessage = z.discriminatedUnion("type", [hello, pong, lobby, refused, game, turn, planChanged]);
export type ServerMessage = z.infer<typeof serverMessage>;

/**
 * Parses raw text into a message, or returns `undefined` when it isn't valid
 * JSON or doesn't match the schema.
 */
export function parseMessage<T>(schema: z.ZodType<T>, text: string): T | undefined {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return undefined;
  }
  const result = schema.safeParse(json);
  return result.success ? result.data : undefined;
}

// Compile-time checks that the schemas and the rules layer's types match, in
// both directions: everything the server produces fits the schema (so the
// client never drops a valid game), and what the client receives can be fed
// straight to the shared rules. Like a unit test that the compiler runs:
// these lines do nothing at runtime.
null as unknown as GameState satisfies z.input<typeof gameStateSchema>;
null as unknown as z.output<typeof gameStateSchema> satisfies GameState;
null as unknown as GameEvent satisfies z.input<typeof gameEvent>;
null as unknown as z.output<typeof gameEvent> satisfies GameEvent;
null as unknown as Plan satisfies z.input<typeof planSchema>;
null as unknown as z.output<typeof planSchema> satisfies Plan;
