import { test } from "node:test";
import assert from "node:assert/strict";
import type { CharacterId, GameState, MonsterId } from "./game-state.ts";
import { hex, hexKey, type Hex } from "./hex.ts";
import { chooseTarget, decideMonsterAction } from "./monsters.ts";
import { MONSTER_TYPES, TARGET_RULES, TARGET_RULE_IDS, baseStats } from "./stats.ts";

// These tests use axial coordinates (see hex.ts) on a hexagon-shaped room
// with the monster in the middle, at 0,0. Straight up from 0,0 is 0,-1,
// 0,-2, ...; straight down is 0,1, 0,2, ...

const X = 1;
const Y = 2;

/** Every hex at most `radius` steps from 0,0. */
function hexagon(radius: number): Hex[] {
  const hexes: Hex[] = [];
  for (let q = -radius; q <= radius; q++) {
    for (let r = -radius; r <= radius; r++) {
      if (Math.abs(q + r) <= radius) hexes.push(hex(q, r));
    }
  }
  return hexes;
}

interface Setup {
  /** Hexes taken out of the room. */
  walls?: Hex[];
  /** Start hexes, which monsters never step on. */
  startHexes?: Hex[];
  /** Closed doors: hexes of the map that block movement. */
  closedDoors?: Hex[];
  characters: { id: CharacterId; at: Hex | null; hp?: number }[];
  /** Monster positions; monster ids are 0, 1, ... in this order. Monster 0 is the one that decides. */
  monsters?: Hex[];
  /** The track: each character with the monsters that follow it. */
  track: [CharacterId, MonsterId[]][];
}

function game({ walls = [], startHexes = [], closedDoors = [], characters, monsters = [hex(0, 0)], track }: Setup): GameState {
  const wallKeys = new Set(walls.map(hexKey));
  return {
    map: { hexes: hexagon(4).filter((h) => !wallKeys.has(hexKey(h))), startHexes, doors: closedDoors, monsters: [] },
    characters: characters.map((c) => ({
      id: c.id,
      stats: baseStats(),
      hp: c.hp ?? 10,
      position: c.at,
      xpGained: 0,
      maxXpGain: 450,
    })),
    monsters: monsters.map((position, id) => ({ id, type: "basic", hp: 10, position, asleep: false })),
    track: track.map(([characterId, monsterIds]) => ({ characterId, monsterIds })),
    closedDoors,
  };
}

const target = (state: GameState) => chooseTarget(state, 0)?.id ?? null;

/** Row r = -1, which separates the room into a top and a bottom part. */
const wallAcross = hexagon(4).filter((h) => h.r === -1);

// --- Attack or move ---

test("a monster attacks its target when it is adjacent", () => {
  const state = game({ characters: [{ id: X, at: hex(0, -1) }], track: [[X, [0]]] });
  assert.deepEqual(decideMonsterAction(state, 0), { type: "attack", target: X });
});

test("otherwise it moves 1 hex towards its target", () => {
  const state = game({ characters: [{ id: X, at: hex(0, -3) }], track: [[X, [0]]] });
  assert.deepEqual(decideMonsterAction(state, 0), { type: "move", to: hex(0, -1), target: X });
});

// --- Which players count ---

test("while no character is on the map, the monster doesn't move", () => {
  const state = game({ characters: [{ id: X, at: null }], track: [[X, [0]]] });
  assert.equal(target(state), null);
  assert.deepEqual(decideMonsterAction(state, 0), { type: "wait" });
});

test("dead characters and characters off the map aren't targets", () => {
  const state = game({
    characters: [
      { id: X, at: hex(0, -1), hp: 0 },
      { id: Y, at: null },
      { id: 3, at: hex(0, 3) },
    ],
    track: [[X, [0]], [Y, []], [3, []]],
  });
  assert.equal(target(state), 3);
});

// --- Choosing a target ---

