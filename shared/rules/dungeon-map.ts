// Dungeon maps as data: which hexes exist, where characters enter, where the
// doors are, and where the monsters stand at the start (design.md, Dungeons).

import type { ClassId } from "./advancement.ts";
import type { DifficultyId } from "./difficulties.ts";
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

/**
 * The pillars of the Archers' Gallery, in columns and rows: two pairs a little
 * in front of the archers, left and right of the way up from the hallway.
 */
const ARCHERS_GALLERY_PILLARS = [fromOffset(2, 2), fromOffset(3, 2), fromOffset(6, 2), fromOffset(7, 2)];

/**
 * The Archers' Gallery (issue #85): a hallway leading up into a wide room
 * with archers along the back wall, brutes in front of them and pillars for
 * cover. A door on the right leads to a small side room with sleeping rats.
 *
 * In columns and rows: the room is columns 0 to 9, rows 0 to 5, without the
 * pillars. The hallway is columns 4 and 5, rows 6 to 8, below the middle of
 * the room; its bottom 4 hexes are the start hexes. The door is column 10,
 * row 2, the only hex of that column: column 10 is even, so it touches rows
 * 1 and 2 of the columns on either side. The side room is columns 11 to 13,
 * rows 1 to 3.
 *
 * The archers stand on the back (top) row, more than their range from every
 * start hex, so they have to come closer before they can shoot.
 */
export const ARCHERS_GALLERY_MAP: DungeonMap = {
  hexes: [
    ...rectangle(10, 6).filter((h) => !ARCHERS_GALLERY_PILLARS.some((p) => hexKey(p) === hexKey(h))),
    ...[4, 5].flatMap((col) => [6, 7, 8].map((row) => fromOffset(col, row))),
    fromOffset(10, 2),
    ...rectangle(3, 3).map((h) => shift(shiftColumns(h, 11), 1)),
  ],
  // From the top: column 5 is shifted half a hex down.
  startHexes: [fromOffset(4, 7), fromOffset(5, 7), fromOffset(4, 8), fromOffset(5, 8)],
  doors: [fromOffset(10, 2)],
  monsters: [
    // Along the back wall.
    { type: "archer", position: fromOffset(1, 0) },
    { type: "archer", position: fromOffset(3, 0) },
    { type: "archer", position: fromOffset(6, 0) },
    { type: "archer", position: fromOffset(8, 0) },
    // In front of them, in the middle.
    { type: "brute", position: fromOffset(4, 1) },
    { type: "brute", position: fromOffset(5, 1) },
    // The side room: asleep until the door opens.
    { type: "rat", position: fromOffset(12, 1) },
    { type: "rat", position: fromOffset(13, 2) },
    { type: "rat", position: fromOffset(12, 3) },
  ],
};

/** The pillar of Tessa's Lair, in columns and rows: Mark's cover, between him and the hallway. */
const TESSAS_LAIR_PILLAR = fromOffset(6, 2);

/**
 * Tessa's Lair (issue #116), the boss dungeon: a hallway leading up into a
 * room with Tessa and her two minions. No doors and no guards, so everything
 * is awake from the start.
 *
 * In columns and rows: the room is columns 0 to 7, rows 0 to 7, without the
 * pillar. The hallway is columns 3 and 4, rows 8 to 10, below the middle of
 * the room; its bottom 4 hexes are the start hexes.
 *
 * Tessa stands in the middle of the top wall, Barbara in front of her on the
 * left, and Mark on the right, behind the pillar: it hides the hexes below
 * him, so he has to come out of cover to shoot. Every start hex is out of
 * his range.
 */
export const TESSAS_LAIR_MAP: DungeonMap = {
  hexes: [
    ...rectangle(8, 8).filter((h) => hexKey(h) !== hexKey(TESSAS_LAIR_PILLAR)),
    ...[3, 4].flatMap((col) => [8, 9, 10].map((row) => fromOffset(col, row))),
  ],
  // From the top: column 3 is shifted half a hex down.
  startHexes: [fromOffset(4, 9), fromOffset(3, 9), fromOffset(4, 10), fromOffset(3, 10)],
  doors: [],
  monsters: [
    { type: "tessa", position: fromOffset(4, 0) },
    { type: "barbara", position: fromOffset(3, 1) },
    { type: "mark", position: fromOffset(6, 1) },
  ],
};

