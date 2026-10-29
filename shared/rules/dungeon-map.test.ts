import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ARCHERS_GALLERY_MAP,
  BARRACKS_MAP,
  CRYPT_MAP,
  DUNGEON_IDS,
  DUNGEONS,
  FIRST_DUNGEON_MAP,
  GAUNTLET_MAP,
  GUARD_POST_MAP,
  HALLWAY_MAP,
  KENNELS_MAP,
  LOTTES_HALL_MAP,
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
import { distance, fromOffset, hex, hexKey, toOffset, type Hex } from "./hex.ts";
import { MAX_RANK, MIN_RANK, maxLevel } from "./advancement.ts";
import { CLASS_IDS } from "./classes.ts";
import { DIFFICULTY_IDS } from "./difficulties.ts";
import { MONSTER_TYPES } from "./stats.ts";
import { baseStats } from "./classes.ts";

test("no dungeon has mistakes in its data", () => {
  for (const id of DUNGEON_IDS) {
    const dungeon = DUNGEONS[id];
    assert.equal(dungeon.id, id);
    assert.deepEqual(checkDungeonMap(dungeon.map), [], dungeon.name);
    assert.ok(dungeon.maxCharacters >= 1, dungeon.name);
  }
});

test("every one-time reward can be given", () => {
  for (const id of DUNGEON_IDS) {
    for (const difficulty of DIFFICULTY_IDS) {
      for (const reward of DUNGEONS[id].oneTimeRewards[difficulty]) {
        const where = `${DUNGEONS[id].name} on ${difficulty}`;
        switch (reward.type) {
          case "newCharacter":
            assert.ok(CLASS_IDS.includes(reward.class), `${where}: no class ${reward.class}`);
            assert.ok(Number.isInteger(reward.rank), where);
            assert.ok(reward.rank >= MIN_RANK && reward.rank <= MAX_RANK, `${where}: no rank ${reward.rank}`);
            assert.ok(Number.isInteger(reward.level), where);
            assert.ok(
              reward.level >= 1 && reward.level <= maxLevel("adventurer", reward.rank),
              `${where}: rank ${reward.rank} can't be level ${reward.level}`,
            );
            break;
          case "village":
            break;
        }
      }
    }
  }
});

