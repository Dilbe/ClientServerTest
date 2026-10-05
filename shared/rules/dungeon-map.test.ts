import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DUNGEON_IDS,
  DUNGEONS,
  FIRST_DUNGEON_MAP,
  HALLWAY_MAP,
  SECOND_DUNGEON_MAP,
  checkDungeonMap,
  isOnMap,
  type DungeonMap,
} from "./dungeon-map.ts";
import { fromOffset, hex, toOffset } from "./hex.ts";
import { MONSTER_TYPES, baseStats } from "./stats.ts";

test("no dungeon has mistakes in its data", () => {
  for (const id of DUNGEON_IDS) {
    const dungeon = DUNGEONS[id];
    assert.equal(dungeon.id, id);
    assert.deepEqual(checkDungeonMap(dungeon.map), [], dungeon.name);
    assert.ok(dungeon.maxCharacters >= 1, dungeon.name);
  }
});

test("the dungeon stats of every dungeon", () => {
  assert.deepEqual(
    DUNGEON_IDS.map((id) => ({ id, max: DUNGEONS[id].maxCharacters, silver: DUNGEONS[id].silverReward })),
    [
      { id: "first", max: 4, silver: 10 },
      { id: "second", max: 4, silver: 20 },
      { id: "hallway", max: 4, silver: 30 },
    ],
  );
});

test("the first dungeon is one room of 6 columns by 4 rows", () => {
  const map = FIRST_DUNGEON_MAP;
  assert.equal(map.hexes.length, 24);
  const offsets = map.hexes.map(toOffset);
  assert.equal(Math.max(...offsets.map((o) => o.col)), 5);
  assert.equal(Math.max(...offsets.map((o) => o.row)), 3);
  assert.ok(isOnMap(map, fromOffset(0, 0)));
  assert.ok(isOnMap(map, fromOffset(5, 3)));
  assert.ok(!isOnMap(map, fromOffset(6, 0)));
  assert.ok(!isOnMap(map, fromOffset(0, 4)));
  assert.ok(!isOnMap(map, hex(0, -1)));
});

test("the start hexes are the left column, from the top", () => {
  assert.deepEqual(FIRST_DUNGEON_MAP.startHexes.map(toOffset), [
    { col: 0, row: 0 },
    { col: 0, row: 1 },
    { col: 0, row: 2 },
    { col: 0, row: 3 },
  ]);
});

test("2 monsters stand on the middle two hexes of the right column", () => {
  assert.deepEqual(
    FIRST_DUNGEON_MAP.monsters.map((m) => ({ type: m.type, ...toOffset(m.position) })),
    [
      { type: "basic", col: 5, row: 1 },
      { type: "basic", col: 5, row: 2 },
    ],
  );
});

test("the second dungeon is 6 by 8, starts in the middle of the left column, monsters on the right", () => {
  const map = SECOND_DUNGEON_MAP;
  assert.equal(map.hexes.length, 48);
  assert.ok(isOnMap(map, fromOffset(5, 7)));
  assert.ok(!isOnMap(map, fromOffset(0, 8)));
  assert.deepEqual(
    map.startHexes.map(toOffset),
    [2, 3, 4, 5].map((row) => ({ col: 0, row })),
  );
  assert.deepEqual(
    map.monsters.map((m) => ({ type: m.type, ...toOffset(m.position) })),
    [0, 2, 5, 7].map((row) => ({ type: "basic", col: 5, row })),
  );
});

test("the hallway: a 2 by 3 hallway below the middle of a 4 by 6 room", () => {
  const map = HALLWAY_MAP;
  assert.equal(map.hexes.length, 4 * 6 + 2 * 3);
  // The room.
  assert.ok(isOnMap(map, fromOffset(0, 0)));
  assert.ok(isOnMap(map, fromOffset(3, 5)));
  // The hallway, and the walls on either side of it.
  assert.ok(isOnMap(map, fromOffset(1, 8)));
  assert.ok(isOnMap(map, fromOffset(2, 6)));
  assert.ok(!isOnMap(map, fromOffset(0, 6)));
  assert.ok(!isOnMap(map, fromOffset(3, 6)));
  assert.ok(!isOnMap(map, fromOffset(1, 9)));
  // Only the far end of the hallway, from the top: column 2 sits half a hex higher.
  assert.deepEqual(map.startHexes.map(toOffset), [
    { col: 2, row: 8 },
    { col: 1, row: 8 },
  ]);
  assert.deepEqual(
    map.monsters.map((m) => ({ type: m.type, ...toOffset(m.position) })),
    [
      { type: "basic", col: 1, row: 0 },
      { type: "basic", col: 2, row: 0 },
    ],
  );
});

test("first version stats: 1 action, move 1, attack for 1, 10 hit points", () => {
  assert.deepEqual(baseStats(), { actions: 1, movement: 1, attackDamage: 1, hitPoints: 10 });
  assert.deepEqual(MONSTER_TYPES.basic.stats, { actions: 1, movement: 1, attackDamage: 1, hitPoints: 3 });
});

test("checkDungeonMap finds mistakes", () => {
  const bad: DungeonMap = {
    hexes: [hex(0, 0), hex(0, 1), hex(0, 1)],
    startHexes: [hex(0, 0), hex(5, 5)],
    monsters: [{ type: "basic", position: hex(0, 0) }],
  };
  assert.deepEqual(checkDungeonMap(bad), [
    "Hex 0,1 is listed twice.",
    "Start hex at 5,5 is not on the map.",
    "Monster at 0,0 overlaps something else.",
  ]);
  assert.deepEqual(checkDungeonMap({ hexes: [hex(0, 0)], startHexes: [], monsters: [] }), [
    "The map has no start hexes.",
  ]);
});

test("checkDungeonMap finds a map that isn't connected", () => {
  // Two hexes with a gap between them: 0,0 and 0,2 are not neighbours.
  const islands: DungeonMap = { hexes: [hex(0, 0), hex(0, 2)], startHexes: [hex(0, 0)], monsters: [] };
  assert.deepEqual(checkDungeonMap(islands), ["The map is not connected: some hexes can't be reached."]);
  // Filling the gap joins them.
  assert.deepEqual(checkDungeonMap({ ...islands, hexes: [...islands.hexes, hex(0, 1)] }), []);
});