/**
 * The Kennels (issue #180), the first 6-character dungeon: a hallway leading
 * up into the middle of a big room with wolves along the far wall, and a
 * door in each side wall to a kennel with 3 sleeping wolves.
 *
 * In columns and rows: the left kennel is columns 0 to 3, rows 1 to 4. Its
 * door is column 4, row 3, the only hex of that column: column 4 is even,
 * so it touches rows 2 and 3 of the columns on either side, the middle of
 * the kennel and of the room. The big room is columns 5 to 12, rows 0 to 5.
 * The right door is column 13, row 2: column 13 is odd, so shifted half a
 * hex down, which is why its row is one higher to touch the same rows 2
 * and 3. The right kennel is columns 14 to 17, rows 1 to 4. The hallway is
 * columns 8 and 9, rows 6 to 8, below the middle of the room; all 6 of its
 * hexes are start hexes.
 *
 * Monsters never step on start hexes, so they can only attack the top 2
 * hexes of the hallway: like the corner of the Rat Warren, a character
 * further back can't be attacked, but can't attack anyone either.
 */
export const KENNELS_MAP: DungeonMap = {
  hexes: [
    ...rectangle(4, 4).map((h) => shift(h, 1)),
    fromOffset(4, 3),
    ...rectangle(8, 6).map((h) => shiftColumns(h, 5)),
    fromOffset(13, 2),
    ...rectangle(4, 4).map((h) => shift(shiftColumns(h, 14), 1)),
    ...[8, 9].flatMap((col) => [6, 7, 8].map((row) => fromOffset(col, row))),
  ],
  // From the top: column 9 is shifted half a hex down.
  startHexes: [6, 7, 8].flatMap((row) => [fromOffset(8, row), fromOffset(9, row)]),
  doors: [fromOffset(4, 3), fromOffset(13, 2)],
  monsters: [
    // Along the far (top) wall of the big room: awake from the start.
    fromOffset(6, 0),
    fromOffset(8, 0),
    fromOffset(9, 0),
    fromOffset(11, 0),
    // The left kennel, against its far wall: asleep until the door opens.
    fromOffset(0, 2),
    fromOffset(0, 3),
    fromOffset(1, 2),
    // The right kennel, against its far wall: asleep until the door opens.
    fromOffset(17, 2),
    fromOffset(17, 3),
    fromOffset(16, 3),
  ].map((position) => ({ type: "wolf", position })),
};

/**
 * The pillars of the Barracks, in columns and rows: cover from the
 * crossbowmen. One near the top and one near the bottom of the hall, close
 * to the start, and two pairs further in, across the middle of the hall.
 */
const BARRACKS_PILLARS = [
  fromOffset(2, 6),
  fromOffset(2, 9),
  fromOffset(6, 7),
  fromOffset(6, 8),
  fromOffset(9, 7),
  fromOffset(9, 8),
];

/**
 * The Barracks (issue #181): one long hall with pillars and 3 sentries, each
 * with a crossbowman behind it. A door in the top wall leads to an armoury
 * with an ogre and 2 crossbowmen, a door in the bottom wall to a dormitory
 * with 4 wolves, all asleep until their door opens.
 *
 * In columns and rows: the armoury is columns 7 to 10, rows 0 to 3. Its door
 * is column 9, row 4, the only hex of that row: column 9 is odd, so shifted
 * half a hex down, which makes it touch 1 hex of the armoury and 3 of the
 * hall. The hall is columns 0 to 11, rows 5 to 10, without the pillars; its
 * left column is the 6 start hexes. The dormitory's door is column 6, row
 * 11: column 6 is even, so the other way round, it touches 3 hexes of the
 * hall and 1 of the dormitory. The dormitory is columns 3 to 8, rows 12 to
 * 15.
 *
 * Like the guards of the Guard Post, the sentries stand more than their
 * alert range from every start hex, and more than one hex further than
 * that from each other, so a character next to one sentry is out of the
 * alert range of the others. Every start hex is out of every crossbowman's
 * range too. The crossbowmen are awake.
 */