test("target rule 1: the player the monster can reach in the fewest turns", () => {
  // X is 2 hexes away, Y 3. Without walls, X is the closest.
  const characters = [
    { id: X, at: hex(0, -2) },
    { id: Y, at: hex(0, 3) },
  ];
  const track: Setup["track"] = [[X, [0]], [Y, []]];
  assert.equal(target(game({ characters, track })), X);

  // A wall across the room, with a gap at the far left: X is still 2 hexes
  // away in a straight line, but the way around the wall takes 6 turns.
  // Y can be reached in 2.
  const withWall = game({ walls: wallAcross.filter((h) => h.q !== -3), characters, track });
  assert.equal(target(withWall), Y);
  assert.deepEqual(decideMonsterAction(withWall, 0), { type: "move", to: hex(0, 1), target: Y });
});

test("target rule 2: of the closest players, the one with the fewest hit points", () => {
  // X and Y are both 3 hexes away. The monster follows Y, so X comes first
  // after it on the track; with equal hit points that decides.
  const track: Setup["track"] = [[X, []], [Y, [0]]];
  const at = (hpOfY: number) =>
    game({
      characters: [
        { id: X, at: hex(0, -3) },
        { id: Y, at: hex(0, 3), hp: hpOfY },
      ],
      track,
    });
  assert.equal(target(at(10)), X);
  assert.equal(target(at(5)), Y);
});

test("target rule 3: of the players left, the first after the monster on the track", () => {
  const characters = [
    { id: X, at: hex(0, -3) },
    { id: 3, at: hex(-4, 0) },
    { id: Y, at: hex(0, 3) },
  ];
  // The track order is X, 3, Y. X and Y are 3 hexes away, character 3 is 4.
  assert.equal(target(game({ characters, track: [[X, [0]], [3, []], [Y, []]] })), Y);
  assert.equal(target(game({ characters, track: [[X, []], [3, []], [Y, [0]]] })), X);
  // Following character 3: the first after it is Y, not X.
  assert.equal(target(game({ characters, track: [[X, []], [3, [0]], [Y, []]] })), Y);
});

test("the target rules are read from the monster type's data", () => {
  assert.deepEqual(MONSTER_TYPES.basic.targetRules, ["closest", "fewestHitPoints", "nextOnTrack"]);
  for (const rule of TARGET_RULE_IDS) assert.ok(TARGET_RULES[rule].description, rule);

  // X is closer, Y has fewer hit points. Swapping the order of the first two
  // rules in the data changes the target.
  const state = game({
    characters: [
      { id: X, at: hex(0, -2) },
      { id: Y, at: hex(0, 3), hp: 5 },
    ],
    track: [[X, [0]], [Y, []]],
  });
  assert.equal(target(state), X);
  const original = MONSTER_TYPES.basic.targetRules;
  try {
    MONSTER_TYPES.basic.targetRules = ["fewestHitPoints", "closest", "nextOnTrack"];
    assert.equal(target(state), Y);
  } finally {
    MONSTER_TYPES.basic.targetRules = original;
  }
});

// --- Choosing a route ---

test("route: of equally good moves, the first clockwise starting at straight up", () => {
  const moveTowards = (at: Hex) =>
    decideMonsterAction(game({ characters: [{ id: X, at }], track: [[X, [0]]] }), 0);

  // Up-right and down-right both bring the monster 1 hex closer: up-right comes first.
  assert.deepEqual(moveTowards(hex(2, -1)), { type: "move", to: hex(1, -1), target: X });
  // Down-left and up-left: down-left comes first (up-left is the last direction).
  assert.deepEqual(moveTowards(hex(-2, 1)), { type: "move", to: hex(-1, 1), target: X });
});

test("route: a monster walks around another monster in its way", () => {
  // Monster 1 stands straight up, on the only hex that is 1 closer to X.
  // Going round via up-right or up-left takes equally long: up-right comes first.
  const state = game({
    characters: [{ id: X, at: hex(0, -3) }],
    monsters: [hex(0, 0), hex(0, -1)],
    track: [[X, [0, 1]]],
  });
  assert.deepEqual(decideMonsterAction(state, 0), { type: "move", to: hex(1, -1), target: X });
});

