// Creating accounts and checking passwords.

import argon2, { type HashOptions } from "argon2";
import { accountNameKey, displayNameKey, type SignupRequest } from "../shared/accounts.ts";
import { insertCharacter } from "./characters.ts";
import type { Db } from "./database.ts";

/**
 * argon2id settings, following the OWASP recommendation (19 MiB, 2 passes).
 * Each hash deliberately costs memory and time, so guessing passwords from a
 * stolen database is slow. Larger values are safer but also cost the server
 * that much memory for every login at the same moment.
 */
const HASH_OPTIONS: HashOptions = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };

// A real hash of a random password. Verifying against it when the account
// doesn't exist makes that answer take as long as a wrong password, so the
// response time doesn't reveal which account names exist.
const DUMMY_HASH = await argon2.hash(crypto.randomUUID(), HASH_OPTIONS);

export interface Account {
  id: number;
  accountName: string;
  displayName: string;
}

export type SignupResult =
  | { ok: true; account: Account }
  | { ok: false; reason: "account-name-taken" | "display-name-taken" };

export async function createAccount(db: Db, request: SignupRequest, now = Date.now()): Promise<SignupResult> {
  // The hash includes a random salt, so two equal passwords get different hashes.
  // argon2.hash runs on a background thread, so it doesn't block other players.
  const passwordHash = await argon2.hash(request.password, HASH_OPTIONS);

  // After the await: everything below is synchronous, so it runs in one go.
  // The UNIQUE constraints decide whether a name is free; checking first and
  // inserting later could let two sign-ups take the same name.
  try {
    const insert = db.transaction(() => {
      const accountId = Number(
        db
          .prepare(
            `INSERT INTO accounts (account_name, account_name_key, display_name, password_hash, created_at)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .run(request.accountName, accountNameKey(request.accountName), request.displayName, passwordHash, now)
          .lastInsertRowid,
      );
      db.prepare("INSERT INTO display_names (name_key, account_id) VALUES (?, ?)").run(
        displayNameKey(request.displayName),
        accountId,
      );
      insertCharacter(db, accountId, request.displayName, now);
      return accountId;
    });
    const id = insert();
    return { ok: true, account: { id, accountName: request.accountName, displayName: request.displayName } };
  } catch (error) {
    const message = String((error as Error).message);
    if (message.includes("accounts.account_name_key")) return { ok: false, reason: "account-name-taken" };
    if (message.includes("display_names.name_key")) return { ok: false, reason: "display-name-taken" };
    throw error;
  }
}

/** Returns the account when the name and password match, otherwise `undefined`. */
export async function checkLogin(db: Db, accountName: string, password: string): Promise<Account | undefined> {
  const row = db
    .prepare(
      "SELECT id, account_name, display_name, password_hash, disabled FROM accounts WHERE account_name_key = ?",
    )
    .get(accountNameKey(accountName)) as
    | { id: number; account_name: string; display_name: string; password_hash: string; disabled: number }
    | undefined;

  const matches = await argon2.verify(row?.password_hash ?? DUMMY_HASH, password);
  if (!row || !matches || row.disabled) return undefined;
  return { id: row.id, accountName: row.account_name, displayName: row.display_name };
}

export function findAccount(db: Db, id: number): Account | undefined {
  const row = db
    .prepare("SELECT id, account_name, display_name FROM accounts WHERE id = ? AND disabled = 0")
    .get(id) as { id: number; account_name: string; display_name: string } | undefined;
  return row && { id: row.id, accountName: row.account_name, displayName: row.display_name };
}
