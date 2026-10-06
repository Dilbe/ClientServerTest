// Difficulties and unlocking dungeons (design.md, Difficulties and Unlocking
// dungeons).
//
// Like the dungeons and monster types, difficulties are data: a name and
// multipliers each. A harder difficulty uses the same map and monsters, but
// makes the monsters stronger and worth more XP.
//
// Which dungeons and difficulties a player can play is never stored: it is
// worked out from their wins, every time it is needed. The server uses it to
// check the host's choice; the client to draw the dungeon map.

import { DUNGEON_IDS, type DungeonId } from "./dungeon-map.ts";
import { MONSTER_TYPES, type MonsterTypeId, type Stats } from "./stats.ts";

/**
 * Every difficulty, from easiest to hardest. The order is the order they
 * unlock in. Like the dungeon ids, these are stored with each win, so an id
 * must never change once it is in use; rename the `name` instead.
 */
export const DIFFICULTY_IDS = ["normal", "hard", "heroic"] as const;
export type DifficultyId = (typeof DIFFICULTY_IDS)[number];

/** The difficulty of games from before difficulties existed, and of tests that don't care. */
export const DEFAULT_DIFFICULTY: DifficultyId = "normal";

export interface Difficulty {
  id: DifficultyId;
  name: string;
  /** Everything else (range, alert range, targeting, movement) stays the same. */
  monsterActions: number;
  monsterAttackDamage: number;
  monsterHitPoints: number;
  monsterXp: number;
}

/** A first version, to balance by playtesting (design.md, Difficulties). */
export const DIFFICULTIES: Record<DifficultyId, Difficulty> = {
  normal: { id: "normal", name: "Normal", monsterActions: 1, monsterAttackDamage: 1, monsterHitPoints: 1, monsterXp: 1 },
  hard: { id: "hard", name: "Hard", monsterActions: 2, monsterAttackDamage: 2, monsterHitPoints: 3, monsterXp: 3 },
  heroic: { id: "heroic", name: "Heroic", monsterActions: 3, monsterAttackDamage: 3, monsterHitPoints: 5, monsterXp: 5 },
};

/** A monster type's stats on a difficulty. */
export function monsterStats(type: MonsterTypeId, difficulty: DifficultyId): Stats {
  const base = MONSTER_TYPES[type].stats;
  const d = DIFFICULTIES[difficulty];
  return {
    actions: base.actions * d.monsterActions,
    movement: base.movement,
    attackDamage: base.attackDamage * d.monsterAttackDamage,
    hitPoints: base.hitPoints * d.monsterHitPoints,
  };
}

/** The XP every character gains when a monster of this type dies, on a difficulty. */
export function monsterXp(type: MonsterTypeId, difficulty: DifficultyId): number {
  return MONSTER_TYPES[type].xp * DIFFICULTIES[difficulty].monsterXp;
}

// ---- Unlocking dungeons ----

/** One dungeon a player has won on one difficulty: it is cleared there. */
export interface DungeonWin {
  dungeonId: DungeonId;
  difficulty: DifficultyId;
}

/** Where a player can play: what the host of a party chooses (design.md, Parties and the lobby). */
export interface DungeonChoice {
  dungeonId: DungeonId;
  difficulty: DifficultyId;
}

/**
 * How a dungeon looks on the dungeon map, for one player on one difficulty:
 * won there, the one to win next, or not playable yet.
 */
export type DungeonStatus = "cleared" | "next" | "locked";

/*
 * The functions below take the list of dungeons as a parameter, in the
 * fixed order they are cleared in. The game always passes DUNGEON_IDS (the
 * default); tests pass a longer list to see what happens when a dungeon is
 * added to the end.
 */

export function hasCleared(wins: readonly DungeonWin[], dungeonId: DungeonId, difficulty: DifficultyId): boolean {
  return wins.some((w) => w.dungeonId === dungeonId && w.difficulty === difficulty);
}

/**
 * The first dungeon in the list the player hasn't cleared on this
 * difficulty, or `undefined` when they have cleared them all.
 */
export function nextToClear(
  wins: readonly DungeonWin[],
  difficulty: DifficultyId,
  dungeonIds: readonly DungeonId[] = DUNGEON_IDS,
): DungeonId | undefined {
  return dungeonIds.find((id) => !hasCleared(wins, id, difficulty));
}

export function dungeonStatus(
  wins: readonly DungeonWin[],
  dungeonId: DungeonId,
  difficulty: DifficultyId,
  dungeonIds: readonly DungeonId[] = DUNGEON_IDS,
): DungeonStatus {
  if (!isDifficultyUnlocked(wins, difficulty, dungeonIds)) return "locked";
  if (hasCleared(wins, dungeonId, difficulty)) return "cleared";
  return nextToClear(wins, difficulty, dungeonIds) === dungeonId ? "next" : "locked";
}

/**
 * A difficulty is unlocked when every dungeon is cleared on the one before
 * it, or when the player has cleared any dungeon on it already. The second
 * rule keeps a difficulty unlocked when a new dungeon is added to the end of
 * the list, which the player hasn't cleared on the difficulty before.
 * Normal, the first, is always unlocked.
 */
export function isDifficultyUnlocked(
  wins: readonly DungeonWin[],
  difficulty: DifficultyId,
  dungeonIds: readonly DungeonId[] = DUNGEON_IDS,
): boolean {
  const index = DIFFICULTY_IDS.indexOf(difficulty);
  if (index === 0) return true;
  if (wins.some((w) => w.difficulty === difficulty)) return true;
  return nextToClear(wins, DIFFICULTY_IDS[index - 1]!, dungeonIds) === undefined;
}

/**
 * Whether the player can play a dungeon on a difficulty: the difficulty is
 * unlocked, and the dungeon is cleared on it or the next one to clear.
 */
export function canPlay(
  wins: readonly DungeonWin[],
  choice: DungeonChoice,
  dungeonIds: readonly DungeonId[] = DUNGEON_IDS,
): boolean {
  return dungeonIds.includes(choice.dungeonId) && dungeonStatus(wins, choice.dungeonId, choice.difficulty, dungeonIds) !== "locked";
}

/**
 * Where a player's next game goes on a difficulty: the next dungeon to clear,
 * or the last dungeon when they have cleared them all.
 */
export function nextDungeon(
  wins: readonly DungeonWin[],
  difficulty: DifficultyId,
  dungeonIds: readonly DungeonId[] = DUNGEON_IDS,
): DungeonId {
  return nextToClear(wins, difficulty, dungeonIds) ?? dungeonIds[dungeonIds.length - 1]!;
}

/**
 * What a new game starts with (design.md, Parties and the lobby): the host's
 * next dungeon on the hardest difficulty they have unlocked.
 */
export function defaultChoice(
  wins: readonly DungeonWin[],
  dungeonIds: readonly DungeonId[] = DUNGEON_IDS,
): DungeonChoice {
  const difficulty = DIFFICULTY_IDS.findLast((d) => isDifficultyUnlocked(wins, d, dungeonIds))!;
  return { dungeonId: nextDungeon(wins, difficulty, dungeonIds), difficulty };
}
