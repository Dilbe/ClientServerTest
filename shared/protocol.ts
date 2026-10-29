// The messages that travel over the WebSocket, in both directions.
//
// Each message is JSON with a `type` field. The shapes are defined once, as
// Zod schemas, and the TypeScript types are derived from them. The server
// uses the schemas to check every incoming message at runtime: TypeScript
// types disappear when the code runs, and a message from the internet can
// contain anything.

import { z } from "zod";
import { ABILITY_IDS, ABILITY_UPGRADE_IDS } from "./rules/abilities.ts";
import { MAX_RANK, MIN_RANK } from "./rules/advancement.ts";
import { CLASS_IDS } from "./rules/classes.ts";
import { DIFFICULTY_IDS, type DungeonWin } from "./rules/difficulties.ts";
import { DUNGEON_IDS, type OneTimeReward } from "./rules/dungeon-map.ts";
import type { GameEvent } from "./rules/events.ts";
import type { GameState } from "./rules/game-state.ts";
import { MONSTER_TYPE_IDS, UPGRADABLE_STAT_IDS } from "./rules/stats.ts";
import type { Plan, PlannedAction } from "./rules/turn.ts";
import type { UpgradeChoice } from "./rules/upgrades.ts";
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
 * A game's password (design.md, Private games). Spaces at either end are
 * dropped: they are easy to type by accident on a phone. Empty means no
 * password: a game anyone can join.
 */
const gamePassword = z.string().trim().max(64).default("");

/**
 * Creates a game. The turn duration is chosen here and stays for the whole
 * game (see shared/turn-durations.ts); the schema refuses ids that aren't
 * one. Left out, it is the default.
 */
const createGame = z.object({
  type: z.literal("create-game"),
  characters: chosenCharacters,
  turnDuration: z.enum(TURN_DURATION_IDS).default(DEFAULT_TURN_DURATION),
  /** Set: a private game, which only players who know the password can join. */
  password: gamePassword,
});
/** The password is only checked for a private game. */
const joinGame = z.object({ type: z.literal("join-game"), gameId, characters: chosenCharacters, password: gamePassword });
/** Changes which characters the player brings, until the game starts. */
const chooseCharacters = z.object({ type: z.literal("choose-characters"), characters: chosenCharacters });
/**
 * Leave the game you are in: an open one, a finished one (back to the lobby
 * after the result), or (for now) a running one.
 */
const leaveGame = z.object({ type: z.literal("leave-game") });
/**
 * Only the game's creator may choose its dungeon and difficulty, before the
 * start, and only ones everyone in the party can play (design.md, Unlocking
 * dungeons). They are chosen together, because a dungeon may only be
 * playable on some difficulties. The schema already refuses ids that aren't
 * a dungeon or a difficulty; whether the party can play them is the lobby's
 * check.
 */
const chooseDungeon = z.object({
  type: z.literal("choose-dungeon"),
  dungeonId: z.enum(DUNGEON_IDS),
  difficulty: z.enum(DIFFICULTY_IDS),
});
/**
 * A character in a party's turn order (design.md, Setting up the track):
 * the index of its player in the game's `players`, and its number within
 * that player's account. Indexes rather than account ids, because the
 * client never learns account ids.
 */
const turnOrderEntry = z.object({
  player: z.number().int().nonnegative(),
  number: z.number().int().positive(),
});
export type TurnOrderEntry = z.infer<typeof turnOrderEntry>;

/**
 * Only the game's creator may set the turn order, before the start: every
 * character of the party, each once, in the order they will act. Sending
 * the whole order lets the server check it against the party as it is now.
 */
const setTurnOrder = z.object({
  type: z.literal("set-turn-order"),
  // Far more than any dungeon allows: only a first, cheap limit.
  order: z.array(turnOrderEntry).max(16),
});
/**
 * Only the game's creator may remove another player from the party, before
 * the start. The player is named by their index in the game's `players` and
 * by their display name, so the server can tell when the party changed in
 * the meantime and the index now points at someone else.
 */
