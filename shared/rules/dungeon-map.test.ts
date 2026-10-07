import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ARCHERS_GALLERY_MAP,
  DUNGEON_IDS,
  DUNGEONS,
  FIRST_DUNGEON_MAP,
  GUARD_POST_MAP,
  HALLWAY_MAP,
  RAT_WARREN_MAP,
  SECOND_DUNGEON_MAP,
  TESSAS_LAIR_MAP,
  checkDungeonMap,
  isDoor,
  isOnMap,
  roomAround,
  sleepsAtStart,
  type DungeonMap,
} from "./dungeon-map.ts";
import { distance, fromOffset, hex, hexKey, toOffset } from "./hex.ts";
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
      { id: "guardPost", max: 4, silver: 35 },
      { id: "archersGallery", max: 4, silver: 50 },
      { id: "tessasLair", max: 4, silver: 75 },
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

test("the Guard Post: one room of 10 by 6 with pillars, 3 guards and their rats", () => {
  const map = GUARD_POST_MAP;
  const pillars = [fromOffset(2, 2), fromOffset(5, 3), fromOffset(7, 2), fromOffset(7, 3)];
  assert.equal(map.hexes.length, 10 * 6 - pillars.length);
  // The pillars are holes inside the room; the room's corners are there.
  for (const p of pillars) assert.ok(!isOnMap(map, p));
  for (const corner of [fromOffset(0, 0), fromOffset(9, 0), fromOffset(0, 5), fromOffset(9, 5)]) {
    assert.ok(isOnMap(map, corner));
  }
  assert.ok(!isOnMap(map, fromOffset(10, 0)));
  assert.deepEqual(map.doors, []);
  // The start hexes are the middle 4 of the left edge, from the top.
  assert.deepEqual(
    map.startHexes.map(toOffset),
    [1, 2, 3, 4].map((row) => ({ col: 0, row })),
  );
  // 3 guards, each with 1 or 2 rats next to it.
  const guards = map.monsters.filter((m) => m.type === "guard");
  const rats = map.monsters.filter((m) => m.type === "rat");
  assert.equal(guards.length, 3);
  assert.equal(guards.length + rats.length, map.monsters.length);
  assert.deepEqual(
    guards.map((g) => rats.filter((r) => distance(r.position, g.position) === 1).length),
    [1, 2, 2],
  );
  // Placing the characters doesn't alert a guard, and a character next to
  // one guard is out of reach of the others' alert range.
  const range = MONSTER_TYPES.guard.alertRange!;
  for (const g of guards) {
    for (const s of map.startHexes) assert.ok(distance(g.position, s) > range);
    for (const other of guards) {
      if (other !== g) assert.ok(distance(g.position, other.position) > range + 1);
    }
  }
});

test("the Archers' Gallery: a hallway into a wide room with archers, brutes and pillars, and a side room", () => {
  const map = ARCHERS_GALLERY_MAP;
  const pillars = [fromOffset(2, 2), fromOffset(3, 2), fromOffset(6, 2), fromOffset(7, 2)];
  // The room of 10 by 6 without its pillars, the hallway of 2 by 3, the door, the side room of 3 by 3.
  assert.equal(map.hexes.length, 10 * 6 - pillars.length + 2 * 3 + 1 + 3 * 3);
  for (const p of pillars) assert.ok(!isOnMap(map, p));
  // The start hexes are the bottom 4 hexes of the hallway, from the top.
  assert.deepEqual(map.startHexes.map(toOffset), [
    { col: 4, row: 7 },
    { col: 5, row: 7 },
    { col: 4, row: 8 },
    { col: 5, row: 8 },
  ]);
  assert.deepEqual(map.doors.map(toOffset), [{ col: 10, row: 2 }]);

  // Archers along the back wall, brutes in front of them, rats in the side room.
  const ofType = (type: string) => map.monsters.filter((m) => m.type === type).map((m) => toOffset(m.position));
  assert.ok(ofType("archer").every((h) => h.row === 0));
  assert.ok(ofType("brute").every((h) => h.row === 1));
  assert.ok(ofType("rat").every((h) => h.col >= 11));
  assert.deepEqual(
    [ofType("archer").length, ofType("brute").length, ofType("rat").length],
    [4, 2, 3],
  );
  assert.equal(ofType("archer").length + ofType("brute").length + ofType("rat").length, map.monsters.length);
  // Only the rats start asleep: they are behind the door.
  assert.deepEqual(
    map.monsters.map((m) => sleepsAtStart(map, m.position)),
    map.monsters.map((m) => m.type === "rat"),
  );
  // Entering the room is safe from the archers: every start hex is out of their range.
  for (const archer of map.monsters.filter((m) => m.type === "archer")) {
    for (const s of map.startHexes) assert.ok(distance(archer.position, s) > MONSTER_TYPES.archer.range);
  }
});

