// Difficulties and unlocking dungeons (design.md, Difficulties and Unlocking
// dungeons): monster stats and XP per difficulty, and what a player's wins
// unlock.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canPlay,
  defaultChoice,
  DIFFICULTY_IDS,
  dungeonStatus,
  isDifficultyUnlocked,
  monsterStats,
  monsterXp,
  nextToClear,
  type DifficultyId,
  type DungeonWin,
} from "./difficulties.ts";
import { DUNGEON_IDS, FIRST_DUNGEON_MAP, type DungeonId } from "./dungeon-map.ts";
import { applyEvents } from "./events.ts";
import type { CharacterId, GameState } from "./game-state.ts";
import { fromOffset } from "./hex.ts";
import { baseStats, MONSTER_TYPES, MONSTER_TYPE_IDS } from "./stats.ts";
import { createTrack } from "./track.ts";
import { newGameState, resolveTurn, type Plan } from "./turn.ts";

// ---- Monster stats and XP ----

test("on Normal monsters have their type's stats and XP", () => {
  for (const type of MONSTER_TYPE_IDS) {
    assert.deepEqual(monsterStats(type, "normal"), MONSTER_TYPES[type].stats);
    assert.equal(monsterXp(type, "normal"), MONSTER_TYPES[type].xp);
  }
});

test("on Hard and Heroic monsters have more actions, damage, hit points and XP; movement stays", () => {
  const brute = MONSTER_TYPES.brute;
  assert.deepEqual(monsterStats("brute", "hard"), {
    actions: brute.stats.actions * 2,
    movement: brute.stats.movement,
    attackDamage: brute.stats.attackDamage * 2,
    hitPoints: brute.stats.hitPoints * 3,
  });
  assert.equal(monsterXp("brute", "hard"), brute.xp * 3);
  assert.deepEqual(monsterStats("brute", "heroic"), {
    actions: brute.stats.actions * 3,
    movement: brute.stats.movement,
    attackDamage: brute.stats.attackDamage * 3,
    hitPoints: brute.stats.hitPoints * 5,
  });
  assert.equal(monsterXp("brute", "heroic"), brute.xp * 5);
});

const A: CharacterId = 1;
const B: CharacterId = 2;

/**
 * The first dungeon on a difficulty, with A already in the room next to
 * monster 0 (at column 5, row 1), which follows A on the track.
 */
function firstGameOn(difficulty: DifficultyId): GameState {
  const state = newGameState(
    FIRST_DUNGEON_MAP,
    [
      { id: A, stats: baseStats() },
      { id: B, stats: baseStats() },
    ],
    createTrack([A, B], new Map([[0, A]])),
    difficulty,
  );
  return {
    ...state,
    characters: state.characters.map((c) => (c.id === A ? { ...c, position: fromOffset(4, 1) } : c)),
  };
}

function turn(state: GameState, characterId: CharacterId, ...plan: Plan) {
  const result = resolveTurn(state, characterId, new Map(plan.length > 0 ? [[characterId, plan]] : []));
  assert.deepEqual(applyEvents(state, result.events), result.newState, "replaying the events");
  return result;
}

for (const [difficulty, times] of [
  ["hard", { actions: 2, damage: 2, hitPoints: 3, xp: 3 }],
  ["heroic", { actions: 3, damage: 3, hitPoints: 5, xp: 5 }],
] as const) {
  test(`in a game on ${difficulty}, monsters have the multiplied stats and give the multiplied XP`, () => {
    const basic = MONSTER_TYPES.basic;
    const state = firstGameOn(difficulty);
    assert.equal(state.difficulty, difficulty);
    for (const m of state.monsters) assert.equal(m.hp, basic.stats.hitPoints * times.hitPoints);

    // A does nothing; monster 0 attacks A once per action, each time for the multiplied damage.
    const { events } = turn(state, A);
    const damage = basic.stats.attackDamage * times.damage;
    assert.deepEqual(
      events,
      Array(basic.stats.actions * times.actions).fill({
        type: "attacked",
        attacker: { kind: "monster", id: 0 },
        target: { kind: "character", id: A },
        damage,
      }),
    );

    // A kills monster 0 (left with 1 hit point): everyone gets the multiplied XP.
    const almostDead = { ...state, monsters: state.monsters.map((m) => (m.id === 0 ? { ...m, hp: 1 } : m)) };
    const killed = turn(almostDead, A, { type: "attack", monsterId: 0 }).events;
    const xp = basic.xp * times.xp;
    assert.deepEqual(killed.find((e) => e.type === "xpGained"), {
      type: "xpGained",
      gains: [
        { characterId: A, xp },
        { characterId: B, xp },
      ],
    });
  });
}

// ---- Unlocking dungeons ----

