// Characters: one row per character, with most of the character as JSON
// (see architecture.md, Characters). For now each account has exactly one.

import { z } from "zod";
import { CLASS_IDS, MAX_RANK, maxXp, MIN_RANK } from "../shared/rules/advancement.ts";
import type { Db } from "./database.ts";

/**
 * The JSON part of a character: only facts, never what follows from them
 * (the level follows from the XP). When its shape changes, add a new version
 * here and an upgrade step below, so older records are converted on load.
 */
const characterData = z
  .object({
    version: z.literal(2),
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
 */
const upgrades: Record<number, (old: any) => unknown> = {
  1: (old) => ({ ...old, version: 2, class: "adventurer", rank: 1 }),
};

export function newCharacterData(): CharacterData {
  return { version: 2, class: "adventurer", rank: 1, xp: 0 };
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
  name: string;
  data: CharacterData;
}

export function insertCharacter(db: Db, accountId: number, name: string, now: number): number {
  const result = db
    .prepare("INSERT INTO characters (account_id, name, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .run(accountId, name, JSON.stringify(newCharacterData()), now, now);
  return Number(result.lastInsertRowid);
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

export function charactersOfAccount(db: Db, accountId: number): Character[] {
  const rows = db
    .prepare("SELECT id, account_id, name, data FROM characters WHERE account_id = ? ORDER BY id")
    .all(accountId) as { id: number; account_id: number; name: string; data: string }[];
  return rows.map((row) => ({
    id: row.id,
    accountId: row.account_id,
    name: row.name,
    data: loadCharacterData(row.data),
  }));
}
