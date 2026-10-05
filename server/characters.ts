// Characters: one row per character, with most of the character as JSON
// (see architecture.md, Characters).

import { z } from "zod";
import { adventurerPrice, CLASS_IDS, MAX_RANK, maxXp, MIN_RANK } from "../shared/rules/advancement.ts";
import { characterName } from "../shared/characters.ts";
import type { Db } from "./database.ts";

/**
 * The JSON part of a character: only facts, never what follows from them
 * (the level follows from the XP). When its shape changes, add a new version
 * here and an upgrade step below, so older records are converted on load.
 */
const characterData = z
  .object({
    version: z.literal(3),
    /** Only when the player chose one; otherwise the default name is shown. */
    name: characterName.optional(),
    class: z.enum(CLASS_IDS),
    rank: z.number().int().min(MIN_RANK).max(MAX_RANK),
    /** The total XP. Never more than the max level of its rank needs. */
    xp: z.number().int().nonnegative(),
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
 */
const upgrades: Record<number, (old: any) => unknown> = {
  1: (old) => ({ ...old, version: 2, class: "adventurer", rank: 1 }),
  2: (old) => ({ ...old, version: 3 }),
};

export function newCharacterData(): CharacterData {
  return { version: 3, class: "adventurer", rank: 1, xp: 0 };
}

/**
 * Turns stored JSON into character data: upgrades it to the current version,
 * then checks it. A bad record throws here, at once, instead of causing odd
 * behaviour later.
 */
export function loadCharacterData(json: string): CharacterData {
  let data = JSON.parse(json);
  while (typeof data?.version === "number" && upgrades[data.version]) {
    data = upgrades[data.version]!(data);
  }
  return characterData.parse(data);
}

export interface Character {
  id: number;
  accountId: number;
  /** The number within the account: 1, 2, 3, ... Never reused. */
  number: number;
  data: CharacterData;
}

/**
 * Adds a new level 1, rank 1 adventurer with the account's next number.
 * Numbers are never reused (design.md, Characters), so this relies on
 * characters never being deleted: a rank-up has to keep the characters it
 * uses up, or this could hand out a number again. Finding the next number
 * and inserting is one statement, so it can't be split.
 */
export function insertCharacter(db: Db, accountId: number, now: number): number {
  const result = db
    .prepare(
      `INSERT INTO characters (account_id, number, data, created_at, updated_at)
       SELECT ?, COALESCE(MAX(number), 0) + 1, ?, ?, ? FROM characters WHERE account_id = ?`,
    )
    .run(accountId, JSON.stringify(newCharacterData()), now, now, accountId);
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

/** The account's characters, by number: the first is the one with the lowest number. */
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
    const row = db.prepare("SELECT id, data FROM characters WHERE account_id = ? AND number = ?").get(accountId, number) as
      | { id: number; data: string }
      | undefined;
    if (!row) return { ok: false, reason: "no-such-character" };
    const { name: _old, ...rest } = loadCharacterData(row.data);
    const updated: CharacterData = name === null ? rest : { ...rest, name };
    db.prepare("UPDATE characters SET data = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(updated), now, row.id);
    return { ok: true };
  })();
}

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
