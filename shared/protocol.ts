// The messages that travel over the WebSocket, in both directions.
//
// Each message is JSON with a `type` field. The shapes are defined once, as
// Zod schemas, and the TypeScript types are derived from them. The server
// uses the schemas to check every incoming message at runtime: TypeScript
// types disappear when the code runs, and a message from the internet can
// contain anything.

import { z } from "zod";

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
/** Leave the game you are in: an open one, or (for now) a started one. */
const leaveGame = z.object({ type: z.literal("leave-game") });
/** Only the game's creator may start it. */
const startGame = z.object({ type: z.literal("start-game") });

export const clientMessage = z.discriminatedUnion("type", [ping, createGame, joinGame, leaveGame, startGame]);
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

export const serverMessage = z.discriminatedUnion("type", [hello, pong, lobby, refused]);
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
