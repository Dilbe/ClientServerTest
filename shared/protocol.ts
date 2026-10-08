// The messages that travel over the WebSocket, in both directions.
//
// Each message is JSON with a `type` field. The shapes are defined once, as
// Zod schemas, and the TypeScript types are derived from them. The server
// uses the schemas to check every incoming message at runtime: TypeScript
// types disappear when the code runs, and a message from the internet can
// contain anything.

import { z } from "zod";
import { ABILITY_IDS } from "./rules/abilities.ts";
import { CLASS_IDS, MAX_RANK, MIN_RANK } from "./rules/advancement.ts";
import { DIFFICULTY_IDS, type DungeonWin } from "./rules/difficulties.ts";
import { DUNGEON_IDS, type OneTimeReward } from "./rules/dungeon-map.ts";
import type { GameEvent } from "./rules/events.ts";
import type { GameState } from "./rules/game-state.ts";
import { MONSTER_TYPE_IDS } from "./rules/stats.ts";
import type { Plan, PlannedAction } from "./rules/turn.ts";
import { DEFAULT_TURN_DURATION, TURN_DURATION_IDS } from "./turn-durations.ts";

/** Largest WebSocket message the server accepts, in bytes. */
export const MAX_MESSAGE_BYTES = 4096;

/**
 * The most actions any plan can have, whatever the character's actions
 * stat. The game manager checks the stat itself; this is only a first,
 * cheap limit on what a client can send.
 */
export const MAX_PLANNED_ACTIONS = 10;

/** How many of their characters a player can bring into one game (design.md, Characters). */
export const MAX_CHARACTERS_PER_PLAYER = 3;

// ---- Client -> server ----

const ping = z.object({
  type: z.literal("ping"),
  /** Echoed back in the pong, so the client can match them up. */
  id: z.number().int().nonnegative(),
});

const gameId = z.string().max(64);

/**
 * The characters a player brings into a game: 1 to 3 of their own, by their
 * number within the account, each at most once. The server checks that they
 * are the player's own; the schema only checks the shape.
 */
export const chosenCharacters = z
  .array(z.number().int().positive())
  .min(1)
  .max(MAX_CHARACTERS_PER_PLAYER)
  .refine((numbers) => new Set(numbers).size === numbers.length, "A character can be chosen only once.");

/**
 * Creates a game. The turn duration is chosen here and stays for the whole
 * game (see shared/turn-durations.ts); the schema refuses ids that aren't
 * one. Left out, it is the default.
 */
const createGame = z.object({
  type: z.literal("create-game"),
  characters: chosenCharacters,
  turnDuration: z.enum(TURN_DURATION_IDS).default(DEFAULT_TURN_DURATION),
});
const joinGame = z.object({ type: z.literal("join-game"), gameId, characters: chosenCharacters });
/** Changes which characters the player brings, until the game starts. */
const chooseCharacters = z.object({ type: z.literal("choose-characters"), characters: chosenCharacters });
/**
 * Leave the game you are in: an open one, a finished one (back to the lobby
 * after the result), or (for now) a running one.
 */
const leaveGame = z.object({ type: z.literal("leave-game") });
/**
 * Only the game's creator may choose its dungeon and difficulty, before the
 * start, and only ones they can play (design.md, Unlocking dungeons). They
 * are chosen together, because a dungeon may only be playable on some
 * difficulties. The schema already refuses ids that aren't a dungeon or a
 * difficulty; whether the creator can play them is the lobby's check.
 */
const chooseDungeon = z.object({
  type: z.literal("choose-dungeon"),
  dungeonId: z.enum(DUNGEON_IDS),
  difficulty: z.enum(DIFFICULTY_IDS),
});
/** Only the game's creator may start it. */
const startGame = z.object({ type: z.literal("start-game") });
/**
 * Asks for a new snapshot of the running game the player is in, after the
 * client missed a turn. It carries no game id: the server sends the game of
 * the logged-in account, so nobody can ask for someone else's game.
 */
const getGame = z.object({ type: z.literal("get-game") });
/**
 * Asks for a new lobby snapshot. The lobby is pushed after every change in
 * it, but the player's own characters can also change on the character page
 * (an HTTP request), which doesn't push anything: the client asks when it
 * comes back to the lobby.
 */
const getLobby = z.object({ type: z.literal("get-lobby") });

// Used by the client messages below and by the running game further down.
const hexSchema = z.object({ q: z.number().int(), r: z.number().int() });
const characterId = z.number().int().positive();
const monsterId = z.number().int().nonnegative();

