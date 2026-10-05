import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DUNGEON_IDS,
  DUNGEONS,
  FIRST_DUNGEON_MAP,
  HALLWAY_MAP,
  RAT_WARREN_MAP,
  SECOND_DUNGEON_MAP,
  checkDungeonMap,
  isDoor,
  isOnMap,
  roomAround,
  sleepsAtStart,
  type DungeonMap,
} from "./dungeon-map.ts";
import { fromOffset, hex, hexKey, toOffset } from "./hex.ts";
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
      { id: "warren", max: 4, silver: 25 },
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

test("the hallway: a 2 by 3 hallway below the middle of a 4 by 6 room, a door to a second room", () => {
  const map = HALLWAY_MAP;
  assert.equal(map.hexes.length, 4 * 6 + 1 + 4 * 6 + 2 * 3);
  // The back room.
  assert.ok(isOnMap(map, fromOffset(0, 0)));
  assert.ok(isOnMap(map, fromOffset(3, 5)));
  // The wall between the rooms, with the door in column 1.
  assert.ok(!isOnMap(map, fromOffset(0, 6)));
  assert.ok(isOnMap(map, fromOffset(1, 6)));
  assert.ok(!isOnMap(map, fromOffset(2, 6)));
  assert.ok(!isOnMap(map, fromOffset(3, 6)));
  assert.deepEqual(map.doors.map(toOffset), [{ col: 1, row: 6 }]);
  // The front room.
  assert.ok(isOnMap(map, fromOffset(0, 7)));
  assert.ok(isOnMap(map, fromOffset(3, 12)));
  // The hallway, and the walls on either side of it.
  assert.ok(isOnMap(map, fromOffset(1, 15)));
  assert.ok(isOnMap(map, fromOffset(2, 13)));
  assert.ok(!isOnMap(map, fromOffset(0, 13)));
  assert.ok(!isOnMap(map, fromOffset(3, 13)));
  assert.ok(!isOnMap(map, fromOffset(1, 16)));
  // Only the far end of the hallway, from the top: column 2 sits half a hex higher.
  assert.deepEqual(map.startHexes.map(toOffset), [
    { col: 2, row: 15 },
    { col: 1, row: 15 },
  ]);
  // 2 monsters in the middle of the top row of each room.
  assert.deepEqual(
    map.monsters.map((m) => ({ type: m.type, ...toOffset(m.position) })),
    [
      { type: "basic", col: 1, row: 7 },
      { type: "basic", col: 2, row: 7 },
      { type: "basic", col: 1, row: 0 },
      { type: "basic", col: 2, row: 0 },
    ],
  );
});

test("the Rat Warren: three 4 by 4 rooms in a row, joined by one-hex passages", () => {
  const map = RAT_WARREN_MAP;
  assert.equal(map.hexes.length, 3 * 4 * 4 + 2);
  assert.deepEqual(map.doors, []);
  // The rooms.
  for (const firstCol of [0, 5, 10]) {
    assert.ok(isOnMap(map, fromOffset(firstCol, 0)));
    assert.ok(isOnMap(map, fromOffset(firstCol + 3, 3)));
    assert.ok(!isOnMap(map, fromOffset(firstCol, 4)));
  }
  assert.ok(!isOnMap(map, fromOffset(14, 0)));
  // The passages: one hex each, the rest of their column is wall.
  assert.deepEqual(
    map.hexes.map(toOffset).filter((o) => o.col === 4 || o.col === 9),
    [
      { col: 4, row: 2 },
      { col: 9, row: 1 },
    ],
  );
  // 3 start hexes in the top left corner, from the top.
  assert.deepEqual(map.startHexes.map(toOffset), [
    { col: 0, row: 0 },
    { col: 1, row: 0 },
    { col: 0, row: 1 },
  ]);
  // 8 rats: 2 in the first room, 3 in each of the others, all awake.
  assert.ok(map.monsters.every((m) => m.type === "rat"));
  const room = (m: { position: ReturnType<typeof fromOffset> }) => Math.floor(toOffset(m.position).col / 5);
  assert.deepEqual(map.monsters.map(room), [0, 0, 1, 1, 1, 2, 2, 2]);
  assert.ok(map.monsters.every((m) => !sleepsAtStart(map, m.position)));
});