export const BARRACKS_MAP: DungeonMap = {
  hexes: [
    ...rectangle(4, 4).map((h) => shiftColumns(h, 7)),
    fromOffset(9, 4),
    ...rectangle(12, 6)
      .map((h) => shift(h, 5))
      .filter((h) => !BARRACKS_PILLARS.some((p) => hexKey(p) === hexKey(h))),
    fromOffset(6, 11),
    ...rectangle(6, 4).map((h) => shift(shiftColumns(h, 3), 12)),
  ],
  startHexes: [5, 6, 7, 8, 9, 10].map((row) => fromOffset(0, row)),
  doors: [fromOffset(9, 4), fromOffset(6, 11)],
  monsters: [
    // The hall: near the start, top: a sentry with its crossbowman behind it.
    { type: "sentry", position: fromOffset(4, 6) },
    { type: "crossbowman", position: fromOffset(5, 6) },
    // The bottom middle, near the dormitory's door.
    { type: "sentry", position: fromOffset(7, 9) },
    { type: "crossbowman", position: fromOffset(8, 9) },
    // The far end, top, near the armoury's door.
    { type: "sentry", position: fromOffset(10, 6) },
    { type: "crossbowman", position: fromOffset(11, 6) },
    // The armoury: the ogre in front, the crossbowmen against the far wall. Asleep.
    { type: "ogre", position: fromOffset(9, 2) },
    { type: "crossbowman", position: fromOffset(8, 0) },
    { type: "crossbowman", position: fromOffset(10, 0) },
    // The dormitory, against its far wall. Asleep.
    ...[4, 5, 6, 7].map((col) => ({ type: "wolf" as const, position: fromOffset(col, 15) })),
  ],
};

/**
 * The pillars of the Crypt, in columns and rows: the 4 tombs, two pairs
 * between the ogres and the crossbowmen, each 2 columns in from a side wall.
 */
const CRYPT_PILLARS = [fromOffset(7, 2), fromOffset(7, 3), fromOffset(10, 2), fromOffset(10, 3)];

/**
 * The Crypt (issue #182): a small entrance below a crypt with 2 ogres in
 * front and 3 crossbowmen behind them, and a door in each side wall of the
 * crypt to a tomb with a sentry and 2 wolves. The entrance has no monsters;
 * everything else is asleep until its door opens, so the party decides when
 * the fight starts.
 *
 * In columns and rows: the left tomb is columns 0 to 3, rows 0 to 5. Its
 * door is column 4, row 3, the only hex of that column: column 4 is even, so
 * it touches rows 2 and 3 of the columns on either side, the middle of the
 * tomb and of the crypt. The crypt is columns 5 to 12, rows 0 to 5, without
 * the pillars. The right door is column 13, row 2: column 13 is odd, so
 * shifted half a hex down, which is why its row is one higher to touch the
 * same rows 2 and 3. The right tomb is columns 14 to 17, rows 0 to 5.
 *
 * The entrance's door is column 9, row 6, the only hex of that row: column
 * 9 is odd, so it touches 3 hexes of the entrance and 1 of the crypt, and
 * the crypt's monsters come through one at a time. The entrance is columns
 * 8 to 10, rows 7 to 9; its bottom 2 rows are the start hexes, and the row
 * in front of the door is free, for the party to line up before opening it.
 *
 * Doors don't wake a monster on guard, so the sentries keep waiting in their
 * tombs. Each stands against its tomb's far wall, more than its alert range
 * from the tomb's door: opening the door doesn't alert it, but stepping
 * into the tomb does.
 */
