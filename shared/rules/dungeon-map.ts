// Dungeon maps as data: which hexes exist, where characters enter, and where
// the monsters stand at the start (design.md, Dungeons).

import { hexKey, rectangle, fromOffset, type Hex } from "./hex.ts";
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

export const DUNGEON_IDS = ["first", "second"] as const;
export type DungeonId = (typeof DUNGEON_IDS)[number];

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
}

/**
 * Every dungeon, in the order the lobby offers them. Adding a dungeon means
 * adding its id to DUNGEON_IDS and an entry here (design.md, Built to grow).
 */
export const DUNGEONS: Record<DungeonId, Dungeon> = {
  first: { id: "first", name: "The first dungeon", map: FIRST_DUNGEON_MAP, maxCharacters: 4, silverReward: 10 },
  second: { id: "second", name: "The second dungeon", map: SECOND_DUNGEON_MAP, maxCharacters: 4, silverReward: 20 },
};

/** The dungeon a new game starts with, until its host chooses another. */
export const FIRST_DUNGEON: Dungeon = DUNGEONS.first;

export function isOnMap(map: DungeonMap, h: Hex): boolean {
  const key = hexKey(h);
  return map.hexes.some((m) => hexKey(m) === key);
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
  return problems;
}
