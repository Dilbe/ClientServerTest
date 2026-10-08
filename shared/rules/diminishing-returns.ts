// Diminishing returns (design.md, Rewards, Diminishing returns): killing the
// same monster again gives a character less XP, until it gives nothing.
//
// Kills are counted per character, per dungeon, per difficulty and per
// monster: by the monster's place in the dungeon's list. The counts are
// facts stored with the character (architecture.md, Characters); the XP a
// monster still gives follows from them, worked out here by shared code so
// the game and the party screen agree.

import { monsterXp, type DifficultyId } from "./difficulties.ts";
import type { DungeonId, DungeonMap } from "./dungeon-map.ts";

/** After this many kills of a monster, it gives no more XP. */
export const KILLS_UNTIL_NO_XP = 10;

/**
 * A character's kills: per dungeon id, per difficulty id, how often it has
 * killed each monster, by the monster's place in the dungeon's list. A
 * missing dungeon, difficulty or place means no kills.
 */
export type KillCounts = Partial<Record<DungeonId, Partial<Record<DifficultyId, number[]>>>>;

/** The kills of one dungeon on one difficulty, by monster place. Empty when there are none. */
export function killsIn(kills: KillCounts, dungeonId: DungeonId, difficulty: DifficultyId): number[] {
  return kills[dungeonId]?.[difficulty] ?? [];
}

/**
 * Adds one kill of each of these monsters (by place) to the counts. Returns
 * new counts; the old ones are left as they are.
 */
export function addKills(
  kills: KillCounts,
  dungeonId: DungeonId,
  difficulty: DifficultyId,
  monsterPlaces: readonly number[],
): KillCounts {
  const counts = [...killsIn(kills, dungeonId, difficulty)];
  for (const place of monsterPlaces) {
    // Places beyond the end are filled with 0 kills first.
    while (counts.length <= place) counts.push(0);
    counts[place]! += 1;
  }
  return { ...kills, [dungeonId]: { ...kills[dungeonId], [difficulty]: counts } };
}

/**
 * The XP a monster gives after this many earlier kills: every kill takes off
 * 10% of the full XP, rounded up to a whole XP. So it gives at least 1 XP
 * until the 10th kill, and nothing after that. A rat's 4 XP gives 4, 4, 4,
 * 3, 3, 2, 2, 2, 1, 1 and then 0.
 */
export function xpAfterKills(fullXp: number, kills: number): number {
  const left = Math.max(0, KILLS_UNTIL_NO_XP - kills);
  // Whole numbers only: fullXp × left is an integer, and dividing it by 10
  // can't land just above a whole number by a rounding error.
  return Math.ceil((fullXp * left) / KILLS_UNTIL_NO_XP);
}

/**
 * The XP a character would get from clearing a dungeon on a difficulty, as
 * a percentage (0 to 100) of the XP it gives without any kills: shown on
 * the party screen. `kills` are that dungeon's counts on that difficulty
 * (see `killsIn`). Rounded down, so 100% means really all of it, but never
 * down to 0% while some XP is left.
 */
export function dungeonXpPercent(map: DungeonMap, difficulty: DifficultyId, kills: readonly number[]): number {
  let full = 0;
  let left = 0;
  map.monsters.forEach((monster, place) => {
    const xp = monsterXp(monster.type, difficulty);
    full += xp;
    left += xpAfterKills(xp, kills[place] ?? 0);
  });
  if (left === 0) return 0;
  return Math.max(1, Math.floor((100 * left) / full));
}
