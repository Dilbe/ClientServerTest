// Dungeon maps as data: which hexes exist, where characters enter, where the
// doors are, and where the monsters stand at the start (design.md, Dungeons).

import { hexKey, rectangle, fromOffset, toOffset, stepsFrom, type Hex } from "./hex.ts";
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
  /**
   * The doors, all closed at the start (design.md, Doors and sleeping
   * rooms). A door is a hex of the map too: closed it blocks movement like a
   * wall, open it is a normal hex.
   */
  doors: Hex[];
  /**
   * The monsters at the start of the game. The same map always starts the
   * same way. A monster in a room behind a closed door starts asleep (see
   * `sleepsAtStart`); that follows from the map, so it isn't data here. A
   * monster with an alert range starts on guard; that follows from its type.
   */
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
  doors: [],
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
  doors: [],
  monsters: [0, 2, 5, 7].map((row) => ({ type: "basic", position: fromOffset(5, row) })),
};

/**
 * The hallway: a hallway 2 columns wide and 3 rows long below the middle of a
 * room of 4 columns by 6 rows, without a door between them. Only the 2 hexes
 * at the far (bottom) end of the hallway are start hexes; 2 monsters stand in
 * the middle of the room's top row. Above that room, behind a door in the
 * middle of the wall, is a second room of 4 by 6 with 2 more monsters, asleep
 * until the door opens.
 *
 * In columns and rows, from the top: the back room is columns 0 to 3, rows 0
 * to 5; row 6 is the wall between the rooms, with the door in column 1; the
 * front room is columns 0 to 3, rows 7 to 12; the hallway is columns 1 and 2,
 * rows 13 to 15. Every other hex is wall.
 *
 * The door is in column 1, which is shifted half a hex down: that way it
 * touches 3 hexes of the front room (where the characters come from) and 1
 * of the back room. A door in column 2 would be the other way round.
 */
export const HALLWAY_MAP: DungeonMap = {
  hexes: [
    ...rectangle(4, 6),
    fromOffset(1, 6),
    ...rectangle(4, 6).map((h) => shift(h, 7)),
    ...[1, 2].flatMap((col) => [13, 14, 15].map((row) => fromOffset(col, row))),
  ],
  // From the top: odd columns are shifted half a hex down, so column 2's
  // bottom hex is a little higher than column 1's.
  startHexes: [fromOffset(2, 15), fromOffset(1, 15)],
  doors: [fromOffset(1, 6)],
  monsters: [
    // The front room: awake from the start.
    { type: "basic", position: fromOffset(1, 7) },
    { type: "basic", position: fromOffset(2, 7) },
    // The back room: asleep until the door opens.
    { type: "basic", position: fromOffset(1, 0) },
    { type: "basic", position: fromOffset(2, 0) },
  ],
};

/**
 * The Rat Warren (issue #83): three rooms of 4 columns by 4 rows in a row,
 * joined by open passages of one hex, without doors. The start hexes are 3
 * hexes in the top left corner of the first room; 8 rats are spread over
 * the rooms: 2 in the far corner of the first room and 3 in each of the
 * others. Without doors every rat is awake from the start.
 *
 * In columns and rows: the rooms are columns 0 to 3, 5 to 8 and 10 to 13,
 * all rows 0 to 3. The passages are one hex each: column 4, row 2, and
 * column 9, row 1. Each touches rows 1 and 2 of the rooms on either side,
 * the middle of the room's side: column 9 is odd, so shifted half a hex
 * down, which is why its passage is a row higher.
 *
 * The corner hex 0,0 only touches the two other start hexes, and monsters
 * never step on start hexes: a character standing there can't be attacked,
 * but can't attack anyone either.
 */
export const RAT_WARREN_MAP: DungeonMap = {
  hexes: [
    ...rectangle(4, 4),
    fromOffset(4, 2),
    ...rectangle(4, 4).map((h) => shiftColumns(h, 5)),
    fromOffset(9, 1),
    ...rectangle(4, 4).map((h) => shiftColumns(h, 10)),
  ],
  // From the top: column 1 is shifted half a hex down, so 1,0 is between 0,0 and 0,1.
  startHexes: [fromOffset(0, 0), fromOffset(1, 0), fromOffset(0, 1)],
  doors: [],
  monsters: [
    // The first room: the corner opposite the start hexes.
    fromOffset(3, 2),
    fromOffset(2, 3),
    // The middle room.
    fromOffset(6, 0),
    fromOffset(7, 2),
    fromOffset(6, 3),
    // The far room.
    fromOffset(11, 0),
    fromOffset(12, 2),
    fromOffset(11, 3),
  ].map((position) => ({ type: "rat", position })),
};

