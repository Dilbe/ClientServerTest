// A one-time migration step (issue #155, see database.ts): before then, a
// first win on Hard or Heroic gave a new level 1, rank 1 character, like a
// win on Normal. Now Hard gives rank 2 and Heroic rank 3 (design.md,
// Rewards). Players who won on Hard or Heroic before get what those wins give
// now, by upgrading characters they already have:
//
// - First, per Heroic win: the character with the lowest rank, then the
//   lowest level, below rank 3, becomes a level 1, rank 3 character.
// - Then, per Hard win: the rank 1 character with the lowest level becomes a
//   level 1, rank 2 character.
// - When two characters are equally low, the newest one (highest number) is
//   picked: most likely the reward character itself.
// - A character is upgraded at most once.
// - Level 1 means no XP and no upgrades. The name, the class and the kill
//   counts (diminishing returns) stay.
// - When no character fits, for example because all rank 1 characters were
//   ranked up, the account gets a new level 1 character of that rank.
//
// It follows the rules of the issue, not the reward data in
// shared/rules/dungeon-map.ts: it corrects what past wins gave, which a later
// change to the rewards shouldn't change.

import { levelFromXp } from "../shared/rules/advancement.ts";
import { insertCharacter, loadCharacterData, newCharacterData, type CharacterData } from "./characters.ts";
import type { Db } from "./database.ts";

/** What a Heroic and a Hard win give now, in the order they are handled. */
const UPGRADES = [
  { difficulty: "heroic", rank: 3, fits: (data: CharacterData) => data.rank < 3 },
  { difficulty: "hard", rank: 2, fits: (data: CharacterData) => data.rank === 1 },
] as const;

export function upgradePastWinRewards(db: Db, now: number): void {
  const accounts = db.prepare("SELECT DISTINCT account_id FROM dungeons_won").pluck().all() as number[];
  for (const accountId of accounts) upgradeAccount(db, accountId, now);
}

function upgradeAccount(db: Db, accountId: number, now: number): void {
  const characters = (
    db.prepare("SELECT id, number, data FROM characters WHERE account_id = ?").all(accountId) as {
      id: number;
      number: number;
      data: string;
    }[]
  ).map((row) => ({ id: row.id, number: row.number, data: loadCharacterData(row.data) }));
  const upgraded = new Set<number>();
  const save = db.prepare("UPDATE characters SET data = ?, updated_at = ? WHERE id = ?");

  for (const { difficulty, rank, fits } of UPGRADES) {
    const wins = db
      .prepare("SELECT COUNT(*) FROM dungeons_won WHERE account_id = ? AND difficulty = ?")
      .pluck()
      .get(accountId, difficulty) as number;
    for (let i = 0; i < wins; i++) {
      const candidates = characters
        .filter((c) => !upgraded.has(c.id) && fits(c.data))
        .sort(
          (a, b) =>
            a.data.rank - b.data.rank ||
            levelFromXp(a.data.xp, a.data.class, a.data.rank) - levelFromXp(b.data.xp, b.data.class, b.data.rank) ||
            b.number - a.number,
        );
      const picked = candidates[0];
      if (picked) {
        picked.data = { ...picked.data, rank, xp: 0, upgrades: [] };
        save.run(JSON.stringify(picked.data), now, picked.id);
        upgraded.add(picked.id);
      } else {
        insertCharacter(db, accountId, now, { ...newCharacterData(), rank });
      }
    }
  }
}