/** One planned action (see PlannedAction in shared/rules/turn.ts). */
const plannedActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("place"), hex: hexSchema }),
  z.object({ type: z.literal("move"), to: hexSchema }),
  z.object({ type: z.literal("attack"), monsterId }),
  z.object({ type: z.literal("heavyStrike"), monsterId }),
  z.object({ type: z.literal("openDoor"), door: hexSchema }),
]);

/**
 * What a player plans for their character's next turn: its actions in
 * order (see Plan in shared/rules/turn.ts). An empty plan is no plan: that
 * is what "clear-plan" is for.
 */
export const planSchema = z.array(plannedActionSchema).min(1).max(MAX_PLANNED_ACTIONS);

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
  chooseCharacters,
  leaveGame,
  chooseDungeon,
  startGame,
  getGame,
  getLobby,
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

/** A character as the lobby shows it: by its number within its account, with its name. */
const lobbyCharacter = z.object({
  number: z.number().int().positive(),
  /** The name it goes by (see nameOfCharacter in shared/characters.ts). */
  name: z.string(),
  /**
   * Only on the party screen (`myGame`, before the start): the XP it would
   * get from clearing the chosen dungeon on the chosen difficulty, as a
   * percentage of the full XP (design.md, Diminishing returns), or
   * "maxLevel" when it can't gain XP at all.
   */
  xp: z.union([z.literal("maxLevel"), z.number().int().min(0).max(100)]).optional(),
});
export type LobbyCharacter = z.infer<typeof lobbyCharacter>;

const lobbyPlayer = z.object({
  displayName: z.string(),
  /** Whether the player has the game open right now. */
  online: z.boolean(),
  /**
   * The characters the player brings, in the order they chose them. Empty
   * for a game that was already running when the server restarted: the
   * lobby doesn't need them any more then, and the game itself names them.
   */
  characters: z.array(lobbyCharacter),
});

const lobbyGame = z.object({
  id: gameId,
  /** Display name of the player who can start the game. */
  creator: z.string(),
  players: z.array(lobbyPlayer),
  /** The dungeon the creator chose. Its name and limits are in shared/rules/dungeon-map.ts. */
  dungeonId: z.enum(DUNGEON_IDS),
  /** The difficulty the creator chose. Its name and multipliers are in shared/rules/difficulties.ts. */
  difficulty: z.enum(DIFFICULTY_IDS),
  /** Chosen by the creator when creating the game (see shared/turn-durations.ts). */
  turnDuration: z.enum(TURN_DURATION_IDS),
  started: z.boolean(),
});
export type LobbyGame = z.infer<typeof lobbyGame>;

/**
 * A reward for a player's very first win of a dungeon (see OneTimeReward in
 * shared/rules/dungeon-map.ts). One shape per type, like the planned actions.
 */
export const oneTimeReward = z.discriminatedUnion("type", [z.object({ type: z.literal("newCharacter") })]);

/** A dungeon won on a difficulty (see DungeonWin in shared/rules/difficulties.ts). */
const dungeonWin = z.object({ dungeonId: z.enum(DUNGEON_IDS), difficulty: z.enum(DIFFICULTY_IDS) });

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
  /**
   * The dungeons this player has won, per difficulty. A won dungeon no
   * longer gives its one-time rewards on that difficulty (the rewards
   * themselves are in the shared dungeon data), and the wins decide which
   * dungeons and difficulties the player can choose as a host.
   */
  dungeonWins: z.array(dungeonWin),
  /** This player's own characters, by number, to choose from. */
  yourCharacters: z.array(
    lobbyCharacter.extend({
      rank: z.number().int().min(MIN_RANK).max(MAX_RANK),
      level: z.number().int().positive(),
    }),
  ),
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

const statsSchema = z.object({
  actions: z.number(),
  movement: z.number(),
  attackDamage: z.number(),
  hitPoints: z.number(),
});