const kickPlayer = z.object({
  type: z.literal("kick-player"),
  player: z.number().int().nonnegative(),
  displayName: z.string().max(64),
});
/** Only the game's creator may start it. */
const startGame = z.object({ type: z.literal("start-game") });
/**
 * Starts the clock of a game that waits for its player: the automatic first
 * game of a new account (design.md, The first game). Any player in the game
 * may send it; for any other game it is refused.
 */
const unpauseGame = z.object({ type: z.literal("unpause-game") });
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
  z.object({ type: z.literal("attack"), target: hexSchema }),
  z.object({ type: z.literal("heavyStrike"), target: hexSchema }),
  z.object({ type: z.literal("charge"), target: hexSchema }),
  z.object({ type: z.literal("cleave") }),
  z.object({ type: z.literal("stun"), target: hexSchema }),
  z.object({ type: z.literal("taunt"), target: hexSchema }),
  z.object({ type: z.literal("protect"), target: hexSchema }),
  z.object({ type: z.literal("leap"), target: hexSchema }),
  z.object({ type: z.literal("fireball"), target: hexSchema }),
  z.object({ type: z.literal("recall") }),
  z.object({ type: z.literal("frostWave"), target: hexSchema }),
  z.object({ type: z.literal("teleport"), target: hexSchema }),
  z.object({ type: z.literal("createWall"), target: hexSchema }),
  z.object({ type: z.literal("meteor"), target: hexSchema }),
  z.object({ type: z.literal("healingTouch"), target: characterId }),
  z.object({ type: z.literal("renew"), target: characterId }),
  z.object({ type: z.literal("ward"), target: characterId }),
  z.object({ type: z.literal("groupHeal") }),
  z.object({ type: z.literal("revive"), target: characterId, hex: hexSchema }),
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
  setTurnOrder,
  kickPlayer,
  startGame,
  unpauseGame,
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
  /**
   * Only on the party screen (`myGame`, before the start), like `xp`: its
   * rank and level, so the party sees how strong everyone's characters are.
   */
  rank: z.number().int().min(MIN_RANK).max(MAX_RANK).optional(),
  level: z.number().int().positive().optional(),
});
export type LobbyCharacter = z.infer<typeof lobbyCharacter>;

/** A dungeon won on a difficulty (see DungeonWin in shared/rules/difficulties.ts). */
const dungeonWin = z.object({ dungeonId: z.enum(DUNGEON_IDS), difficulty: z.enum(DIFFICULTY_IDS) });

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
  /**
   * Only in the player's own open game (`myGame`, before the start): the
   * dungeons this player has won, per difficulty. A party only goes where
   * everyone can play (design.md, Unlocking dungeons), so the host's dungeon
   * map needs everyone's wins, not only the host's own.
   */
  dungeonWins: z.array(dungeonWin).optional(),
});

const lobbyGame = z.object({
  id: gameId,
  /** Display name of the player who can start the game. */
  creator: z.string(),
  players: z.array(lobbyPlayer),
  /**
   * Every chosen character, in the order they will act: set by the creator,
   * new characters at the end. Empty for a game that was already running
   * when the server restarted, like the players' characters.
   */
  turnOrder: z.array(turnOrderEntry),
  /** The dungeon the creator chose. Its name and limits are in shared/rules/dungeon-map.ts. */
  dungeonId: z.enum(DUNGEON_IDS),
  /** The difficulty the creator chose. Its name and multipliers are in shared/rules/difficulties.ts. */
  difficulty: z.enum(DIFFICULTY_IDS),
  /** Chosen by the creator when creating the game (see shared/turn-durations.ts). */
  turnDuration: z.enum(TURN_DURATION_IDS),
  /** Whether joining needs a password. The password itself is never sent. */
  private: z.boolean(),
  started: z.boolean(),
});
export type LobbyGame = z.infer<typeof lobbyGame>;

/**
 * A reward for a player's very first win of a dungeon (see OneTimeReward in
 * shared/rules/dungeon-map.ts). One shape per type, like the planned actions.
 */
