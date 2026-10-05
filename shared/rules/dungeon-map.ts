// Dungeon maps as data: which hexes exist, where characters enter, and where
// the monsters stand at the start (design.md, Dungeons).

import { hexKey, rectangle, fromOffset, stepsFrom, type Hex } from "./hex.ts";
import { MONSTER_TYPES, type MonsterTypeId } from "./stats.ts";

export interface MonsterPlacement {
  type: MonsterTypeId;
  position: Hex;
}

export interface DungeonMap {
  /** Every hex of the map. Walls are simply hexes that aren't in this list. */
  hexes: Hex[];
  /**
   * Where characters may be placed, from the top. A character without a
   * placement plan goes on the first free one, so the order is a game rule.
   */
  startHexes: Hex[];
  /** The monsters at the start of the game. The same map always starts the same way. */
  monsters: MonsterPlacement[];
}

/**
 * The first dungeon: one room of 6 columns by 4 rows. The start hexes are
 * the left column; 2 monsters stand on the middle two hexes of the right
 * column.
 */
export const FIRST_DUNGEON_MAP: DungeonMap = {
  hexes: rectangle(6, 4),
  startHexes: [0, 1, 2, 3].map((row) => fromOffset(0, row)),
  monsters: [
    { type: "basic", position: fromOffset(5, 1) },
    { type: "basic", position: fromOffset(5, 2) },
  ],
};

/**
 * The second dungeon: one room of 6 columns by 8 rows. The start hexes are
 * the middle 4 hexes of the left column; 4 monsters are spread over the
 * right column, two near the top and two near the bottom.
 */
export const SECOND_DUNGEON_MAP: DungeonMap = {
  hexes: rectangle(6, 8),
  startHexes: [2, 3, 4, 5].map((row) => fromOffset(0, row)),
  monsters: [0, 2, 5, 7].map((row) => ({ type: "basic", position: fromOffset(5, row) })),
};

/**
 * The hallway: a hallway 2 columns wide and 3 rows long below the middle of a
 * room of 4 columns by 6 rows, without a door between them. Only the 2 hexes
 * at the far (bottom) end of the hallway are start hexes; 2 monsters stand in
 * the middle of the room's top row.
 *
 * In columns and rows: the room is columns 0 to 3, rows 0 to 5; the hallway
 * is columns 1 and 2, rows 6 to 8. Every other hex is wall.
 */
export const HALLWAY_MAP: DungeonMap = {
  hexes: [
    ...rectangle(4, 6),
    ...[1, 2].flatMap((col) => [6, 7, 8].map((row) => fromOffset(col, row))),
  ],
  // From the top: odd columns are shifted half a hex down, so column 2's
  // bottom hex is a little higher than column 1's.
  startHexes: [fromOffset(2, 8), fromOffset(1, 8)],
  monsters: [
    { type: "basic", position: fromOffset(1, 0) },
    { type: "basic", position: fromOffset(2, 0) },
  ],
};

/**
 * The fixed id of every dungeon. The database records which dungeons each
 * account has won by these ids, so **an id must never change or be reused
 * once it is in use**; rename the dungeon's `name` instead.
 */
export const DUNGEON_IDS = ["first", "second", "hallway"] as const;
export type DungeonId = (typeof DUNGEON_IDS)[number];

/**
 * A reward a player only gets on their very first win of a dungeon
 * (design.md, Rewards). Each type of reward is one shape here, told apart by
 * `type`, so more types can be added later; the schema is `oneTimeReward` in
 * shared/protocol.ts.
 *
 * - `newCharacter`: a new level 1, rank 1 adventurer with the account's next
 *   number, like a bought one.
 */
export type OneTimeReward = { type: "newCharacter" };

/** A dungeon: its map and its dungeon stats (design.md, Dungeons). */
export interface Dungeon {
  id: DungeonId;
  name: string;
  map: DungeonMap;
  /**
   * The most characters a game in this dungeon can have, counted over all
   * players together.
   */
  maxCharacters: number;
  /** The silver every player gets, once, when the dungeon is won. */
  silverReward: number;
  /** What a player gets on their very first win of this dungeon, on top of the silver. */
  oneTimeRewards: OneTimeReward[];
}

/**
 * Every dungeon, in the order the lobby offers them. Adding a dungeon means
 * adding its id to DUNGEON_IDS and an entry here (design.md, Built to grow).
 */
export const DUNGEONS: Record<DungeonId, Dungeon> = {
  first: {
    id: "first",
    name: "The first dungeon",
    map: FIRST_DUNGEON_MAP,
    maxCharacters: 4,
    silverReward: 10,
    oneTimeRewards: [{ type: "newCharacter" }],
  },
  second: {
    id: "second",
    name: "The second dungeon",
    map: SECOND_DUNGEON_MAP,
    maxCharacters: 4,
    silverReward: 20,
    oneTimeRewards: [{ type: "newCharacter" }],
  },
  hallway: {
    id: "hallway",
    name: "The hallway",
    map: HALLWAY_MAP,
    maxCharacters: 4,
    silverReward: 30,
    oneTimeRewards: [{ type: "newCharacter" }],
  },
};

/** The dungeon a new game starts with, until its host chooses another. */
export const FIRST_DUNGEON: Dungeon = DUNGEONS.first;

export function isOnMap(map: DungeonMap, h: Hex): boolean {
  const key = hexKey(h);
  return map.hexes.some((m) => hexKey(m) === key);
}

/** Whether characters may be placed on `h`. Monsters never step on these hexes. */
export function isStartHex(map: DungeonMap, h: Hex): boolean {
  const key = hexKey(h);
  return map.startHexes.some((s) => hexKey(s) === key);
}

/**
 * Finds mistakes in a map's data, as a list of messages (empty when the map
 * is fine). Maps are written by hand, so the tests run this on every map.
 */
export function checkDungeonMap(map: DungeonMap): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const h of map.hexes) {
    if (seen.has(hexKey(h))) problems.push(`Hex ${hexKey(h)} is listed twice.`);
    seen.add(hexKey(h));
  }

  // No two things may start on the same hex: only one character can stand on a hex.
  const used = new Set<string>();
  const place = (h: Hex, what: string) => {
    if (!seen.has(hexKey(h))) problems.push(`${what} at ${hexKey(h)} is not on the map.`);
    if (used.has(hexKey(h))) problems.push(`${what} at ${hexKey(h)} overlaps something else.`);
    used.add(hexKey(h));
  };
  for (const h of map.startHexes) place(h, "Start hex");
  for (const m of map.monsters) {
    place(m.position, "Monster");
    if (!(m.type in MONSTER_TYPES)) problems.push(`Monster type "${m.type}" doesn't exist.`);
  }

  if (map.startHexes.length === 0) problems.push("The map has no start hexes.");

  // A dungeon is one connected map: every hex can be reached from every
  // other one, walking around the walls (design.md, Dungeons).
  const first = map.hexes[0];
  if (first) {
    const reachable = stepsFrom(first, (h) => seen.has(hexKey(h)));
    if (reachable.size < seen.size) problems.push("The map is not connected: some hexes can't be reached.");
  }
  return problems;
}
