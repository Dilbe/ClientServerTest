// Which dungeons each account has won, and the one-time rewards for a first
// win (design.md, Rewards).

import { DUNGEON_IDS, type DungeonId, type OneTimeReward } from "../shared/rules/dungeon-map.ts";
import { insertCharacter } from "./characters.ts";
import type { Db } from "./database.ts";

/** The dungeons the account has won at least once, in the order the lobby offers them. */
export function dungeonsWonBy(db: Db, accountId: number): DungeonId[] {
  const won = new Set(
    db.prepare("SELECT dungeon_id FROM dungeons_won WHERE account_id = ?").pluck().all(accountId) as string[],
  );
  // Ids that are no longer a dungeon are left out, so they can't reach a client.
  return DUNGEON_IDS.filter((id) => won.has(id));
}

export function hasWon(db: Db, accountId: number, dungeonId: DungeonId): boolean {
  const row = db.prepare("SELECT 1 FROM dungeons_won WHERE account_id = ? AND dungeon_id = ?").get(accountId, dungeonId);
  return row !== undefined;
}

/**
 * Records the account's first win of a dungeon and gives its one-time
 * rewards. Called inside the transaction that saves the end of the game
 * (game-store.ts), so the win and the rewards are saved together or not at
 * all.
 *
 * Recording the win and checking that it wasn't there yet is one statement:
 * if the account had somehow won the dungeon already, nothing is inserted and
 * nothing is given, so the rewards can never come twice. (It can't happen in
 * practice: an account is in at most one game, so nothing can win the
 * dungeon for it between the start of a game and its end.)
 */
export function recordFirstWin(
  db: Db,
  accountId: number,
  dungeonId: DungeonId,
  rewards: readonly OneTimeReward[],
  now: number,
): void {
  // The account may have been deleted during the game: then there is
  // nobody to record the win for, and inserting would break the foreign key.
  const inserted = db
    .prepare(
      `INSERT INTO dungeons_won (account_id, dungeon_id)
       SELECT id, ? FROM accounts WHERE id = ?
       ON CONFLICT DO NOTHING`,
    )
    .run(dungeonId, accountId);
  if (inserted.changes === 0) return;
  for (const reward of rewards) {
    switch (reward.type) {
      case "newCharacter":
        insertCharacter(db, accountId, now);
        break;
    }
  }
}
