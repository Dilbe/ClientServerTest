// Characters: one row per character, with most of the character as JSON
// (see architecture.md, Characters).

import { z } from "zod";
import {
  adventurerPrice,
  canRankUp,
  CLASS_IDS,
  levelFromXp,
  MAX_RANK,
  maxXp,
  MIN_RANK,
  upgradePointsEarned,
} from "../shared/rules/advancement.ts";
import { UPGRADABLE_STAT_IDS, type UpgradableStatId } from "../shared/rules/stats.ts";
import { MIN_LEVEL_TO_RESET, nextUpgradeCost, pointsLeft, pointsSpent, xpAfterReset } from "../shared/rules/upgrades.ts";
import { characterName } from "../shared/characters.ts";
import type { Db } from "./database.ts";

/**
 * The JSON part of a character: only facts, never what follows from them
 * (the level follows from the XP). When its shape changes, add a new version
 * here and an upgrade step below, so older records are converted on load.
 */
const characterData = z
  .object({
    version: z.literal(5),
    /** Only when the player chose one; otherwise the default name is shown. */
    name: characterName.optional(),
    class: z.enum(CLASS_IDS),
    rank: z.number().int().min(MIN_RANK).max(MAX_RANK),
    /** The total XP. Never more than the max level of its rank needs. */
    xp: z.number().int().nonnegative(),
    /** Every stat upgrade bought, in order, with what was paid for it. */
    upgrades: z.array(z.object({ stat: z.enum(UPGRADABLE_STAT_IDS), paid: z.number().int().positive() })),
  })
  .refine((data) => data.xp <= maxXp(data.rank), "More XP than the max level of its rank needs.");
export type CharacterData = z.infer<typeof characterData>;

/**
 * Converts older versions of the JSON, one version at a time: the step for
 * version n returns version n + 1. Stored rows aren't rewritten here; a
 * record gets the new shape the next time it is saved.
 *
 * - 1 → 2 (issue #27): characters get a class and a rank. Every character
 *   so far was a new adventurer, so they become rank 1 adventurers.
 * - 2 → 3 (issue #53): characters can have a name. No character has one
 *   yet, so only the version changes.
 * - 3 → 4 (issue #54): characters store the stat upgrades they bought.
 *   None could be bought before, so every character starts with none.
 * - 4 → 5 (issue #94): movement can no longer be upgraded. Movement upgrades
 *   are removed, which gives back the points paid for them; the other
 *   upgrades stay as they were.
 */
const versionUpgrades: Record<number, (old: any) => unknown> = {
  1: (old) => ({ ...old, version: 2, class: "adventurer", rank: 1 }),
  2: (old) => ({ ...old, version: 3 }),
  3: (old) => ({ ...old, version: 4, upgrades: [] }),
  4: (old) => ({ ...old, version: 5, upgrades: old.upgrades?.filter((upgrade: any) => upgrade?.stat !== "movement") }),
};

export function newCharacterData(): CharacterData {
  return { version: 5, class: "adventurer", rank: 1, xp: 0, upgrades: [] };
}

/**
 * Turns stored JSON into character data: upgrades it to the current version,
 * then checks it. A bad record throws here, at once, instead of causing odd
 * behaviour later.
 *
 * Then the safety net (design.md, Upgrade points): if a balance change left
 * the character with more points spent than its level has earned, its
 * upgrades are reset for free; it keeps its level. Like a version upgrade,
 * this isn't written back here: the record gets it the next time it is saved.
 */
export function loadCharacterData(json: string): CharacterData {
  let data = JSON.parse(json);
  while (typeof data?.version === "number" && versionUpgrades[data.version]) {
    data = versionUpgrades[data.version]!(data);
  }
  const checked = characterData.parse(data);
  const earned = upgradePointsEarned(levelFromXp(checked.xp, checked.rank));
  if (pointsSpent(checked.upgrades) > earned) return { ...checked, upgrades: [] };
  return checked;
}

export interface Character {
  id: number;
  accountId: number;
  /** The number within the account: 1, 2, 3, ... Never reused. */
  number: number;
  data: CharacterData;
}

/**
 * Adds a character with the account's next number: by default a new level 1,
 * rank 1 adventurer. Finding the next number and inserting is one statement,
 * so it can't be split.
 *
 * Numbers are never reused (design.md, Characters), yet the next number is
 * simply the highest one plus 1. That works because the highest number never
 * goes down: characters are only deleted by a rank-up, which adds its new
 * character first (see `rankUp`), and by deleting the whole account.
 */