test("in the hallway, only the monsters of the back room start asleep", () => {
  assert.deepEqual(
    HALLWAY_MAP.monsters.map((m) => sleepsAtStart(HALLWAY_MAP, m.position)),
    [false, false, true, true],
  );
  // Without a door, nobody sleeps.
  assert.ok(FIRST_DUNGEON_MAP.monsters.every((m) => !sleepsAtStart(FIRST_DUNGEON_MAP, m.position)));
});

test("a room ends at walls and closed doors", () => {
  const map = HALLWAY_MAP;
  const door = fromOffset(1, 6);
  const front = roomAround(map, [door], fromOffset(1, 15));
  assert.equal(front.size, 4 * 6 + 2 * 3);
  assert.ok(!front.has(hexKey(door)));
  assert.ok(!front.has(hexKey(fromOffset(1, 0))));
  // With the door open, it is all one room.
  assert.equal(roomAround(map, [], fromOffset(1, 15)).size, map.hexes.length);
  assert.ok(isDoor(map, door));
  assert.ok(!isDoor(map, fromOffset(1, 7)));
});

test("first version stats: 1 action, move 1, attack for 1, 10 hit points", () => {
  assert.deepEqual(baseStats(), { actions: 1, movement: 1, attackDamage: 1, hitPoints: 10 });
  assert.deepEqual(MONSTER_TYPES.basic.stats, { actions: 1, movement: 1, attackDamage: 1, hitPoints: 3 });
});

test("the rat: 3 hit points, 1 damage, 2 actions, 2 XP, the same targeting as the first monster type", () => {
  assert.deepEqual(MONSTER_TYPES.rat.stats, { actions: 2, movement: 1, attackDamage: 1, hitPoints: 3 });
  assert.equal(MONSTER_TYPES.rat.xp, 2);
  assert.deepEqual(MONSTER_TYPES.rat.targetRules, MONSTER_TYPES.basic.targetRules);
});

test("every monster type has its own label", () => {
  const labels = Object.values(MONSTER_TYPES).map((t) => t.label);
  assert.equal(new Set(labels).size, labels.length);
});

test("checkDungeonMap finds mistakes", () => {
  const bad: DungeonMap = {
    hexes: [hex(0, 0), hex(0, 1), hex(0, 1)],
    startHexes: [hex(0, 0), hex(5, 5)],
    doors: [hex(0, 0)],
    monsters: [{ type: "basic", position: hex(0, 0) }],
  };
  assert.deepEqual(checkDungeonMap(bad), [
    "Hex 0,1 is listed twice.",
    "Start hex at 5,5 is not on the map.",
    "Door at 0,0 overlaps something else.",
    "Monster at 0,0 overlaps something else.",
  ]);
  assert.deepEqual(checkDungeonMap({ hexes: [hex(0, 0)], startHexes: [], doors: [], monsters: [] }), [
    "The map has no start hexes.",
  ]);
});

test("checkDungeonMap finds a map that isn't connected", () => {
  // Two hexes with a gap between them: 0,0 and 0,2 are not neighbours.
  const islands: DungeonMap = { hexes: [hex(0, 0), hex(0, 2)], startHexes: [hex(0, 0)], doors: [], monsters: [] };
  assert.deepEqual(checkDungeonMap(islands), ["The map is not connected: some hexes can't be reached."]);
  // Filling the gap joins them.
  assert.deepEqual(checkDungeonMap({ ...islands, hexes: [...islands.hexes, hex(0, 1)] }), []);
});
