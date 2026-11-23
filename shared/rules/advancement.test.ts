import { test } from "node:test";
import assert from "node:assert/strict";
import {
  adventurerPrice,
  canMakeAdvancedClassWith,
  canRankUpWith,
  DAY_MS,
  type Hero,
  isAtMaxLevel,
  levelFromXp,
  levelInGame,
  levelsGained,
  MAX_ADVENTURER_RANK,
  MAX_RANK,
  maxLevel,
  maxRank,
  maxXp,
  minRank,
  nextAdventurerPrice,
  progressInGame,
  rankUpExtra,
  upgradePointsEarned,
  xpForLevel,
  xpToNextLevel,
} from "./advancement.ts";
import { ADVANCED_CLASS_IDS, CLASS_IDS, type ClassId } from "./classes.ts";
import { roundHalfToEven } from "./rounding.ts";

test("a rank 1 adventurer's total XP follows the table in design.md, Levels: all its 10 levels cost the full XP", () => {
  const table: [number, number][] = [
    [1, 0],
    [2, 5],
    [3, 15],
    [4, 30],
    [5, 50],
    [10, 225],
  ];
  for (const [level, xp] of table) assert.equal(xpForLevel(level, "adventurer", 1), xp, `level ${level}`);
});

test("an adventurer pays 5 × L XP from level L in its rank's last 10 levels, half that below them (issue #426)", () => {
  for (let rank = 1; rank <= MAX_ADVENTURER_RANK; rank++) {
    const max = maxLevel("adventurer", rank);
    for (let level = 1; level < max; level++) {
      const full = level + 1 > max - 10;
      const expected = full ? 5 * level : roundHalfToEven(2.5 * level);
      assert.equal(xpToNextLevel(level, "adventurer", rank), expected, `rank ${rank}, level ${level}`);
      assert.equal(xpForLevel(level + 1, "adventurer", rank) - xpForLevel(level, "adventurer", rank), expected);
    }
  }
  // Half of 2.5, 7.5, 12.5, ... rounds to the even neighbour: down, up, down.
  assert.deepEqual(
    Array.from({ length: 9 }, (_, i) => xpToNextLevel(i + 1, "adventurer", 2)),
    [2, 5, 8, 10, 12, 15, 18, 20, 22],
  );
  // Rank 2: level 10 is the last at half price, so the step to 11 is the full 5 × 10.
  assert.equal(xpToNextLevel(10, "adventurer", 2), 50);
});

test("the adventurer's totals follow the table in design.md, Levels (issue #426)", () => {
  const table: [rank: number, halfPriceUpTo: number, xpThere: number, xpForMax: number][] = [
    [2, 10, 112, 837],
    [3, 20, 475, 1700],
    [4, 30, 1087, 2812],
    [5, 40, 1950, 4175],
  ];
  for (const [rank, level, xp, max] of table) {
    assert.equal(xpForLevel(level, "adventurer", rank), xp, `rank ${rank}`);
    assert.equal(maxXp("adventurer", rank), max, `rank ${rank}`);
  }
});

test("an advanced class pays 10 × L XP from level L, whatever its rank (issue #426)", () => {
  for (const classId of ADVANCED_CLASS_IDS) {
    for (let rank = 6; rank <= MAX_RANK; rank++) {
      for (let level = 1; level < maxLevel(classId, rank); level++) {
        assert.equal(xpToNextLevel(level, classId, rank), 10 * level, `${classId} rank ${rank} level ${level}`);
      }
    }
    assert.equal(maxXp(classId, 6), 1900, classId);
    assert.equal(maxXp(classId, 10), 17700, classId);
  }
});

test("every class's curve gives a whole number of at least 1 XP for every level step", () => {
  for (const classId of CLASS_IDS) {
    for (let rank = minRank(classId); rank <= maxRank(classId); rank++) {
      for (let level = 1; level < maxLevel(classId, rank); level++) {
        const xp = xpToNextLevel(level, classId, rank);
        assert.ok(Number.isInteger(xp) && xp >= 1, `${classId} rank ${rank} level ${level}: ${xp}`);
      }
    }
  }
});