function won(difficulty: DifficultyId, ...dungeonIds: DungeonId[]): DungeonWin[] {
  return dungeonIds.map((dungeonId) => ({ dungeonId, difficulty }));
}

const [FIRST, SECOND, THIRD] = DUNGEON_IDS;
const LAST = DUNGEON_IDS[DUNGEON_IDS.length - 1]!;

test("without wins, only the first dungeon on Normal can be played", () => {
  assert.equal(nextToClear([], "normal"), FIRST);
  assert.equal(canPlay([], { dungeonId: FIRST, difficulty: "normal" }), true);
  assert.equal(canPlay([], { dungeonId: SECOND, difficulty: "normal" }), false);
  for (const d of DIFFICULTY_IDS) assert.equal(isDifficultyUnlocked([], d), d === "normal");
  assert.deepEqual(defaultChoice([]), { dungeonId: FIRST, difficulty: "normal" });
});

test("the cleared dungeons and the first one not cleared can be played, the rest are locked", () => {
  const wins = won("normal", FIRST, SECOND);
  assert.deepEqual(
    DUNGEON_IDS.map((id) => dungeonStatus(wins, id, "normal")),
    ["cleared", "cleared", "next", ...Array(DUNGEON_IDS.length - 3).fill("locked")],
  );
  assert.equal(canPlay(wins, { dungeonId: FIRST, difficulty: "normal" }), true);
  assert.equal(canPlay(wins, { dungeonId: THIRD, difficulty: "normal" }), true);
  assert.equal(canPlay(wins, { dungeonId: DUNGEON_IDS[3]!, difficulty: "normal" }), false);
  // Hard isn't unlocked yet, so everything on it is locked.
  assert.equal(isDifficultyUnlocked(wins, "hard"), false);
  assert.deepEqual(new Set(DUNGEON_IDS.map((id) => dungeonStatus(wins, id, "hard"))), new Set(["locked"]));
  assert.deepEqual(defaultChoice(wins), { dungeonId: THIRD, difficulty: "normal" });
});

test("clearing every dungeon on Normal unlocks Hard, starting at its first dungeon", () => {
  const wins = won("normal", ...DUNGEON_IDS);
  assert.equal(nextToClear(wins, "normal"), undefined);
  assert.equal(isDifficultyUnlocked(wins, "hard"), true);
  assert.equal(isDifficultyUnlocked(wins, "heroic"), false);
  assert.equal(dungeonStatus(wins, FIRST, "hard"), "next");
  assert.equal(canPlay(wins, { dungeonId: FIRST, difficulty: "hard" }), true);
  assert.equal(canPlay(wins, { dungeonId: SECOND, difficulty: "hard" }), false);
  assert.deepEqual(defaultChoice(wins), { dungeonId: FIRST, difficulty: "hard" });
});

test("with everything cleared, a new game goes to the last dungeon on the hardest difficulty", () => {
  const wins = DIFFICULTY_IDS.flatMap((d) => won(d, ...DUNGEON_IDS));
  assert.deepEqual(defaultChoice(wins), { dungeonId: LAST, difficulty: "heroic" });
});

test("a dungeon added to the end becomes the next to clear, and a difficulty already reached stays unlocked", () => {
  // The player cleared everything on Normal and the first dungeon on Hard.
  const wins = [...won("normal", ...DUNGEON_IDS), ...won("hard", FIRST)];
  const withNew = [...DUNGEON_IDS, "newDungeon" as DungeonId];

  assert.equal(nextToClear(wins, "normal", withNew), "newDungeon");
  assert.equal(dungeonStatus(wins, "newDungeon" as DungeonId, "normal", withNew), "next");
  // Not every dungeon is cleared on Normal any more, but Hard was reached.
  assert.equal(isDifficultyUnlocked(wins, "hard", withNew), true);
  assert.equal(canPlay(wins, { dungeonId: SECOND, difficulty: "hard" }, withNew), true);
  assert.deepEqual(defaultChoice(wins, withNew), { dungeonId: SECOND, difficulty: "hard" });

  // A player who cleared everything on Normal but never won on Hard has to
  // clear the new dungeon first.
  const onlyNormal = won("normal", ...DUNGEON_IDS);
  assert.equal(isDifficultyUnlocked(onlyNormal, "hard", withNew), false);
  assert.deepEqual(defaultChoice(onlyNormal, withNew), { dungeonId: "newDungeon", difficulty: "normal" });
});

test("a difficulty is unlocked by any win on it, so Heroic doesn't need Hard to be cleared again", () => {
  const wins = [...won("normal", FIRST), ...won("heroic", FIRST)];
  assert.equal(isDifficultyUnlocked(wins, "hard"), false);
  assert.equal(isDifficultyUnlocked(wins, "heroic"), true);
  assert.deepEqual(defaultChoice(wins), { dungeonId: SECOND, difficulty: "heroic" });
});