export function insertCharacter(db: Db, accountId: number, now: number, data = newCharacterData()): number {
  const result = db
    .prepare(
      `INSERT INTO characters (account_id, number, data, created_at, updated_at)
       SELECT ?, COALESCE(MAX(number), 0) + 1, ?, ?, ? FROM characters WHERE account_id = ?`,
    )
    .run(accountId, JSON.stringify(data), now, now, accountId);
  return Number(result.lastInsertRowid);
}

export type BuyResult = { ok: true } | { ok: false; reason: "not-enough-silver" };

/**
 * Buys a level 1, rank 1 adventurer (design.md, Getting more characters).
 * The price is worked out here, from what is stored: never from a number the
 * client sends. Checking the silver, taking it and adding the character are
 * one transaction, so a crash can't take the silver without adding the
 * character. Whether the account is in a game is checked by the caller,
 * which knows the lobby.
 */
export function buyAdventurer(db: Db, accountId: number, now: number): BuyResult {
  return db.transaction((): BuyResult => {
    const { count } = db.prepare("SELECT COUNT(*) AS count FROM characters WHERE account_id = ?").get(accountId) as {
      count: number;
    };
    const price = adventurerPrice(count);
    // Only takes the silver when there is enough: no row changes otherwise.
    const paid = db
      .prepare("UPDATE accounts SET silver = silver - ? WHERE id = ? AND silver >= ?")
      .run(price, accountId, price);
    if (paid.changes === 0) return { ok: false, reason: "not-enough-silver" };
    insertCharacter(db, accountId, now);
    return { ok: true };
  })();
}

/**
 * Adds XP from a finished dungeon to a character record, up to what the max
 * level of its rank needs. The game already stops at that limit; checking
 * again here keeps a bad number from ever reaching the record.
 */