export const CRYPT_MAP: DungeonMap = {
  hexes: [
    ...rectangle(4, 6),
    fromOffset(4, 3),
    ...rectangle(8, 6)
      .map((h) => shiftColumns(h, 5))
      .filter((h) => !CRYPT_PILLARS.some((p) => hexKey(p) === hexKey(h))),
    fromOffset(13, 2),
    ...rectangle(4, 6).map((h) => shiftColumns(h, 14)),
    fromOffset(9, 6),
    ...rectangle(3, 3).map((h) => shift(shiftColumns(h, 8), 7)),
  ],
  // From the top: column 9 is shifted half a hex down.
  startHexes: [8, 9].flatMap((row) => [fromOffset(8, row), fromOffset(10, row), fromOffset(9, row)]),
  doors: [fromOffset(9, 6), fromOffset(4, 3), fromOffset(13, 2)],
  monsters: [
    // The crypt: the ogres in front, near the door, the crossbowmen against the far wall.
    { type: "ogre", position: fromOffset(8, 4) },
    { type: "ogre", position: fromOffset(10, 4) },
    { type: "crossbowman", position: fromOffset(7, 0) },
    { type: "crossbowman", position: fromOffset(9, 0) },
    { type: "crossbowman", position: fromOffset(11, 0) },
    // The left tomb: the sentry against the far wall, a wolf in each far corner.
    { type: "sentry", position: fromOffset(0, 2) },
    { type: "wolf", position: fromOffset(0, 0) },
    { type: "wolf", position: fromOffset(0, 5) },
    // The right tomb, the same the other way round.
    { type: "sentry", position: fromOffset(17, 2) },
    { type: "wolf", position: fromOffset(17, 0) },
    { type: "wolf", position: fromOffset(17, 5) },
  ],
};

/**
 * The pillars of the Gauntlet, in columns and rows: a pair in the middle of
 * the last room, between its door and the crossbowmen at the back.
 */
const GAUNTLET_PILLARS = [fromOffset(23, 2), fromOffset(23, 3)];

/**
 * The Gauntlet (issue #183): four rooms of 6 by 6 in a row, each harder than
 * the last. Only the first room is awake; the others sleep until their door
 * opens, so the party can take a breath between rooms, but the hit points
 * lost in one room still count in the next.
 *
 * In columns and rows: the rooms are columns 0 to 5, 7 to 12, 14 to 19 and
 * 21 to 26, all rows 0 to 5. The doors are one hex each, in the middle of
 * the shared wall: column 6, row 3; column 13, row 2; and column 20, row 3.
 * Each touches rows 2 and 3 of the rooms on either side: column 13 is odd,
 * so shifted half a hex down, which is why its door is a row higher (as in
 * the Rat Warren).
 *
 * The start hexes are the first room's left column. Its 2 crossbowmen stand
 * in the far corners, 5 columns away, so out of their range (4) of every
 * start hex; its 3 wolves stand in front of them.
 *
 * Doors don't wake a monster on guard, so the sentries keep waiting in their
 * room. Each stands more than its alert range from the door of its room:
 * opening the door doesn't alert it, but walking up to it does.
 */
export const GAUNTLET_MAP: DungeonMap = {
  hexes: [
    ...rectangle(6, 6),
    fromOffset(6, 3),
    ...rectangle(6, 6).map((h) => shiftColumns(h, 7)),
    fromOffset(13, 2),
    ...rectangle(6, 6).map((h) => shiftColumns(h, 14)),
    fromOffset(20, 3),
    ...rectangle(6, 6)
      .map((h) => shiftColumns(h, 21))
      .filter((h) => !GAUNTLET_PILLARS.some((p) => hexKey(p) === hexKey(h))),
  ],
  startHexes: [0, 1, 2, 3, 4, 5].map((row) => fromOffset(0, row)),
  doors: [fromOffset(6, 3), fromOffset(13, 2), fromOffset(20, 3)],
  monsters: [
    // Room 1, awake: the wolves in front, the crossbowmen in the far corners.
    { type: "wolf", position: fromOffset(4, 1) },
    { type: "wolf", position: fromOffset(4, 2) },
    { type: "wolf", position: fromOffset(4, 4) },
    { type: "crossbowman", position: fromOffset(5, 0) },
    { type: "crossbowman", position: fromOffset(5, 5) },
    // Room 2: the ogres in front, the crossbowmen against the far wall.
    { type: "ogre", position: fromOffset(9, 1) },
    { type: "ogre", position: fromOffset(9, 4) },
    { type: "crossbowman", position: fromOffset(12, 1) },
    { type: "crossbowman", position: fromOffset(12, 4) },
    // Room 3: the sentries in the middle, a wolf in each corner.
    { type: "sentry", position: fromOffset(17, 1) },
    { type: "sentry", position: fromOffset(17, 4) },
    { type: "wolf", position: fromOffset(14, 0) },
    { type: "wolf", position: fromOffset(14, 5) },
    { type: "wolf", position: fromOffset(19, 0) },
    { type: "wolf", position: fromOffset(19, 5) },
    // Room 4: the ogres in front of the pillars, the sentry behind them, the
    // crossbowmen in the far corners.
    { type: "ogre", position: fromOffset(22, 1) },
    { type: "ogre", position: fromOffset(22, 4) },
    { type: "sentry", position: fromOffset(25, 2) },
    { type: "crossbowman", position: fromOffset(26, 0) },
    { type: "crossbowman", position: fromOffset(26, 5) },
  ],
};