test("Tessa's Lair: a hallway into a room of 8 by 8 with Tessa, Barbara and Mark, all awake", () => {
  const map = TESSAS_LAIR_MAP;
  const pillar = fromOffset(6, 2);
  // The room of 8 by 8 without its pillar, and the hallway of 2 by 3.
  assert.equal(map.hexes.length, 8 * 8 - 1 + 2 * 3);
  assert.ok(!isOnMap(map, pillar));
  // The start hexes are the bottom 4 hexes of the hallway, from the top.
  assert.deepEqual(map.startHexes.map(toOffset), [
    { col: 4, row: 9 },
    { col: 3, row: 9 },
    { col: 4, row: 10 },
    { col: 3, row: 10 },
  ]);
  assert.deepEqual(map.doors, []);

  assert.deepEqual(
    map.monsters.map((m) => ({ type: m.type, ...toOffset(m.position) })),
    [
      // Tessa in the middle of the top wall.
      { type: "tessa", col: 4, row: 0 },
      // Barbara in front of her, on the left.
      { type: "barbara", col: 3, row: 1 },
      // Mark on the right, with the pillar right below him.
      { type: "mark", col: 6, row: 1 },
    ],
  );
  const mark = map.monsters[2]!.position;
  assert.equal(distance(mark, pillar), 1);
  // Everything is awake from the start: no doors, no guards.
  assert.ok(map.monsters.every((m) => !sleepsAtStart(map, m.position)));
  assert.ok(map.monsters.every((m) => MONSTER_TYPES[m.type].alertRange === undefined));
  // Entering the room is safe from Mark: every start hex is out of his range.
  for (const s of map.startHexes) assert.ok(distance(mark, s) > MONSTER_TYPES.mark.range);
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

test("the guard: 15 hit points, 2 damage, 1 action, 8 XP, alert range 3", () => {
  assert.deepEqual(MONSTER_TYPES.guard.stats, { actions: 1, movement: 1, attackDamage: 2, hitPoints: 15 });
  assert.equal(MONSTER_TYPES.guard.xp, 8);
  assert.equal(MONSTER_TYPES.guard.alertRange, 3);
  // The others are awake from the start (unless behind a closed door).
  assert.equal(MONSTER_TYPES.basic.alertRange, undefined);
  assert.equal(MONSTER_TYPES.rat.alertRange, undefined);
});

test("the archer: 5 hit points, 1 damage, 1 action, range 3, 6 XP, ranged targeting", () => {
  assert.deepEqual(MONSTER_TYPES.archer.stats, { actions: 1, movement: 1, attackDamage: 1, hitPoints: 5 });
  assert.equal(MONSTER_TYPES.archer.range, 3);
  assert.equal(MONSTER_TYPES.archer.xp, 6);
  assert.deepEqual(MONSTER_TYPES.archer.rangedTargetRules, ["fewestHitPoints", "nextOnTrack"]);
  // Without a target it can shoot, it moves as the normal rules say.
  assert.deepEqual(MONSTER_TYPES.archer.targetRules, MONSTER_TYPES.basic.targetRules);
});

test("the brute: 20 hit points, 3 damage, 1 action, 10 XP, normal targeting", () => {
  assert.deepEqual(MONSTER_TYPES.brute.stats, { actions: 1, movement: 1, attackDamage: 3, hitPoints: 20 });
  assert.equal(MONSTER_TYPES.brute.range, 1);
  assert.equal(MONSTER_TYPES.brute.xp, 10);
  assert.deepEqual(MONSTER_TYPES.brute.targetRules, MONSTER_TYPES.basic.targetRules);
  assert.equal(MONSTER_TYPES.brute.rangedTargetRules, undefined);
});

test("Tessa: 40 hit points, 3 damage, 2 actions, 25 XP, normal targeting, named", () => {
  assert.deepEqual(MONSTER_TYPES.tessa.stats, { actions: 2, movement: 1, attackDamage: 3, hitPoints: 40 });
  assert.equal(MONSTER_TYPES.tessa.range, 1);
  assert.equal(MONSTER_TYPES.tessa.xp, 25);
  assert.deepEqual(MONSTER_TYPES.tessa.targetRules, MONSTER_TYPES.basic.targetRules);
  assert.equal(MONSTER_TYPES.tessa.rangedTargetRules, undefined);
});

test("Barbara: 20 hit points, 2 damage, 1 action, 12 XP, normal targeting", () => {
  assert.deepEqual(MONSTER_TYPES.barbara.stats, { actions: 1, movement: 1, attackDamage: 2, hitPoints: 20 });
  assert.equal(MONSTER_TYPES.barbara.range, 1);
  assert.equal(MONSTER_TYPES.barbara.xp, 12);
  assert.deepEqual(MONSTER_TYPES.barbara.targetRules, MONSTER_TYPES.basic.targetRules);
  assert.equal(MONSTER_TYPES.barbara.rangedTargetRules, undefined);
});

test("Mark: 8 hit points, 2 damage, 1 action, range 3, 12 XP, ranged targeting like the archer", () => {
  assert.deepEqual(MONSTER_TYPES.mark.stats, { actions: 1, movement: 1, attackDamage: 2, hitPoints: 8 });
  assert.equal(MONSTER_TYPES.mark.range, 3);
  assert.equal(MONSTER_TYPES.mark.xp, 12);
  assert.deepEqual(MONSTER_TYPES.mark.targetRules, MONSTER_TYPES.archer.targetRules);
  assert.deepEqual(MONSTER_TYPES.mark.rangedTargetRules, MONSTER_TYPES.archer.rangedTargetRules);
});

test("only Tessa, Barbara and Mark are named monsters", () => {
  assert.deepEqual(
    Object.values(MONSTER_TYPES)
      .filter((t) => t.named)
      .map((t) => t.id),
    ["tessa", "barbara", "mark"],
  );
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