test("max level is rank × 10: rank 1 tops out at 225 XP, rank 5 at 4,175", () => {
  assert.equal(maxLevel("adventurer", 1), 10);
  assert.equal(maxXp("adventurer", 1), 225);
  assert.equal(maxLevel("adventurer", 5), 50);
  assert.equal(maxXp("adventurer", 5), 4175);
});

test("an advanced class has ranks 6 to 10 and 10 levels more than an adventurer at the same step: 20 at rank 6, 60 at rank 10", () => {
  for (const classId of ADVANCED_CLASS_IDS) {
    assert.equal(maxLevel(classId, 6), 20, classId);
    assert.equal(maxLevel(classId, 10), 60, classId);
  }
  // Levelling: 225 XP is level 7 for a rank 6 tank (210 XP), which stops at 20.
  assert.equal(levelFromXp(225, "tank", 6), 7);
  assert.equal(levelFromXp(100_000, "tank", 6), 20);
  // In a game too: a new rank 6 tank can gain all the XP up to level 20.
  assert.equal(levelInGame("tank", 6, maxXp("tank", 6), maxXp("tank", 6)), 20);
});

test("the level follows from the total XP; leftover XP counts towards the next level", () => {
  const cases: [xp: number, level: number][] = [
    [0, 1],
    [4, 1],
    [5, 2],
    [14, 2],
    [15, 3],
    [224, 9],
    [225, 10],
  ];
  for (const [xp, level] of cases) assert.equal(levelFromXp(xp, "adventurer", 1), level, `${xp} XP`);
  // The table's levels, from their total XP, at the highest rank.
  for (const level of [2, 3, 4, 5, 10, 20, 40, 41, 50]) {
    assert.equal(levelFromXp(xpForLevel(level, "adventurer", 5), "adventurer", 5), level);
    assert.equal(levelFromXp(xpForLevel(level, "adventurer", 5) - 1, "adventurer", 5), level - 1);
  }
});

test("the level stops at the max level of the rank", () => {
  assert.equal(levelFromXp(950, "adventurer", 1), 10);
  assert.equal(levelFromXp(950, "adventurer", 2), 20);
  assert.equal(levelFromXp(100_000, "adventurer", 5), 50);
});

test("stored characters keep their XP and go up in level with the new curve (issue #93)", () => {
  // 30 XP was level 3 with the old curve (10 × L per level); now it is level 4.
  assert.equal(levelFromXp(30, "adventurer", 1), 4);
  assert.equal(upgradePointsEarned(levelFromXp(30, "adventurer", 1)), 2 + 3 + 4);
  // 450 XP was the old max for rank 1: now far past it, still level 10, and it can rank up.
  assert.equal(levelFromXp(450, "adventurer", 1), 10);
  assert.equal(isAtMaxLevel({ class: "adventurer", rank: 1, xp: 450 }), true);
  // 1,900 XP was the old level 20 of rank 2: now past the max too.
  assert.equal(levelFromXp(1900, "adventurer", 2), 20);
});

test("stored characters keep their XP and their level follows the new curves (issue #426)", () => {
  // 3,900 XP was level 40 of a rank 5 adventurer; now it is level 48 (3,690 XP).
  assert.equal(levelFromXp(3900, "adventurer", 5), 48);
  // A rank 1 adventurer's curve didn't change.
  assert.equal(levelFromXp(224, "adventurer", 1), 9);
  // 950 XP was the max level (20) of a rank 6 tank; now it is level 14 (910 XP).
  assert.equal(levelFromXp(950, "tank", 6), 14);
  assert.equal(isAtMaxLevel({ class: "tank", rank: 6, xp: 950 }), false);
});

test("reaching level L gives L upgrade points: 54 in total at level 10", () => {
  assert.equal(upgradePointsEarned(1), 0);
  assert.equal(upgradePointsEarned(2), 2);
  assert.equal(upgradePointsEarned(3), 5);
  assert.equal(upgradePointsEarned(5), 2 + 3 + 4 + 5);
  assert.equal(upgradePointsEarned(10), 54);
});