/**
 * The pillars of the Guard Post: hexes inside the room that aren't part of
 * the map, so they block movement like any wall. In columns and rows.
 */
const GUARD_POST_PILLARS = [fromOffset(2, 2), fromOffset(5, 3), fromOffset(7, 2), fromOffset(7, 3)];

/**
 * The Guard Post (issue #84): one room of 10 columns by 6 rows with pillars
 * in it. The start hexes are the middle 4 hexes of the left column. 3 guards
 * are spread over the room, each with 1 or 2 rats next to it.
 *
 * The guards stand at least 4 hexes from every start hex, so placing the
 * characters doesn't alert them, and at least 5 hexes from each other, so a
 * character next to one guard is out of the alert range of the others. The
 * rats are awake from the start.
 */
export const GUARD_POST_MAP: DungeonMap = {
  hexes: rectangle(10, 6).filter((h) => !GUARD_POST_PILLARS.some((p) => hexKey(p) === hexKey(h))),
  startHexes: [1, 2, 3, 4].map((row) => fromOffset(0, row)),
  doors: [],
  monsters: [
    // Near the start, top: a guard with 1 rat.
    { type: "guard", position: fromOffset(4, 1) },
    { type: "rat", position: fromOffset(5, 1) },
    // The bottom middle: a guard with 2 rats.
    { type: "guard", position: fromOffset(6, 5) },
    { type: "rat", position: fromOffset(5, 5) },
    { type: "rat", position: fromOffset(7, 5) },
    // The far end, top: a guard with 2 rats.
    { type: "guard", position: fromOffset(9, 1) },
    { type: "rat", position: fromOffset(8, 1) },
    { type: "rat", position: fromOffset(9, 2) },
  ],
};

/** The same hex, `rows` rows further down. */
function shift(h: Hex, rows: number): Hex {
  const { col, row } = toOffset(h);
  return fromOffset(col, row + rows);
}

/** The same hex, `cols` columns further right. */
function shiftColumns(h: Hex, cols: number): Hex {
  const { col, row } = toOffset(h);
  return fromOffset(col + cols, row);
}

/**
 * The fixed id of every dungeon. The database records which dungeons each
 * account has won by these ids, so **an id must never change or be reused
 * once it is in use**; rename the dungeon's `name` instead.
 */
export const DUNGEON_IDS = ["first", "second", "hallway", "warren", "guardPost"] as const;
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
  warren: {
    id: "warren",
    name: "The Rat Warren",
    map: RAT_WARREN_MAP,
    maxCharacters: 4,
    silverReward: 25,
    oneTimeRewards: [{ type: "newCharacter" }],
  },
  guardPost: {
    id: "guardPost",
    name: "The Guard Post",
    map: GUARD_POST_MAP,
    maxCharacters: 4,
    silverReward: 35,
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

/** Whether there is a door on `h`, open or closed. */
export function isDoor(map: DungeonMap, h: Hex): boolean {
  const key = hexKey(h);
  return map.doors.some((d) => hexKey(d) === key);
}

/**
 * The room `h` is in: every hex that can be reached from it without passing
 * a closed door, as `hexKey`s. Walls and closed doors are the room's edges;
 * characters and monsters don't count, because they move. With all doors
 * open, the whole map is one room.
 */
export function roomAround(map: DungeonMap, closedDoors: readonly Hex[], h: Hex): Set<string> {
  const closed = new Set(closedDoors.map(hexKey));
  const all = new Set(map.hexes.map(hexKey));
  const canEnter = (n: Hex) => all.has(hexKey(n)) && !closed.has(hexKey(n));
  return new Set(stepsFrom(h, canEnter).keys());
}

/**
 * Whether a monster starting on `h` starts asleep: when it is in a room
 * behind a closed door, so not in the room of any start hex (design.md,
 * Doors and sleeping rooms). All doors are closed at the start.
 */
export function sleepsAtStart(map: DungeonMap, h: Hex): boolean {
  return !map.startHexes.some((s) => roomAround(map, map.doors, s).has(hexKey(h)));
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
  for (const h of map.doors) place(h, "Door");
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