export const oneTimeReward = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("newCharacter"),
    class: z.enum(CLASS_IDS),
    rank: z.number().int().min(MIN_RANK).max(MAX_RANK),
    level: z.number().int().min(1),
  }),
]);

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
   * dungeons and difficulties the player can choose as a host, and which
   * open games they can join.
   */
  dungeonWins: z.array(dungeonWin),
  /** This player's own characters, by number, to choose from. */
  yourCharacters: z.array(
    lobbyCharacter.extend({
      class: z.enum(CLASS_IDS),
      rank: z.number().int().min(MIN_RANK).max(MAX_RANK),
      level: z.number().int().positive(),
      /**
       * Its rest after its last dungeon (design.md, Resting): how long until
       * it is healed and until it can be chosen again, from when the server
       * sent this, in milliseconds. 0 when that has passed.
       */
      healedInMs: z.number().int().nonnegative(),
      readyInMs: z.number().int().nonnegative(),
      /**
       * Whether it is in a game (design.md, Character filters): chosen in
       * the player's open party, or in a game that hasn't ended yet, also
       * one the player has left.
       */
      inGame: z.boolean(),
    }),
  ),
});
export type LobbyMessage = z.infer<typeof lobby>;

/** A request the server refused, with the reason to show. */
const refused = z.object({
  type: z.literal("refused"),
  reason: z.string(),
});

/**
 * Sent to a player the host removed from the party, after the lobby that no
 * longer has them in it, so the client can say why they are back on "Find a
 * game".
 */
const kicked = z.object({
  type: z.literal("kicked"),
  /** Display name of the host who removed them. */
  by: z.string(),
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
  /** Only for a class that has it: the healer (design.md, The healer). */
  healingPower: z.number().optional(),
  /** Only for the ranger, its longest shot (design.md, Ranged attacks for characters). */
  range: z.number().optional(),
});

/** How often a character upgraded its abilities (AbilityUpgradeCounts in shared/rules/abilities.ts). */
const abilityUpgradeCounts = z.partialRecord(
  z.enum(ABILITY_IDS),
  z.partialRecord(z.enum(ABILITY_UPGRADE_IDS), z.number().int().nonnegative()),
);

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
      abilityUpgrades: abilityUpgradeCounts,
      cooldowns: z.partialRecord(z.enum(ABILITY_IDS), z.number().int().nonnegative()),
      halfMeleeDamage: z.literal(true).optional(),
      shortestRange: z.number().int().positive().optional(),
      spellCharges: z.partialRecord(z.enum(ABILITY_IDS), z.number().int().nonnegative()).optional(),
      blockCharges: z.number().int().nonnegative().optional(),
      regenTurns: z.number().int().nonnegative().optional(),
      renewTurns: z.number().int().nonnegative().optional(),
      protectedBy: characterId.optional(),
      ward: z.object({ by: characterId, shield: z.number().int().nonnegative() }).optional(),
    }),
  ),
  monsters: z.array(
    z.object({
      id: monsterId,
      type: z.enum(MONSTER_TYPE_IDS),
      hp: z.number(),
      position: hexSchema,
      asleep: z.boolean(),
      stunned: z.boolean(),
      tauntedBy: characterId.optional(),
      frozen: z.literal(true).optional(),
    }),
  ),
  track: z.array(z.object({ characterId, monsterIds: z.array(monsterId) })),
  closedDoors: z.array(hexSchema),
  createdWalls: z
    .array(z.object({ characterId, hexes: z.array(hexSchema), turnsLeft: z.number().int().positive() }))
    .optional(),
  /** Ended because nobody was connected (see GameState). */
  abandoned: z.literal(true).optional(),
});

const actor = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("character"), id: characterId }),
  z.object({ kind: z.literal("monster"), id: monsterId }),
]);