test("the first-win rewards: a level 1 adventurer of rank 1 on Normal, 2 on Hard, 3 on Heroic (issue #155)", () => {
  for (const id of DUNGEON_IDS) {
    // Tessa's Lair also gives the village on Normal (issue #295).
    const village = id === "tessasLair" ? [{ type: "village" }] : [];
    assert.deepEqual(
      DUNGEONS[id].oneTimeRewards,
      {
        normal: [{ type: "newCharacter", class: "adventurer", rank: 1, level: 1 }, ...village],
        hard: [{ type: "newCharacter", class: "adventurer", rank: 2, level: 1 }],
        heroic: [{ type: "newCharacter", class: "adventurer", rank: 3, level: 1 }],
      },
      DUNGEONS[id].name,
    );
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
      { id: "kennels", max: 6, silver: 90 },
      { id: "barracks", max: 6, silver: 105 },
      { id: "crypt", max: 6, silver: 120 },
      { id: "gauntlet", max: 6, silver: 140 },
      { id: "lottesHall", max: 6, silver: 175 },
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

test("the Kennels: a hallway into a room of 8 by 6, with a kennel of 4 by 4 behind a door on each side", () => {
  const map = KENNELS_MAP;
  // The two kennels, the two doors, the big room and the hallway of 2 by 3.
  assert.equal(map.hexes.length, 2 * 4 * 4 + 2 + 8 * 6 + 2 * 3);
  // The start hexes are all 6 hexes of the hallway, from the top.
  assert.deepEqual(map.startHexes.map(toOffset), [
    { col: 8, row: 6 },
    { col: 9, row: 6 },
    { col: 8, row: 7 },
    { col: 9, row: 7 },
    { col: 8, row: 8 },
    { col: 9, row: 8 },
  ]);
  assert.deepEqual(map.doors.map(toOffset), [
    { col: 4, row: 3 },
    { col: 13, row: 2 },
  ]);

  // With the doors closed there are 3 rooms: the big room with the hallway, and the two kennels.
  const big = roomAround(map, map.doors, map.startHexes[0]!);
  const left = roomAround(map, map.doors, fromOffset(0, 1));
  const right = roomAround(map, map.doors, fromOffset(17, 1));
  assert.deepEqual([big.size, left.size, right.size], [8 * 6 + 2 * 3, 4 * 4, 4 * 4]);
  // Each door is in the middle of a side wall: it touches 2 hexes of the room and 2 of its kennel.
  const [leftDoor, rightDoor] = map.doors;
  for (const [door, kennel] of [
    [leftDoor!, left],
    [rightDoor!, right],
  ] as const) {
    const touching = map.hexes.filter((h) => distance(h, door) === 1).map(hexKey);
    assert.equal(touching.filter((k) => big.has(k)).length, 2);
    assert.equal(touching.filter((k) => kennel.has(k)).length, 2);
  }

  // Only wolves: 4 along the top wall of the big room, awake, and 3 in each kennel, asleep.
  assert.ok(map.monsters.every((m) => m.type === "wolf"));
  const awake = map.monsters.filter((m) => !sleepsAtStart(map, m.position)).map((m) => m.position);
  assert.equal(awake.length, 4);
  assert.ok(awake.every((h) => toOffset(h).row === 0 && big.has(hexKey(h))));
  assert.equal(map.monsters.filter((m) => left.has(hexKey(m.position))).length, 3);
  assert.equal(map.monsters.filter((m) => right.has(hexKey(m.position))).length, 3);
  assert.equal(map.monsters.length, 4 + 3 + 3);
});

test("the wolf: 6 hit points, 2 damage, 2 actions, 10 XP, the same targeting as the rat", () => {
  assert.deepEqual(MONSTER_TYPES.wolf.stats, { actions: 2, movement: 1, attackDamage: 2, hitPoints: 6 });
  assert.equal(MONSTER_TYPES.wolf.label, "W");
  assert.equal(MONSTER_TYPES.wolf.range, 1);
  assert.equal(MONSTER_TYPES.wolf.xp, 10);
  assert.equal(MONSTER_TYPES.wolf.alertRange, undefined);
  assert.deepEqual(MONSTER_TYPES.wolf.targetRules, MONSTER_TYPES.rat.targetRules);
  assert.equal(MONSTER_TYPES.wolf.rangedTargetRules, undefined);
});

test("the Barracks: a hall of 12 by 6 with pillars, an armoury of 4 by 4 above it and a dormitory of 6 by 4 below", () => {
  const map = BARRACKS_MAP;
  const pillars = [fromOffset(2, 6), fromOffset(2, 9), fromOffset(6, 7), fromOffset(6, 8), fromOffset(9, 7), fromOffset(9, 8)];
  // The armoury, its door, the hall without its pillars, the dormitory's door and the dormitory.
  assert.equal(map.hexes.length, 4 * 4 + 1 + 12 * 6 - pillars.length + 1 + 6 * 4);
  for (const p of pillars) assert.ok(!isOnMap(map, p));
  // The start hexes are all 6 hexes of the hall's left column, from the top.
  assert.deepEqual(
    map.startHexes.map(toOffset),
    [5, 6, 7, 8, 9, 10].map((row) => ({ col: 0, row })),
  );
  assert.deepEqual(map.doors.map(toOffset), [
    { col: 9, row: 4 },
    { col: 6, row: 11 },
  ]);

  // With the doors closed there are 3 rooms: the hall, the armoury and the dormitory.
  const hall = roomAround(map, map.doors, map.startHexes[0]!);
  const armoury = roomAround(map, map.doors, fromOffset(7, 0));
  const dormitory = roomAround(map, map.doors, fromOffset(3, 12));
  assert.deepEqual([hall.size, armoury.size, dormitory.size], [12 * 6 - pillars.length, 4 * 4, 6 * 4]);
  // One door in the hall's top wall and one in its bottom wall: each touches the hall and its own room.
  const [armouryDoor, dormitoryDoor] = map.doors;
  for (const [door, room] of [
    [armouryDoor!, armoury],
    [dormitoryDoor!, dormitory],
  ] as const) {
    const touching = map.hexes.filter((h) => distance(h, door) === 1).map(hexKey);
    assert.ok(touching.some((k) => hall.has(k)));
    assert.ok(touching.some((k) => room.has(k)));
    assert.ok(touching.every((k) => hall.has(k) || room.has(k)));
  }

  const inRoom = (room: Set<string>) =>
    map.monsters
      .filter((m) => room.has(hexKey(m.position)))
      .map((m) => m.type)
      .sort();
  assert.deepEqual(inRoom(hall), ["crossbowman", "crossbowman", "crossbowman", "sentry", "sentry", "sentry"]);
  assert.deepEqual(inRoom(armoury), ["crossbowman", "crossbowman", "ogre"]);
  assert.deepEqual(inRoom(dormitory), ["wolf", "wolf", "wolf", "wolf"]);
  assert.equal(map.monsters.length, 6 + 3 + 4);
  // Only the hall is awake (the sentries on guard); the armoury and the dormitory sleep.
  assert.deepEqual(
    map.monsters.map((m) => sleepsAtStart(map, m.position)),
    map.monsters.map((m) => !hall.has(hexKey(m.position))),
  );

  // Each sentry has its crossbowman right behind it: next to it, further from the start.
  const sentries = map.monsters.filter((m) => m.type === "sentry").map((m) => m.position);
  const hallCrossbowmen = map.monsters
    .filter((m) => m.type === "crossbowman" && hall.has(hexKey(m.position)))
    .map((m) => m.position);
  assert.deepEqual(
    sentries.map((s) => hallCrossbowmen.filter((c) => distance(s, c) === 1 && toOffset(c).col > toOffset(s).col).length),
    [1, 1, 1],
  );

  // Placing the characters wakes no sentry and is safe from every crossbowman.
  const alertRange = MONSTER_TYPES.sentry.alertRange!;
  for (const s of map.startHexes) {
    for (const sentry of sentries) assert.ok(distance(sentry, s) > alertRange);
    for (const m of map.monsters.filter((m) => m.type === "crossbowman")) {
      assert.ok(distance(m.position, s) > MONSTER_TYPES.crossbowman.range);
    }
  }
  // A character next to one sentry is out of the alert range of the others.
  for (const a of sentries) {
    for (const b of sentries) if (a !== b) assert.ok(distance(a, b) > alertRange + 1);
  }
});

test("the sentry: 25 hit points, 3 damage, 1 action, 26 XP, alert range 3, like the guard", () => {
  assert.deepEqual(MONSTER_TYPES.sentry.stats, { actions: 1, movement: 1, attackDamage: 3, hitPoints: 25 });
  assert.equal(MONSTER_TYPES.sentry.label, "S");
  assert.equal(MONSTER_TYPES.sentry.range, 1);
  assert.equal(MONSTER_TYPES.sentry.xp, 26);
  assert.equal(MONSTER_TYPES.sentry.alertRange, 3);
  assert.deepEqual(MONSTER_TYPES.sentry.targetRules, MONSTER_TYPES.guard.targetRules);
  assert.equal(MONSTER_TYPES.sentry.rangedTargetRules, undefined);
});

test("the crossbowman: 8 hit points, 2 damage, 1 action, range 4, 16 XP, ranged targeting like the archer", () => {
  assert.deepEqual(MONSTER_TYPES.crossbowman.stats, { actions: 1, movement: 1, attackDamage: 2, hitPoints: 8 });
  assert.equal(MONSTER_TYPES.crossbowman.label, "C");
  assert.equal(MONSTER_TYPES.crossbowman.range, 4);
  assert.equal(MONSTER_TYPES.crossbowman.xp, 16);
  assert.equal(MONSTER_TYPES.crossbowman.alertRange, undefined);
  assert.deepEqual(MONSTER_TYPES.crossbowman.targetRules, MONSTER_TYPES.archer.targetRules);
  assert.deepEqual(MONSTER_TYPES.crossbowman.rangedTargetRules, MONSTER_TYPES.archer.rangedTargetRules);
});

test("the ogre: 30 hit points, 4 damage, 1 action, 30 XP, normal targeting like the brute", () => {
  assert.deepEqual(MONSTER_TYPES.ogre.stats, { actions: 1, movement: 1, attackDamage: 4, hitPoints: 30 });
  assert.equal(MONSTER_TYPES.ogre.label, "O");
  assert.equal(MONSTER_TYPES.ogre.range, 1);
  assert.equal(MONSTER_TYPES.ogre.xp, 30);
  assert.equal(MONSTER_TYPES.ogre.alertRange, undefined);
  assert.deepEqual(MONSTER_TYPES.ogre.targetRules, MONSTER_TYPES.brute.targetRules);
  assert.equal(MONSTER_TYPES.ogre.rangedTargetRules, undefined);
});

test("the Crypt: an entrance of 3 by 3 below a crypt of 8 by 6 with pillars, and a tomb of 4 by 6 on each side", () => {
  const map = CRYPT_MAP;
  const pillars = [fromOffset(7, 2), fromOffset(7, 3), fromOffset(10, 2), fromOffset(10, 3)];
  // The tombs, the crypt without its pillars, the entrance and the 3 doors.
  assert.equal(map.hexes.length, 2 * 4 * 6 + 8 * 6 - pillars.length + 3 * 3 + 3);
  for (const p of pillars) assert.ok(!isOnMap(map, p));
  // The start hexes are the entrance's bottom 2 rows, from the top.
  assert.deepEqual(map.startHexes.map(toOffset), [
    { col: 8, row: 8 },
    { col: 10, row: 8 },
    { col: 9, row: 8 },
    { col: 8, row: 9 },
    { col: 10, row: 9 },
    { col: 9, row: 9 },
  ]);
  assert.deepEqual(map.doors.map(toOffset), [
    { col: 9, row: 6 },
    { col: 4, row: 3 },
    { col: 13, row: 2 },
  ]);

  // With the doors closed there are 4 rooms.
  const entrance = roomAround(map, map.doors, map.startHexes[0]!);
  const crypt = roomAround(map, map.doors, fromOffset(5, 0));
  const leftTomb = roomAround(map, map.doors, fromOffset(0, 0));
  const rightTomb = roomAround(map, map.doors, fromOffset(17, 0));
  assert.deepEqual(
    [entrance.size, crypt.size, leftTomb.size, rightTomb.size],
    [3 * 3, 8 * 6 - pillars.length, 4 * 6, 4 * 6],
  );
  // Each door touches only its two rooms. The entrance's door touches 3
  // hexes of the entrance, the hexes in front of the start hexes, and 1 of
  // the crypt; the side doors touch the middle 2 rows of the crypt and the tomb.
  const [entranceDoor, leftDoor, rightDoor] = map.doors;
  const touching = (door: Hex, room: Set<string>) =>
    map.hexes.filter((h) => distance(h, door) === 1 && room.has(hexKey(h))).map(toOffset);
  assert.equal(map.hexes.filter((h) => distance(h, entranceDoor!) === 1).length, 4);
  assert.deepEqual(touching(entranceDoor!, entrance), [8, 9, 10].map((col) => ({ col, row: 7 })));
  assert.deepEqual(touching(entranceDoor!, crypt), [{ col: 9, row: 5 }]);
  for (const [door, tomb] of [
    [leftDoor!, leftTomb],
    [rightDoor!, rightTomb],
  ] as const) {
    assert.equal(map.hexes.filter((h) => distance(h, door) === 1).length, 4);
    assert.deepEqual(touching(door, crypt).map((h) => h.row), [2, 3]);
    assert.deepEqual(touching(door, tomb).map((h) => h.row), [2, 3]);
  }
  for (const s of map.startHexes) assert.ok(distance(s, entranceDoor!) > 1);

  const inRoom = (room: Set<string>) =>
    map.monsters
      .filter((m) => room.has(hexKey(m.position)))
      .map((m) => m.type)
      .sort();
  assert.deepEqual(inRoom(entrance), []);
  assert.deepEqual(inRoom(crypt), ["crossbowman", "crossbowman", "crossbowman", "ogre", "ogre"]);
  assert.deepEqual(inRoom(leftTomb), ["sentry", "wolf", "wolf"]);
  assert.deepEqual(inRoom(rightTomb), ["sentry", "wolf", "wolf"]);
  assert.equal(map.monsters.length, 5 + 3 + 3);
  // Every monster is behind a door, so asleep.
  for (const m of map.monsters) assert.ok(sleepsAtStart(map, m.position));

  // The ogres stand in front, closer to the entrance's door than every crossbowman.
  const fromDoor = (type: string) =>
    map.monsters.filter((m) => m.type === type && crypt.has(hexKey(m.position))).map((m) => distance(m.position, entranceDoor!));
  assert.ok(Math.max(...fromDoor("ogre")) < Math.min(...fromDoor("crossbowman")));

  // A character who opens a tomb's door, from the crypt, doesn't alert its
  // sentry, and neither does one standing in the open door.
  const alertRange = MONSTER_TYPES.sentry.alertRange!;
  for (const [door, tomb] of [
    [leftDoor!, leftTomb],
    [rightDoor!, rightTomb],
  ] as const) {
    const sentry = map.monsters.find((m) => m.type === "sentry" && tomb.has(hexKey(m.position)))!;
    for (const h of [door, ...map.hexes.filter((h) => distance(h, door) === 1 && crypt.has(hexKey(h)))]) {
      assert.ok(distance(sentry.position, h) > alertRange);
    }
  }
});

test("the Gauntlet: four rooms of 6 by 6 in a row, each joined to the next by a door", () => {
  const map = GAUNTLET_MAP;
  const pillars = [fromOffset(23, 2), fromOffset(23, 3)];
  // The 4 rooms without the pillars, and the 3 doors.
  assert.equal(map.hexes.length, 4 * 6 * 6 - pillars.length + 3);
  for (const p of pillars) assert.ok(!isOnMap(map, p));
  // The start hexes are all 6 hexes of the first room's left column, from the top.
  assert.deepEqual(
    map.startHexes.map(toOffset),
    [0, 1, 2, 3, 4, 5].map((row) => ({ col: 0, row })),
  );
  assert.deepEqual(map.doors.map(toOffset), [
    { col: 6, row: 3 },
    { col: 13, row: 2 },
    { col: 20, row: 3 },
  ]);

  // With the doors closed there are 4 rooms.
  const rooms = [0, 7, 14, 21].map((col) => roomAround(map, map.doors, fromOffset(col, 0)));
  assert.deepEqual(
    rooms.map((r) => r.size),
    [6 * 6, 6 * 6, 6 * 6, 6 * 6 - pillars.length],
  );
  assert.ok(rooms[0]!.has(hexKey(map.startHexes[0]!)));
  // Each door touches the middle 2 rows of the room before it and of the room after it, and nothing else.
  map.doors.forEach((door, i) => {
    const touching = map.hexes.filter((h) => distance(h, door) === 1);
    assert.equal(touching.length, 4);
    for (const room of [rooms[i]!, rooms[i + 1]!]) {
      assert.deepEqual(
        touching.filter((h) => room.has(hexKey(h))).map((h) => toOffset(h).row),
        [2, 3],
      );
    }
  });

  const inRoom = (room: Set<string>) =>
    map.monsters
      .filter((m) => room.has(hexKey(m.position)))
      .map((m) => m.type)
      .sort();
  assert.deepEqual(rooms.map(inRoom), [
    ["crossbowman", "crossbowman", "wolf", "wolf", "wolf"],
    ["crossbowman", "crossbowman", "ogre", "ogre"],
    ["sentry", "sentry", "wolf", "wolf", "wolf", "wolf"],
    ["crossbowman", "crossbowman", "ogre", "ogre", "sentry"],
  ]);
  assert.equal(map.monsters.length, 5 + 4 + 6 + 5);
  // Only the first room is awake; the others sleep until their door opens.
  assert.deepEqual(
    map.monsters.map((m) => sleepsAtStart(map, m.position)),
    map.monsters.map((m) => !rooms[0]!.has(hexKey(m.position))),
  );

  // Placing the characters is safe from the first room's crossbowmen.
  for (const m of map.monsters.filter((m) => m.type === "crossbowman" && rooms[0]!.has(hexKey(m.position)))) {
    for (const s of map.startHexes) assert.ok(distance(m.position, s) > MONSTER_TYPES.crossbowman.range);
  }

  // A character who opens a door, from the room before it, doesn't alert a
  // sentry behind it, and neither does one standing in the open door.
  const alertRange = MONSTER_TYPES.sentry.alertRange!;
  map.doors.forEach((door, i) => {
    const sentries = map.monsters.filter((m) => m.type === "sentry" && rooms[i + 1]!.has(hexKey(m.position)));
    const opening = [door, ...map.hexes.filter((h) => distance(h, door) === 1 && rooms[i]!.has(hexKey(h)))];
    for (const sentry of sentries) {
      for (const h of opening) assert.ok(distance(sentry.position, h) > alertRange);
    }
  });
});

test("Lotte's Hall: a hallway into an antechamber with two side rooms, a gate room above it, and the throne room above that", () => {
  const map = LOTTES_HALL_MAP;
  const pillars = [fromOffset(11, 2), fromOffset(6, 4), fromOffset(11, 5)];
  // The throne room without its pillars, the gate room, the antechamber, the two side rooms, the hallway and the 4 doors.
  assert.equal(map.hexes.length, 10 * 8 - pillars.length + 6 * 4 + 8 * 6 + 2 * 4 * 4 + 2 * 3 + 4);
  for (const p of pillars) assert.ok(!isOnMap(map, p));
  // The start hexes are all 6 hexes of the hallway, from the top.
  assert.deepEqual(
    map.startHexes.map(toOffset),
    [20, 21, 22].flatMap((row) => [
      { col: 8, row },
      { col: 9, row },
    ]),
  );
  assert.deepEqual(map.doors.map(toOffset), [
    { col: 4, row: 17 },
    { col: 13, row: 16 },
    { col: 9, row: 13 },
    { col: 9, row: 8 },
  ]);

  // With the doors closed there are 5 rooms; the hallway is part of the antechamber.
  const antechamber = roomAround(map, map.doors, map.startHexes[0]!);
  const left = roomAround(map, map.doors, fromOffset(0, 15));
  const right = roomAround(map, map.doors, fromOffset(17, 15));
  const gate = roomAround(map, map.doors, fromOffset(6, 9));
  const throne = roomAround(map, map.doors, fromOffset(4, 0));
  assert.deepEqual(
    [antechamber.size, left.size, right.size, gate.size, throne.size],
    [8 * 6 + 2 * 3, 4 * 4, 4 * 4, 6 * 4, 10 * 8 - pillars.length],
  );
  // Each door touches only its two rooms: the side doors the middle 2 rows
  // of the antechamber and of their side room; the other two 3 hexes of the
  // room below them, where the party comes from, and 1 of the room above.
  const [leftDoor, rightDoor, gateDoor, throneDoor] = map.doors;
  const touching = (door: Hex, room: Set<string>) =>
    map.hexes.filter((h) => distance(h, door) === 1 && room.has(hexKey(h))).map(toOffset);
  for (const [door, room] of [
    [leftDoor!, left],
    [rightDoor!, right],
  ] as const) {
    assert.equal(map.hexes.filter((h) => distance(h, door) === 1).length, 4);
    assert.deepEqual(touching(door, antechamber).map((h) => h.row), [16, 17]);
    assert.deepEqual(touching(door, room).map((h) => h.row), [16, 17]);
  }
  for (const [door, below, above] of [
    [gateDoor!, antechamber, gate],
    [throneDoor!, gate, throne],
  ] as const) {
    assert.equal(map.hexes.filter((h) => distance(h, door) === 1).length, 4);
    assert.equal(touching(door, below).length, 3);
    assert.equal(touching(door, above).length, 1);
  }

  const inRoom = (room: Set<string>) =>
    map.monsters
      .filter((m) => room.has(hexKey(m.position)))
      .map((m) => m.type)
      .sort();
  assert.deepEqual(inRoom(antechamber), ["crossbowman", "crossbowman", "ogre", "ogre", "wolf", "wolf"]);
  assert.deepEqual(inRoom(left), ["crossbowman", "crossbowman", "sentry"]);
  assert.deepEqual(inRoom(right), ["crossbowman", "crossbowman", "sentry"]);
  assert.deepEqual(inRoom(gate), ["sentry", "sentry"]);
  assert.deepEqual(inRoom(throne), ["lotte", "lottesBarbara", "lottesMark"]);
  assert.equal(map.monsters.length, 6 + 3 + 3 + 2 + 3);
  // Only the antechamber is awake; the other rooms sleep until their door opens.
  assert.deepEqual(
    map.monsters.map((m) => sleepsAtStart(map, m.position)),
    map.monsters.map((m) => !antechamber.has(hexKey(m.position))),
  );

  // Placing the characters is safe from the antechamber's crossbowmen.
  for (const m of map.monsters.filter((m) => m.type === "crossbowman" && antechamber.has(hexKey(m.position)))) {
    for (const s of map.startHexes) assert.ok(distance(m.position, s) > MONSTER_TYPES.crossbowman.range);
  }

  // A character who opens a door, from the room before it, doesn't alert a
  // sentry behind it, and neither does one standing in the open door.
  const alertRange = MONSTER_TYPES.sentry.alertRange!;
  for (const [door, before, behind] of [
    [leftDoor!, antechamber, left],
    [rightDoor!, antechamber, right],
    [gateDoor!, antechamber, gate],
  ] as const) {
    const sentries = map.monsters.filter((m) => m.type === "sentry" && behind.has(hexKey(m.position)));
    const opening = [door, ...map.hexes.filter((h) => distance(h, door) === 1 && before.has(hexKey(h)))];
    for (const sentry of sentries) {
      for (const h of opening) assert.ok(distance(sentry.position, h) > alertRange);
    }
  }
  // The gate room's sentries stand on either side of the throne room door, next to it.
  const gateSentries = map.monsters.filter((m) => gate.has(hexKey(m.position))).map((m) => toOffset(m.position));
  assert.ok(gateSentries.every((h) => distance(fromOffset(h.col, h.row), throneDoor!) === 1));
  assert.deepEqual(
    gateSentries.map((h) => Math.sign(h.col - toOffset(throneDoor!).col)),
    [-1, 1],
  );

  // The throne room: Lotte in the middle of the far wall, Barbara in front of
  // her on the left, Mark on the right with a pillar right below him.
  const at = (type: string) => toOffset(map.monsters.find((m) => m.type === type)!.position);
  assert.deepEqual(at("lotte"), { col: 9, row: 0 });
  assert.deepEqual(at("lottesBarbara"), { col: 8, row: 1 });
  assert.deepEqual(at("lottesMark"), { col: 11, row: 1 });
  assert.equal(distance(fromOffset(11, 1), pillars[0]!), 1);
  // Lotte needs a few turns to reach the door once it opens.
  assert.ok(distance(fromOffset(9, 0), throneDoor!) > 2 * MONSTER_TYPES.lotte.stats.actions);
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
  assert.deepEqual(baseStats("adventurer"), { actions: 1, movement: 1, attackDamage: 1, hitPoints: 10 });
  assert.deepEqual(MONSTER_TYPES.basic.stats, { actions: 1, movement: 1, attackDamage: 1, hitPoints: 3 });
});

test("the rat: 3 hit points, 1 damage, 2 actions, 2 XP, the same targeting as the first monster type", () => {
  assert.deepEqual(MONSTER_TYPES.rat.stats, { actions: 2, movement: 1, attackDamage: 1, hitPoints: 3 });
  assert.equal(MONSTER_TYPES.rat.xp, 4);
  assert.deepEqual(MONSTER_TYPES.rat.targetRules, MONSTER_TYPES.basic.targetRules);
});

test("the guard: 15 hit points, 2 damage, 1 action, 8 XP, alert range 3", () => {
  assert.deepEqual(MONSTER_TYPES.guard.stats, { actions: 1, movement: 1, attackDamage: 2, hitPoints: 15 });
  assert.equal(MONSTER_TYPES.guard.xp, 16);
  assert.equal(MONSTER_TYPES.guard.alertRange, 3);
  // The others are awake from the start (unless behind a closed door).
  assert.equal(MONSTER_TYPES.basic.alertRange, undefined);
  assert.equal(MONSTER_TYPES.rat.alertRange, undefined);
});

test("the archer: 5 hit points, 1 damage, 1 action, range 3, 6 XP, ranged targeting", () => {
  assert.deepEqual(MONSTER_TYPES.archer.stats, { actions: 1, movement: 1, attackDamage: 1, hitPoints: 5 });
  assert.equal(MONSTER_TYPES.archer.range, 3);
  assert.equal(MONSTER_TYPES.archer.xp, 12);
  assert.deepEqual(MONSTER_TYPES.archer.rangedTargetRules, ["fewestHitPoints", "nextOnTrack"]);
  // Without a target it can shoot, it moves as the normal rules say.
  assert.deepEqual(MONSTER_TYPES.archer.targetRules, MONSTER_TYPES.basic.targetRules);
});

test("the brute: 20 hit points, 3 damage, 1 action, 10 XP, normal targeting", () => {
  assert.deepEqual(MONSTER_TYPES.brute.stats, { actions: 1, movement: 1, attackDamage: 3, hitPoints: 20 });
  assert.equal(MONSTER_TYPES.brute.range, 1);
  assert.equal(MONSTER_TYPES.brute.xp, 20);
  assert.deepEqual(MONSTER_TYPES.brute.targetRules, MONSTER_TYPES.basic.targetRules);
  assert.equal(MONSTER_TYPES.brute.rangedTargetRules, undefined);
});

test("Tessa: 40 hit points, 3 damage, 2 actions, 25 XP, normal targeting, named", () => {
  assert.deepEqual(MONSTER_TYPES.tessa.stats, { actions: 2, movement: 1, attackDamage: 3, hitPoints: 40 });
  assert.equal(MONSTER_TYPES.tessa.range, 1);
  assert.equal(MONSTER_TYPES.tessa.xp, 50);
  assert.deepEqual(MONSTER_TYPES.tessa.targetRules, MONSTER_TYPES.basic.targetRules);
  assert.equal(MONSTER_TYPES.tessa.rangedTargetRules, undefined);
});

test("Barbara: 20 hit points, 2 damage, 1 action, 12 XP, normal targeting", () => {
  assert.deepEqual(MONSTER_TYPES.barbara.stats, { actions: 1, movement: 1, attackDamage: 2, hitPoints: 20 });
  assert.equal(MONSTER_TYPES.barbara.range, 1);
  assert.equal(MONSTER_TYPES.barbara.xp, 24);
  assert.deepEqual(MONSTER_TYPES.barbara.targetRules, MONSTER_TYPES.basic.targetRules);
  assert.equal(MONSTER_TYPES.barbara.rangedTargetRules, undefined);
});

test("Mark: 8 hit points, 2 damage, 1 action, range 3, 12 XP, ranged targeting like the archer", () => {
  assert.deepEqual(MONSTER_TYPES.mark.stats, { actions: 1, movement: 1, attackDamage: 2, hitPoints: 8 });
  assert.equal(MONSTER_TYPES.mark.range, 3);
  assert.equal(MONSTER_TYPES.mark.xp, 24);
  assert.deepEqual(MONSTER_TYPES.mark.targetRules, MONSTER_TYPES.archer.targetRules);
  assert.deepEqual(MONSTER_TYPES.mark.rangedTargetRules, MONSTER_TYPES.archer.rangedTargetRules);
});

test("Lotte: 80 hit points, 4 damage, 2 actions, 100 XP, normal targeting like Tessa", () => {
  assert.deepEqual(MONSTER_TYPES.lotte.stats, { actions: 2, movement: 1, attackDamage: 4, hitPoints: 80 });
  assert.equal(MONSTER_TYPES.lotte.label, "L");
  assert.equal(MONSTER_TYPES.lotte.range, 1);
  assert.equal(MONSTER_TYPES.lotte.xp, 100);
  assert.equal(MONSTER_TYPES.lotte.alertRange, undefined);
  assert.deepEqual(MONSTER_TYPES.lotte.targetRules, MONSTER_TYPES.tessa.targetRules);
  assert.equal(MONSTER_TYPES.lotte.rangedTargetRules, undefined);
});

test("Lotte's Barbara: 25 hit points, 3 damage, 1 action, 30 XP, called Barbara like Tessa's", () => {
  assert.deepEqual(MONSTER_TYPES.lottesBarbara.stats, { actions: 1, movement: 1, attackDamage: 3, hitPoints: 25 });
  assert.equal(MONSTER_TYPES.lottesBarbara.name, MONSTER_TYPES.barbara.name);
  assert.equal(MONSTER_TYPES.lottesBarbara.label, "Bb");
  assert.equal(MONSTER_TYPES.lottesBarbara.range, 1);
  assert.equal(MONSTER_TYPES.lottesBarbara.xp, 30);
  assert.equal(MONSTER_TYPES.lottesBarbara.alertRange, undefined);
  assert.deepEqual(MONSTER_TYPES.lottesBarbara.targetRules, MONSTER_TYPES.barbara.targetRules);
  assert.equal(MONSTER_TYPES.lottesBarbara.rangedTargetRules, undefined);
});

test("Lotte's Mark: 10 hit points, 3 damage, 1 action, range 3, 30 XP, ranged targeting, called Mark like Tessa's", () => {
  assert.deepEqual(MONSTER_TYPES.lottesMark.stats, { actions: 1, movement: 1, attackDamage: 3, hitPoints: 10 });
  assert.equal(MONSTER_TYPES.lottesMark.name, MONSTER_TYPES.mark.name);
  assert.equal(MONSTER_TYPES.lottesMark.label, "Mk");
  assert.equal(MONSTER_TYPES.lottesMark.range, 3);
  assert.equal(MONSTER_TYPES.lottesMark.xp, 30);
  assert.equal(MONSTER_TYPES.lottesMark.alertRange, undefined);
  assert.deepEqual(MONSTER_TYPES.lottesMark.targetRules, MONSTER_TYPES.mark.targetRules);
  assert.deepEqual(MONSTER_TYPES.lottesMark.rangedTargetRules, MONSTER_TYPES.mark.rangedTargetRules);
});

test("only Tessa, Lotte and their Barbaras and Marks are named monsters", () => {
  assert.deepEqual(
    Object.values(MONSTER_TYPES)
      .filter((t) => t.named)
      .map((t) => t.id),
    ["tessa", "barbara", "mark", "lotte", "lottesBarbara", "lottesMark"],
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
