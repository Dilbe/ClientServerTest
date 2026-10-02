// Login sessions: a long random token in a cookie, and its hash in the database.

import { createHash, randomBytes } from "node:crypto";
import type { Db } from "./database.ts";

export const SESSION_DAYS = 30;
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;
/** Extend a session at most this often, so not every request writes to the database. */
const EXTEND_AFTER_MS = 60 * 60 * 1000;

/**
 * Only the hash of a token is stored. Someone who reads the database (a
 * backup, a leak) can't use what they find to log in. A fast hash (SHA-256) is
 * enough here, unlike for passwords: the token is 32 random bytes, so there
 * is nothing to guess.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Creates a session and returns the token for the cookie. */
export function createSession(db: Db, accountId: number, now = Date.now()): string {
  // crypto.randomBytes is a cryptographically secure generator. Math.random()
  // is not: its output can be predicted.
  const token = randomBytes(32).toString("base64url");
  db.prepare("INSERT INTO sessions (token_hash, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)").run(
    hashToken(token),
    accountId,
    now,
    now + SESSION_MS,
  );
  return token;
}

export interface Session {
  tokenHash: string;
  accountId: number;
  /** true when the expiry moved, so the cookie should be sent again with the new expiry. */
  extended: boolean;
}

/**
 * Looks up the session for a token. A valid session is extended (sliding
 * expiry): it ends after 30 days without using the game.
 */
export function useSession(db: Db, token: string, now = Date.now()): Session | undefined {
  const tokenHash = hashToken(token);
  const row = db.prepare("SELECT account_id, expires_at FROM sessions WHERE token_hash = ?").get(tokenHash) as
    | { account_id: number; expires_at: number }
    | undefined;
  if (!row) return undefined;
  if (row.expires_at <= now) {
    db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
    return undefined;
  }
  const extended = now + SESSION_MS - row.expires_at > EXTEND_AFTER_MS;
  if (extended) {
    db.prepare("UPDATE sessions SET expires_at = ? WHERE token_hash = ?").run(now + SESSION_MS, tokenHash);
  }
  return { tokenHash, accountId: row.account_id, extended };
}

export function deleteSession(db: Db, tokenHash: string): void {
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
}

export function deleteExpiredSessions(db: Db, now = Date.now()): void {
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now);
}
