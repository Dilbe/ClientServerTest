// Which dungeons each account has won on which difficulty, and the one-time
// rewards for a first win (design.md, Rewards and Unlocking dungeons).

import { DIFFICULTY_IDS, type DifficultyId, type DungeonWin } from "../shared/rules/difficulties.ts";
import { DUNGEON_IDS, type DungeonId, type OneTimeReward } from "../shared/rules/dungeon-map.ts";
import { insertCharacter } from "./characters.ts";
import type { Db } from "./database.ts";

/**
 * Every dungeon the account has won, per difficulty: in the order of the
 * difficulties, then of the dungeons. Everything about unlocks is worked out
 * from these (shared/rules/difficulties.ts).
 */
export function dungeonWinsOf(db: Db, accountId: number): DungeonWin[] {
  const rows = db.prepare("SELECT dungeon_id, difficulty FROM dungeons_won WHERE account_id = ?").all(accountId) as {
    dungeon_id: string;
    difficulty: string;
  }[];
  const won = new Set(rows.map((r) => `${r.difficulty}/${r.dungeon_id}`));
  // Ids that are no longer a dungeon or a difficulty are left out, so they
  // can't reach a client.
  return DIFFICULTY_IDS.flatMap((difficulty) =>
    DUNGEON_IDS.filter((dungeonId) => won.has(`${difficulty}/${dungeonId}`)).map((dungeonId) => ({
      dungeonId,
      difficulty,
    })),
  );
}

export function hasWon(db: Db, accountId: number, dungeonId: DungeonId, difficulty: DifficultyId): boolean {
  const row = db
    .prepare("SELECT 1 FROM dungeons_won WHERE account_id = ? AND dungeon_id = ? AND difficulty = ?")
    .get(accountId, dungeonId, difficulty);
  return row !== undefined;
}

/**
 * Records the account's first win of a dungeon on a difficulty and gives its
 * one-time rewards. Called inside the transaction that saves the end of the
 * game (game-store.ts), so the win and the rewards are saved together or not
 * at all.
 *
 * Recording the win and checking that it wasn't there yet is one statement:
 * if the account had somehow won the dungeon on this difficulty already,
 * nothing is inserted and nothing is given, so the rewards can never come
 * twice. (It can't happen in practice: an account is in at most one game, so
 * nothing can win the dungeon for it between the start of a game and its end.)
 */
export function recordFirstWin(
  db: Db,
  accountId: number,
  dungeonId: DungeonId,
  difficulty: DifficultyId,
  rewards: readonly OneTimeReward[],
  now: number,
): void {
  // The account may have been deleted during the game: then there is
  // nobody to record the win for, and inserting would break the foreign key.
  const inserted = db
    .prepare(
      `INSERT INTO dungeons_won (account_id, dungeon_id, difficulty)
       SELECT id, ?, ? FROM accounts WHERE id = ?
       ON CONFLICT DO NOTHING`,
    )
    .run(dungeonId, difficulty, accountId);
  if (inserted.changes === 0) return;
  for (const reward of rewards) {
    switch (reward.type) {
      case "newCharacter":
        insertCharacter(db, accountId, now);
        break;
    }
  }
}