test("an adventurer of a rank never bought costs its base price", () => {
  assert.deepEqual(
    [1, 2, 3, 4, 5].map((rank) => adventurerPrice(rank, undefined, 0)),
    [10, 90, 450, 1000, 2500],
  );
});

test("buying one adds its rank's base price to what was paid", () => {
  assert.deepEqual(
    [1, 2, 3, 4, 5].map((rank) => nextAdventurerPrice(rank, adventurerPrice(rank, undefined, 0))),
    [20, 180, 900, 2000, 5000],
  );
  // After waiting: 162 paid for a rank 2, so the next one costs 162 + 90.
  assert.equal(nextAdventurerPrice(2, 162), 252);
});

test("the price drops 10% for each full day since the last purchase of that rank", () => {
  const last = { nextPrice: 180, boughtAt: 1000 };
  assert.equal(adventurerPrice(2, last, 1000), 180);
  assert.equal(adventurerPrice(2, last, 1000 + DAY_MS - 1), 180); // not a full day yet
  assert.equal(adventurerPrice(2, last, 1000 + DAY_MS), 162);
  assert.equal(adventurerPrice(2, last, 1000 + 2 * DAY_MS), 146); // 145.8, rounded
  assert.equal(adventurerPrice(2, last, 1000 + 3 * DAY_MS), 131); // 131.22: from 180, not from 146
});

test("the price never drops below the base price of its rank", () => {
  const last = { nextPrice: 2000, boughtAt: 0 };
  assert.equal(adventurerPrice(4, last, 6 * DAY_MS), 1063); // 1062.882
  assert.equal(adventurerPrice(4, last, 7 * DAY_MS), 1000); // 956.6, but 1000 is the base
  assert.equal(adventurerPrice(4, last, 1000 * DAY_MS), 1000);
});

test("a clock that went back in time never makes the price go up", () => {
  assert.equal(adventurerPrice(1, { nextPrice: 20, boughtAt: 5 * DAY_MS }, 0), 20);
});

/** A character at the max level of its rank, or `below` XP short of it. */
function hero(classId: ClassId, rank: number, below = 0): Hero {
  return { class: classId, rank, xp: maxXp(classId, rank) - below };
}

test("a character ranks up with one of the same class a rank lower (issue #406)", () => {
  assert.deepEqual(rankUpExtra("adventurer", 3), { class: "adventurer", rank: 2 });
  assert.deepEqual(rankUpExtra("adventurer", 4), { class: "adventurer", rank: 3 });
  assert.deepEqual(rankUpExtra("tank", 8), { class: "tank", rank: 7 });
  assert.deepEqual(rankUpExtra("healer", 10), undefined); // there is no rank 11
  assert.deepEqual(rankUpExtra("adventurer", 5), undefined); // an advanced class is made instead
});

test("rank 1 ranks up with another rank 1, rank 6 with a rank 5 adventurer", () => {
  assert.deepEqual(rankUpExtra("adventurer", 1), { class: "adventurer", rank: 1 });
  assert.deepEqual(rankUpExtra("ranger", 6), { class: "adventurer", rank: 5 });
});

test("both characters must be at their max level to rank up", () => {
  // The example of issue #406: a level 30 rank 3 and a level 20 rank 2 make a rank 4.
  assert.equal(canRankUpWith(hero("adventurer", 3), hero("adventurer", 2)), true);
  assert.equal(canRankUpWith(hero("adventurer", 3, 1), hero("adventurer", 2)), false);
  assert.equal(canRankUpWith(hero("adventurer", 3), hero("adventurer", 2, 1)), false);
  // The other way round, the rank 2 doesn't rank up with the rank 3.
  assert.equal(canRankUpWith(hero("adventurer", 2), hero("adventurer", 3)), false);
  // The same rank no longer fits above rank 1.
  assert.equal(canRankUpWith(hero("adventurer", 3), hero("adventurer", 3)), false);
  assert.equal(canRankUpWith(hero("adventurer", 1), hero("adventurer", 1)), true);
});