export const gameEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("placed"), characterId, position: hexSchema }),
  z.object({ type: z.literal("notPlaced"), characterId }),
  z.object({ type: z.literal("moved"), actor, from: hexSchema, to: hexSchema, ability: z.enum(ABILITY_IDS).optional() }),
  z.object({
    type: z.literal("attacked"),
    attacker: actor,
    target: actor,
    damage: z.number(),
    ability: z.enum(ABILITY_IDS).optional(),
    blocked: z.number().int().positive().optional(),
    protecting: characterId.optional(),
    absorbed: z.number().int().positive().optional(),
  }),
  z.object({ type: z.literal("blockRefilled"), characterId, charges: z.number().int().nonnegative() }),
  z.object({ type: z.literal("regenStarted"), characterId, turns: z.number().int().nonnegative() }),
  z.object({ type: z.literal("regenerated"), characterId, healed: z.number().int().nonnegative() }),
  z.object({
    type: z.literal("revived"),
    characterId,
    targetId: characterId,
    position: hexSchema,
    hp: z.number().int().positive(),
  }),
  z.object({ type: z.literal("warded"), characterId, targetId: characterId, shield: z.number().int().nonnegative() }),
  z.object({ type: z.literal("wardEnded"), characterId }),
  z.object({ type: z.literal("renewStarted"), characterId, targetId: characterId, turns: z.number().int().nonnegative() }),
  z.object({ type: z.literal("renewHealed"), characterId, healed: z.number().int().nonnegative() }),
  z.object({
    type: z.literal("healed"),
    characterId,
    targetId: characterId,
    healed: z.number().int().nonnegative(),
    ability: z.enum(ABILITY_IDS),
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
  z.object({ type: z.literal("chargeUsed"), characterId, ability: z.enum(ABILITY_IDS) }),
  z.object({ type: z.literal("chargesRecalled"), characterId, abilities: z.array(z.enum(ABILITY_IDS)) }),
  z.object({ type: z.literal("stunned"), characterId, monsterId }),
  z.object({ type: z.literal("turnSkipped"), monsterId }),
  z.object({ type: z.literal("taunted"), characterId, monsterId }),
  z.object({ type: z.literal("tauntEnded"), monsterId }),
  z.object({ type: z.literal("frozen"), characterId, monsterIds: z.array(monsterId) }),
  z.object({ type: z.literal("thawed"), monsterId }),
  z.object({ type: z.literal("wallCreated"), characterId, hexes: z.array(hexSchema), turns: z.number().int().positive() }),
  z.object({ type: z.literal("wallCountedDown"), characterId }),
  z.object({ type: z.literal("wallRemoved"), characterId }),
  z.object({ type: z.literal("protected"), characterId, allyId: characterId }),
  z.object({ type: z.literal("protectEnded"), characterId }),
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
      "too close",
      "not on the map",
      "door closed",
      "no closed door",
      "target gone",
      "no monster adjacent",
      "not in line",
      "path blocked",
      "no ally",
      "full hit points",
      "nobody hurt",
      "not dead",
      "out of range",
      "out of sight",
      "closed room",
      "created wall",
      "no free hex",
      "no monster in area",
      "no charges",
      "no monsters awake",
      "no charges used",
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
  /**
   * The game waits for its player to press Start: its clock stands still and
   * `nextTurns` counts from the moment it starts (design.md, The first game).
   */
  paused: z.boolean(),
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

/** What a character upgraded (UpgradeChoice in shared/rules/upgrades.ts). */
const upgradeChoice = z.union([
  z.object({ stat: z.enum(UPGRADABLE_STAT_IDS) }),
  z.object({ ability: z.enum(ABILITY_IDS), upgrade: z.enum(ABILITY_UPGRADE_IDS) }),
]);

/**
 * A player upgraded a character during the game, on the character page
 * (design.md, Upgrade points; issue #153): sent to every player in the game,
 * who apply it to their state with the shared rules' `applyUpgrade`. It
 * counts at once, for the plans and the preview too. Like a plan change, it
 * isn't a turn, so it has no sequence number.
 */
const upgraded = z.object({ type: z.literal("upgraded"), gameId, characterId, upgrade: upgradeChoice });
export type UpgradedMessage = z.infer<typeof upgraded>;

export const serverMessage = z.discriminatedUnion("type", [
  hello,
  pong,
  lobby,
  refused,
  kicked,
  game,
  turn,
  planChanged,
  upgraded,
]);
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
null as unknown as UpgradeChoice satisfies z.input<typeof upgradeChoice>;
null as unknown as z.output<typeof upgradeChoice> satisfies UpgradeChoice;
null as unknown as PlannedAction satisfies z.input<typeof plannedActionSchema>;
null as unknown as z.output<typeof plannedActionSchema> satisfies PlannedAction;