export const gameStateSchema = z.object({
  difficulty: z.enum(DIFFICULTY_IDS),
  map: z.object({
    hexes: z.array(hexSchema),
    startHexes: z.array(hexSchema),
    doors: z.array(hexSchema),
    monsters: z.array(z.object({ type: z.enum(MONSTER_TYPE_IDS), position: hexSchema })),
  }),
  characters: z.array(
    z.object({
      id: characterId,
      stats: statsSchema,
      hp: z.number(),
      position: hexSchema.nullable(),
      xpGained: z.number().int().nonnegative(),
      maxXpGain: z.number().int().nonnegative(),
      earlierKills: z.array(z.number().int().nonnegative()),
      abilities: z.array(z.enum(ABILITY_IDS)),
      cooldowns: z.partialRecord(z.enum(ABILITY_IDS), z.number().int().nonnegative()),
    }),
  ),
  monsters: z.array(
    z.object({
      id: monsterId,
      type: z.enum(MONSTER_TYPE_IDS),
      hp: z.number(),
      position: hexSchema,
      asleep: z.boolean(),
    }),
  ),
  track: z.array(z.object({ characterId, monsterIds: z.array(monsterId) })),
  closedDoors: z.array(hexSchema),
});

const actor = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("character"), id: characterId }),
  z.object({ kind: z.literal("monster"), id: monsterId }),
]);

export const gameEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("placed"), characterId, position: hexSchema }),
  z.object({ type: z.literal("notPlaced"), characterId }),
  z.object({ type: z.literal("moved"), actor, from: hexSchema, to: hexSchema }),
  z.object({
    type: z.literal("attacked"),
    attacker: actor,
    target: actor,
    damage: z.number(),
    ability: z.enum(ABILITY_IDS).optional(),
  }),
  z.object({ type: z.literal("died"), who: actor }),
  z.object({
    type: z.literal("xpGained"),
    gains: z.array(z.object({ characterId, xp: z.number().int().positive() })),
  }),
  z.object({ type: z.literal("doorOpened"), characterId, position: hexSchema }),
  z.object({ type: z.literal("monstersWoke"), monsterIds: z.array(monsterId) }),
  z.object({
    type: z.literal("cooldownStarted"),
    characterId,
    ability: z.enum(ABILITY_IDS),
    turns: z.number().int().nonnegative(),
  }),
  z.object({ type: z.literal("cooldownsAdvanced"), characterId }),
  z.object({
    type: z.literal("planCancelled"),
    characterId,
    action: z.number().int().nonnegative(),
    reason: z.enum([
      "already placed",
      "not placed",
      "not a start hex",
      "hex taken",
      "not a neighbour",
      "not on the map",
      "door closed",
      "no closed door",
      "target gone",
      "no ability",
      "not ready",
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
  /**
   * Each character's name, class and rank, and its player's display name:
   * the game itself only knows characters, by their number in the game. The
   * level isn't here: it changes during the game, and the client works it
   * out from the state (`levelInGame` in shared/rules/advancement.ts).
   */
  players: z.array(
    z.object({
      characterId,
      displayName: z.string(),
      characterName: z.string(),
      class: z.enum(CLASS_IDS),
      rank: z.number().int().min(MIN_RANK).max(MAX_RANK),
    }),
  ),
  /** This player's own characters. Each player gets their own copy of the snapshot. */
  yourCharacters: z.array(characterId),
  nextTurns,
  plans,
  /** `null` while the game is still going. */
  result: z.enum(["won", "lost"]).nullable(),
  /** The silver every player gets when the dungeon is won (design.md, Rewards). */
  silverReward: z.number().int().nonnegative(),
  /**
   * What this player gets on top of the silver when the dungeon is won,
   * because it is their first win of it. Empty when they had won it before.
   */
  oneTimeRewards: z.array(oneTimeReward),
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
  /**
   * The plan the character that acted starts its next turn with: attacks on
   * the monster it last attacked (design.md, Keeping a monster targeted).
   * Left out when it has none.
   */
  nextPlan: planSchema.optional(),
});
export type TurnMessage = z.infer<typeof turn>;

/**
 * A character's plan changed: sent live to every player in the game, the
 * player who changed it included, so everyone sees the same plans. A turn
 * uses up the plan of the character that acted; clients replace that plan
 * with the turn's `nextPlan` themselves when the "turn" message arrives,
 * without a "plan" message.
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
null as unknown as OneTimeReward satisfies z.input<typeof oneTimeReward>;
null as unknown as z.output<typeof oneTimeReward> satisfies OneTimeReward;
null as unknown as DungeonWin satisfies z.input<typeof dungeonWin>;
null as unknown as z.output<typeof dungeonWin> satisfies DungeonWin;
null as unknown as PlannedAction satisfies z.input<typeof plannedActionSchema>;
null as unknown as z.output<typeof plannedActionSchema> satisfies PlannedAction;