test("an advanced class ranks up at its own max level", () => {
  // A rank 6 tank at level 10, the adventurer's rank 1 max level, isn't at its own max level.
  assert.equal(isAtMaxLevel({ class: "tank", rank: 6, xp: maxXp("adventurer", 1) }), false);
  assert.equal(canRankUpWith(hero("tank", 6), hero("adventurer", 5)), true);
  assert.equal(canRankUpWith(hero("tank", 6), hero("tank", 6)), false);
  assert.equal(canRankUpWith(hero("tank", 9), hero("tank", 8)), true);
  assert.equal(canRankUpWith(hero("tank", 9), hero("healer", 8)), false); // another class
  assert.equal(canRankUpWith(hero("tank", 10), hero("tank", 9)), false); // there is no rank 11
});

test("a rank 5 and a rank 4 adventurer at their max level make an advanced class", () => {
  assert.equal(canMakeAdvancedClassWith(hero("adventurer", 5), hero("adventurer", 4)), true);
  assert.equal(canMakeAdvancedClassWith(hero("adventurer", 5, 1), hero("adventurer", 4)), false); // level 49
  assert.equal(canMakeAdvancedClassWith(hero("adventurer", 5), hero("adventurer", 4, 1)), false);
  assert.equal(canMakeAdvancedClassWith(hero("adventurer", 5), hero("adventurer", 5)), false);
  assert.equal(canMakeAdvancedClassWith(hero("adventurer", 4), hero("adventurer", 5)), false);
  // An advanced class can't be made from another one.
  assert.equal(canMakeAdvancedClassWith(hero("tank", 10), hero("tank", 9)), false);
});

test("the level in a game follows from the rank, the XP it can still gain and the XP gained", () => {
  // Rank 1 (max 225 XP), started with 10 XP: level 2.
  assert.equal(levelInGame("adventurer", 1, 215, 0), 2);
  // 5 more XP make 15: level 3.
  assert.equal(levelInGame("adventurer", 1, 215, 5), 3);
  // Started at its max level: nothing to gain, and it stays there.
  assert.equal(levelInGame("adventurer", 1, 0, 0), 10);
  // A new rank 2 character: level 1.
  assert.equal(levelInGame("adventurer", 2, maxXp("adventurer", 2), 0), 1);
});

test("progressInGame says whether a game gave a level and reached a max level to rank up from", () => {
  // A new rank 1 character (225 XP to gain) that gains 4 XP: still level 1.
  assert.deepEqual(progressInGame("adventurer", 1, 225, 4), { levelledUp: false, reachedMaxLevel: false });
  // 5 XP: level 2.
  assert.deepEqual(progressInGame("adventurer", 1, 225, 5), { levelledUp: true, reachedMaxLevel: false });
  // From level 9 (180 XP, so 45 to gain) to its max level, 10.
  assert.deepEqual(progressInGame("adventurer", 1, 45, 45), { levelledUp: true, reachedMaxLevel: true });
  // Already at its max level: it gains nothing, so neither.
  assert.deepEqual(progressInGame("adventurer", 1, 0, 0), { levelledUp: false, reachedMaxLevel: false });
  // Rank 5 can't rank up: reaching its max level levels up, but gives no max-level hint.
  const lastStep = xpToNextLevel(49, "adventurer", 5);
  assert.deepEqual(progressInGame("adventurer", 5, lastStep, lastStep), {
    levelledUp: true,
    reachedMaxLevel: false,
  });
});

test("levelsGained counts the levels between two amounts of XP gained in a game", () => {
  // A new rank 1 character (225 XP to gain): 4 XP is still level 1, 15 XP is level 3.
  assert.equal(levelsGained("adventurer", 1, 225, 0, 4), 0);
  assert.equal(levelsGained("adventurer", 1, 225, 0, 15), 2);
  // One kill from 4 to 5 XP gained: level 1 to 2.
  assert.equal(levelsGained("adventurer", 1, 225, 4, 5), 1);
  // Already at its max level: it gains nothing.
  assert.equal(levelsGained("adventurer", 1, 0, 0, 0), 0);
});