/**
 * The pillars of Lotte's Hall, in columns and rows, all in the throne room:
 * Mark's cover right below him, as in Tessa's Lair, and two more as cover
 * for the party, one on each side of the way up from the door.
 */
const LOTTES_HALL_PILLARS = [fromOffset(11, 2), fromOffset(6, 4), fromOffset(11, 5)];

/**
 * Lotte's Hall (issue #184), the second boss dungeon: a hallway leading up
 * into an antechamber with a side room behind a door on each side, and from
 * the antechamber a door up to a gate room, and from there a door up to the
 * throne room with Lotte and her guards Barbara and Mark.
 *
 * In columns and rows, from the top: the throne room is columns 4 to 13,
 * rows 0 to 7, without the pillars. Its door is column 9, row 8, the only
 * hex of that row. The gate room is columns 6 to 11, rows 9 to 12, and its
 * door to the antechamber is column 9, row 13, the only hex of that row too.
 * Column 9 is odd, so shifted half a hex down: each of these doors touches 3
 * hexes of the room below it, where the party comes from, and 1 of the room
 * above it, which lets one monster at a time through.
 *
 * The antechamber is columns 5 to 12, rows 14 to 19, with the side rooms as
 * in the Kennels: the left side room is columns 0 to 3, rows 15 to 18, its
 * door column 4, row 17; the right door is column 13, row 16 (column 13 is
 * odd, so a row higher to touch the same rows 16 and 17), the right side
 * room columns 14 to 17, rows 15 to 18. The hallway is columns 8 and 9, rows
 * 20 to 22, below the middle of the antechamber; all 6 of its hexes are
 * start hexes.
 *
 * The antechamber is awake; its crossbowmen stand in the far corners, out of
 * their range of every start hex. The rest sleeps until its door opens.
 * Doors don't wake a monster on guard, so the sentries keep waiting: the
 * side rooms' against the far wall, more than their alert range from the
 * door, and the gate room's on either side of the throne room door, more
 * than their alert range from the antechamber's door. Lotte stands 8 hexes
 * from the throne room door, so with her 2 actions she needs a few turns to
 * reach it.
 */
