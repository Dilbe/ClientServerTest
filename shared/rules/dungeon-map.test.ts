import { test } from "node:test";
import assert from "node:assert/strict";
import { FIRST_DUNGEON_MAP, checkDungeonMap, isOnMap, type DungeonMap } from "./dungeon-map.ts";
import { fromOffset, hex, toOffset } from "./hex.ts";
import { MONSTER_TYPES, baseStats } from "./stats.ts";

test("the first dungeon has no mistakes in its data", () => {
  assert.deepEqual(checkDungeonMap(FIRST_DUNGEON_MAP), []);
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

test("first version stats: move 1, attack for 1, 10 hit points", () => {
  assert.deepEqual(baseStats(), { movement: 1, attackDamage: 1, hitPoints: 10 });
  assert.deepEqual(MONSTER_TYPES.basic.stats, { movement: 1, attackDamage: 1, hitPoints: 10 });
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