export function addXp(db: Db, recordId: number, xp: number, now: number): void {
  const row = db.prepare("SELECT data FROM characters WHERE id = ?").get(recordId) as { data: string } | undefined;
  // The account (and with it the character) may have been deleted meanwhile.
  if (!row) return;
  const data = loadCharacterData(row.data);
  const updated: CharacterData = { ...data, xp: Math.min(maxXp(data.rank), data.xp + xp) };
  db.prepare("UPDATE characters SET data = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(updated), now, recordId);
}

export type RenameResult = { ok: true } | { ok: false; reason: "no-such-character" };

/**
 * Gives one of the account's characters a name, or (with `null`) takes it
 * away so the default name shows again. The character is found by account
 * and number, so a player can only ever rename their own.
 */
export function renameCharacter(
  db: Db,
  accountId: number,
  number: number,
  name: string | null,
  now: number,
): RenameResult {
  return db.transaction((): RenameResult => {
    const row = findCharacterRow(db, accountId, number);
    if (!row) return { ok: false, reason: "no-such-character" };
    const { name: _old, ...rest } = loadCharacterData(row.data);
    saveCharacterData(db, row.id, name === null ? rest : { ...rest, name }, now);
    return { ok: true };
  })();
}

export type UpgradeResult = { ok: true } | { ok: false; reason: "no-such-character" | "not-enough-points" };

/**
 * Upgrades one stat of one of the account's characters by 1 (design.md,
 * Upgrade points). The cost is worked out here from the stored upgrades and
 * today's costs, never taken from the client, and stored with the upgrade.
 * Checking the points and saving the upgrade happen in one transaction.
 * Whether the account is in a game is checked by the caller.
 */
export function upgradeStat(
  db: Db,
  accountId: number,
  number: number,
  stat: UpgradableStatId,
  now: number,
): UpgradeResult {
  return db.transaction((): UpgradeResult => {
    const row = findCharacterRow(db, accountId, number);
    if (!row) return { ok: false, reason: "no-such-character" };
    const data = loadCharacterData(row.data);
    const cost = nextUpgradeCost(data.upgrades, stat);
    if (cost > pointsLeft(levelFromXp(data.xp, data.rank), data.upgrades)) {
      return { ok: false, reason: "not-enough-points" };
    }
    const updated: CharacterData = { ...data, upgrades: [...data.upgrades, { stat, paid: cost }] };
    saveCharacterData(db, row.id, updated, now);
    return { ok: true };
  })();
}

export type ResetResult = { ok: true } | { ok: false; reason: "no-such-character" | "level-too-low" };

/**
 * Resets all upgrades of one of the account's characters (design.md,
 * Resetting upgrades): it loses one level, its XP goes back to the start of
 * that level, and all its upgrades are gone. Level 1 has no level to lose.
 */
export function resetUpgrades(db: Db, accountId: number, number: number, now: number): ResetResult {
  return db.transaction((): ResetResult => {
    const row = findCharacterRow(db, accountId, number);
    if (!row) return { ok: false, reason: "no-such-character" };
    const data = loadCharacterData(row.data);
    const level = levelFromXp(data.xp, data.rank);
    if (level < MIN_LEVEL_TO_RESET) return { ok: false, reason: "level-too-low" };
    saveCharacterData(db, row.id, { ...data, xp: xpAfterReset(level), upgrades: [] }, now);
    return { ok: true };
  })();
}

export type RankUpResult =
  | { ok: true; number: number }
  | { ok: false; reason: "no-such-character" | "different-class-or-rank" | "not-max-level" | "max-rank" };

/**
 * Uses up two of the account's characters to make one of the next rank
 * (design.md, Class and rank): both of the same class and rank, both at the
 * max level of that rank, and below rank 5. The new character starts at
 * level 1 with 0 XP, no upgrades and the default name, and gets the next
 * number. Returns that number. Whether the account is in a game is checked
 * by the caller.
 *
 * One transaction: a crash can't remove one character without the other,
 * or remove both without adding the new one.
 */
export function rankUp(db: Db, accountId: number, first: number, second: number, now: number): RankUpResult {
  return db.transaction((): RankUpResult => {
    const rows = [findCharacterRow(db, accountId, first), findCharacterRow(db, accountId, second)];
    // The same number twice would be one character used up twice.
    if (first === second || !rows[0] || !rows[1]) return { ok: false, reason: "no-such-character" };
    const [a, b] = rows.map((row) => loadCharacterData(row!.data)) as [CharacterData, CharacterData];
    if (a.class !== b.class || a.rank !== b.rank) return { ok: false, reason: "different-class-or-rank" };
    if (a.rank >= MAX_RANK) return { ok: false, reason: "max-rank" };
    if (!canRankUp(a.xp, a.rank) || !canRankUp(b.xp, b.rank)) return { ok: false, reason: "not-max-level" };

    // The new character first, then the old ones: while it is added, the old
    // numbers are still there, so it gets a number above all of them and no
    // number is ever handed out twice (see `insertCharacter`).
    const id = insertCharacter(db, accountId, now, { ...newCharacterData(), class: a.class, rank: a.rank + 1 });
    // Deleting a character also removes its rows in game_members (ON DELETE
    // CASCADE), as deleting an account does. Stored games keep their events,
    // which only hold game-local numbers; they just no longer point to it.
    const remove = db.prepare("DELETE FROM characters WHERE id = ?");
    for (const row of rows) remove.run(row!.id);
    const { number } = db.prepare("SELECT number FROM characters WHERE id = ?").get(id) as { number: number };
    return { ok: true, number };
  })();
}

/**
 * Finds a character by account and number, so a player can only ever reach
 * their own: someone else's number simply isn't found.
 */
function findCharacterRow(db: Db, accountId: number, number: number): { id: number; data: string } | undefined {
  return db.prepare("SELECT id, data FROM characters WHERE account_id = ? AND number = ?").get(accountId, number) as
    | { id: number; data: string }
    | undefined;
}

function saveCharacterData(db: Db, recordId: number, data: CharacterData, now: number): void {
  db.prepare("UPDATE characters SET data = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(data), now, recordId);
}

/** The account's characters, by number: the first is the one with the lowest number. */
export function charactersOfAccount(db: Db, accountId: number): Character[] {
  const rows = db
    .prepare("SELECT id, account_id, number, data FROM characters WHERE account_id = ? ORDER BY number")
    .all(accountId) as { id: number; account_id: number; number: number; data: string }[];
  return rows.map((row) => ({
    id: row.id,
    accountId: row.account_id,
    number: row.number,
    data: loadCharacterData(row.data),
  }));
}