export const LOTTES_HALL_MAP: DungeonMap = {
  hexes: [
    ...rectangle(10, 8)
      .map((h) => shiftColumns(h, 4))
      .filter((h) => !LOTTES_HALL_PILLARS.some((p) => hexKey(p) === hexKey(h))),
    fromOffset(9, 8),
    ...rectangle(6, 4).map((h) => shift(shiftColumns(h, 6), 9)),
    fromOffset(9, 13),
    ...rectangle(4, 4).map((h) => shift(h, 15)),
    fromOffset(4, 17),
    ...rectangle(8, 6).map((h) => shift(shiftColumns(h, 5), 14)),
    fromOffset(13, 16),
    ...rectangle(4, 4).map((h) => shift(shiftColumns(h, 14), 15)),
    ...[8, 9].flatMap((col) => [20, 21, 22].map((row) => fromOffset(col, row))),
  ],
  // From the top: column 9 is shifted half a hex down.
  startHexes: [20, 21, 22].flatMap((row) => [fromOffset(8, row), fromOffset(9, row)]),
  doors: [fromOffset(4, 17), fromOffset(13, 16), fromOffset(9, 13), fromOffset(9, 8)],
  monsters: [
    // The antechamber, awake: the crossbowmen in the far corners, the wolves
    // along the far wall between them, the ogres in front.
    { type: "crossbowman", position: fromOffset(5, 14) },
    { type: "crossbowman", position: fromOffset(12, 14) },
    { type: "wolf", position: fromOffset(7, 14) },
    { type: "wolf", position: fromOffset(10, 14) },
    { type: "ogre", position: fromOffset(7, 16) },
    { type: "ogre", position: fromOffset(10, 16) },
    // The left side room: the sentry against the far wall, a crossbowman in each far corner.
    { type: "sentry", position: fromOffset(0, 16) },
    { type: "crossbowman", position: fromOffset(0, 15) },
    { type: "crossbowman", position: fromOffset(0, 18) },
    // The right side room, the same the other way round.
    { type: "sentry", position: fromOffset(17, 16) },
    { type: "crossbowman", position: fromOffset(17, 15) },
    { type: "crossbowman", position: fromOffset(17, 18) },
    // The gate room: on guard on either side of the throne room door.
    { type: "sentry", position: fromOffset(8, 9) },
    { type: "sentry", position: fromOffset(10, 9) },
    // The throne room: Lotte in the middle of the far wall, Barbara in front
    // of her on the left, Mark on the right with his pillar right below him.
    { type: "lotte", position: fromOffset(9, 0) },
    { type: "lottesBarbara", position: fromOffset(8, 1) },
    { type: "lottesMark", position: fromOffset(11, 1) },
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
export const DUNGEON_IDS = ["first", "second", "hallway", "warren", "guardPost", "archersGallery", "tessasLair", "kennels", "barracks", "crypt", "gauntlet", "lottesHall"] as const;
export type DungeonId = (typeof DUNGEON_IDS)[number];

/**
 * A reward a player only gets on their very first win of a dungeon on a
 * difficulty (design.md, Rewards). Each type of reward is one shape here,
 * told apart by `type`, so more types can be added later; the schema is
 * `oneTimeReward` in shared/protocol.ts.
 *
 * - `newCharacter`: a new character of this class, rank and level, with the
 *   account's next number, like a bought one. It starts with the XP its
 *   level needs and no upgrades. The level can't be above the rank's max
 *   level; a test checks every reward in DUNGEONS.
 */
export type OneTimeReward = { type: "newCharacter"; class: ClassId; rank: number; level: number };

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
  /**
   * What a player gets on their very first win of this dungeon on each
   * difficulty, on top of the silver. Data, like the rest: changing a
   * reward needs no code.
   */
  oneTimeRewards: Record<DifficultyId, OneTimeReward[]>;
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
    oneTimeRewards: {
      normal: [{ type: "newCharacter", class: "adventurer", rank: 1, level: 1 }],
      hard: [{ type: "newCharacter", class: "adventurer", rank: 2, level: 1 }],
      heroic: [{ type: "newCharacter", class: "adventurer", rank: 3, level: 1 }],
    },
  },
  second: {
    id: "second",
    name: "The second dungeon",
    map: SECOND_DUNGEON_MAP,
    maxCharacters: 4,
    silverReward: 20,
    oneTimeRewards: {
      normal: [{ type: "newCharacter", class: "adventurer", rank: 1, level: 1 }],
      hard: [{ type: "newCharacter", class: "adventurer", rank: 2, level: 1 }],
      heroic: [{ type: "newCharacter", class: "adventurer", rank: 3, level: 1 }],
    },
  },
  hallway: {
    id: "hallway",
    name: "The hallway",
    map: HALLWAY_MAP,
    maxCharacters: 4,
    silverReward: 30,
    oneTimeRewards: {
      normal: [{ type: "newCharacter", class: "adventurer", rank: 1, level: 1 }],
      hard: [{ type: "newCharacter", class: "adventurer", rank: 2, level: 1 }],
      heroic: [{ type: "newCharacter", class: "adventurer", rank: 3, level: 1 }],
    },
  },
  warren: {
    id: "warren",
    name: "The Rat Warren",
    map: RAT_WARREN_MAP,
    maxCharacters: 4,
    silverReward: 25,
    oneTimeRewards: {
      normal: [{ type: "newCharacter", class: "adventurer", rank: 1, level: 1 }],
      hard: [{ type: "newCharacter", class: "adventurer", rank: 2, level: 1 }],
      heroic: [{ type: "newCharacter", class: "adventurer", rank: 3, level: 1 }],
    },
  },
  guardPost: {
    id: "guardPost",
    name: "The Guard Post",
    map: GUARD_POST_MAP,
    maxCharacters: 4,
    silverReward: 35,
    oneTimeRewards: {
      normal: [{ type: "newCharacter", class: "adventurer", rank: 1, level: 1 }],
      hard: [{ type: "newCharacter", class: "adventurer", rank: 2, level: 1 }],
      heroic: [{ type: "newCharacter", class: "adventurer", rank: 3, level: 1 }],
    },
  },
  archersGallery: {
    id: "archersGallery",
    name: "The Archers' Gallery",
    map: ARCHERS_GALLERY_MAP,
    maxCharacters: 4,
    silverReward: 50,
    oneTimeRewards: {
      normal: [{ type: "newCharacter", class: "adventurer", rank: 1, level: 1 }],
      hard: [{ type: "newCharacter", class: "adventurer", rank: 2, level: 1 }],
      heroic: [{ type: "newCharacter", class: "adventurer", rank: 3, level: 1 }],
    },
  },
  tessasLair: {
    id: "tessasLair",
    name: "Tessa's Lair",
    map: TESSAS_LAIR_MAP,
    maxCharacters: 4,
    silverReward: 75,
    oneTimeRewards: {
      normal: [{ type: "newCharacter", class: "adventurer", rank: 1, level: 1 }],
      hard: [{ type: "newCharacter", class: "adventurer", rank: 2, level: 1 }],
      heroic: [{ type: "newCharacter", class: "adventurer", rank: 3, level: 1 }],
    },
  },
  kennels: {
    id: "kennels",
    name: "The Kennels",
    map: KENNELS_MAP,
    maxCharacters: 6,
    silverReward: 90,
    oneTimeRewards: {
      normal: [{ type: "newCharacter", class: "adventurer", rank: 1, level: 1 }],
      hard: [{ type: "newCharacter", class: "adventurer", rank: 2, level: 1 }],
      heroic: [{ type: "newCharacter", class: "adventurer", rank: 3, level: 1 }],
    },
  },
  barracks: {
    id: "barracks",
    name: "The Barracks",
    map: BARRACKS_MAP,
    maxCharacters: 6,
    silverReward: 105,
    oneTimeRewards: {
      normal: [{ type: "newCharacter", class: "adventurer", rank: 1, level: 1 }],
      hard: [{ type: "newCharacter", class: "adventurer", rank: 2, level: 1 }],
      heroic: [{ type: "newCharacter", class: "adventurer", rank: 3, level: 1 }],
    },
  },
  crypt: {
    id: "crypt",
    name: "The Crypt",
    map: CRYPT_MAP,
    maxCharacters: 6,
    silverReward: 120,
    oneTimeRewards: {
      normal: [{ type: "newCharacter", class: "adventurer", rank: 1, level: 1 }],
      hard: [{ type: "newCharacter", class: "adventurer", rank: 2, level: 1 }],
      heroic: [{ type: "newCharacter", class: "adventurer", rank: 3, level: 1 }],
    },
  },
  gauntlet: {
    id: "gauntlet",
    name: "The Gauntlet",
    map: GAUNTLET_MAP,
    maxCharacters: 6,
    silverReward: 140,
    oneTimeRewards: {
      normal: [{ type: "newCharacter", class: "adventurer", rank: 1, level: 1 }],
      hard: [{ type: "newCharacter", class: "adventurer", rank: 2, level: 1 }],
      heroic: [{ type: "newCharacter", class: "adventurer", rank: 3, level: 1 }],
    },
  },
  lottesHall: {
    id: "lottesHall",
    name: "Lotte's Hall",
    map: LOTTES_HALL_MAP,
    maxCharacters: 6,
    silverReward: 175,
    oneTimeRewards: {
      normal: [{ type: "newCharacter", class: "adventurer", rank: 1, level: 1 }],
      hard: [{ type: "newCharacter", class: "adventurer", rank: 2, level: 1 }],
      heroic: [{ type: "newCharacter", class: "adventurer", rank: 3, level: 1 }],
    },
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
