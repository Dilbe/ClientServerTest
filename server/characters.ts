// Characters: one row per character, with most of the character as JSON
// (see architecture.md, Characters). For now each account has exactly one.

import { z } from "zod";
import type { Db } from "./database.ts";

/**
 * The JSON part of a character. When its shape changes, add a new version
 * here and an upgrade step below, so older records are converted on load.
 */
const characterData = z.object({
  version: z.literal(1),
  xp: z.number().int().nonnegative(),
});
export type CharacterData = z.infer<typeof characterData>;

/** Converts older versions of the JSON, one version at a time. None yet. */
const upgrades: Record<number, (old: any) => unknown> = {};

export function newCharacterData(): CharacterData {
  return { version: 1, xp: 0 };
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