test("route: a monster walks around a wall", () => {
  // A wall across the room with a gap at the far left: X is straight up, but
  // the way to it goes through the gap, so the first step is down-left
  // (towards the gap), not up into the wall.
  const state = game({
    walls: wallAcross.filter((h) => h.q !== -3),
    characters: [{ id: X, at: hex(0, -3) }],
    track: [[X, [0]]],
  });
  assert.deepEqual(decideMonsterAction(state, 0), { type: "move", to: hex(-1, 0), target: X });
});

// --- Start hexes ---

test("a monster never steps on a start hex: it walks around it", () => {
  // Straight up (0,-1) is a start hex, on the shortest way to X. Going round
  // via up-right or up-left takes equally long: up-right comes first.
  const state = game({
    startHexes: [hex(0, -1)],
    characters: [{ id: X, at: hex(0, -3) }],
    track: [[X, [0]]],
  });
  assert.deepEqual(decideMonsterAction(state, 0), { type: "move", to: hex(1, -1), target: X });
});

test("a monster attacks a character on a start hex from next to it", () => {
  const state = game({
    startHexes: [hex(0, -1)],
    characters: [{ id: X, at: hex(0, -1) }],
    track: [[X, [0]]],
  });
  assert.deepEqual(decideMonsterAction(state, 0), { type: "attack", target: X });
});

test("start hexes count as blocked when the monster looks for the closest player", () => {
  // The wall across the room has a gap at the far left, at -3,-1. The
  // monster stands just below the gap; X stands just above it, so X can be
  // reached in 1 turn and Y, far off in the bottom part, in 5.
  const characters = [
    { id: X, at: hex(-2, -2) },
    { id: Y, at: hex(3, 1) },
  ];
  const setup = {
    walls: wallAcross.filter((h) => h.q !== -3),
    characters,
    monsters: [hex(-3, 0)],
    track: [[X, [0]], [Y, []]] as Setup["track"],
  };
  assert.equal(target(game(setup)), X);
  // With the gap a start hex, the top part can't be reached: Y is the target.
  assert.equal(target(game({ ...setup, startHexes: [hex(-3, -1)] })), Y);
});

// --- No player can be reached ---

test("when no player can be reached, the closest in a straight line is the target", () => {
  // The wall across the room separates the monster (bottom part) from both
  // players (top part). X is 4 hexes away in a straight line, Y 5.
  const state = game({
    walls: wallAcross,
    characters: [
      { id: X, at: hex(0, -3) },
      { id: Y, at: hex(3, -4) },
    ],
    monsters: [hex(0, 1)],
    track: [[Y, [0]], [X, []]],
  });
  assert.equal(target(state), X);
  // It moves 1 hex closer in a straight line, to 0,0.
  assert.deepEqual(decideMonsterAction(state, 0), { type: "move", to: hex(0, 0), target: X });
});

test("when no player can be reached, the same tie-break rules apply", () => {
  // X and Y are both 4 hexes away in a straight line; Y has fewer hit points.
  const state = game({
    walls: wallAcross,
    characters: [
      { id: X, at: hex(0, -3) },
      { id: Y, at: hex(3, -3), hp: 5 },
    ],
    monsters: [hex(0, 1)],
    track: [[X, [0]], [Y, []]],
  });
  assert.equal(target(state), Y);
});

test("when no player can be reached and no free hex brings it closer, the monster doesn't move", () => {
  // From 0,0 the only hexes closer to X are in the wall.
  const state = game({
    walls: wallAcross,
    characters: [{ id: X, at: hex(0, -3) }],
    track: [[X, [0]]],
  });
  assert.equal(target(state), X);
  assert.deepEqual(decideMonsterAction(state, 0), { type: "wait" });
});
