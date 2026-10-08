// Rules for account names, display names and passwords, plus the shapes of
// the account requests. Shared so the client can point out mistakes before
// sending; the server checks everything again, because a request doesn't
// have to come from our client.

import { z } from "zod";
import type { HintId } from "./hints.ts";

export const ACCOUNT_NAME_RULES = "3 to 32 characters: letters a-z, digits, '.', '_' or '-'.";
export const DISPLAY_NAME_RULES = "3 to 20 characters: letters a-z, digits, spaces, '_' or '-'.";
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 200;

export const accountName = z.string().regex(/^[A-Za-z0-9._-]{3,32}$/, ACCOUNT_NAME_RULES);

// Only plain ASCII letters: letters from other alphabets can look identical
// (Cyrillic "о" vs Latin "o") and would let someone imitate another player.
// No spaces at the start or end, and no double spaces.
export const displayName = z
  .string()
  .regex(/^[A-Za-z0-9_-]+( [A-Za-z0-9_-]+)*$/, DISPLAY_NAME_RULES)
  .min(3, DISPLAY_NAME_RULES)
  .max(20, DISPLAY_NAME_RULES);

export const password = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `At least ${PASSWORD_MIN_LENGTH} characters.`)
  .max(PASSWORD_MAX_LENGTH, `At most ${PASSWORD_MAX_LENGTH} characters.`);

/** Account names are compared case-insensitively: "Bob" and "bob" are the same account. */
export function accountNameKey(name: string): string {
  return name.toLowerCase();
}

/**
 * Display names are compared case-insensitively and without separators, so
 * "Bob", "BOB", "b o b" and "Bob_" all count as the same name.
 */
export function displayNameKey(name: string): string {
  return name.toLowerCase().replace(/[ _-]/g, "");
}

export const signupRequest = z.object({ accountName, displayName, password });
export type SignupRequest = z.infer<typeof signupRequest>;

// Logging in doesn't check the name and password rules: a wrong login gets
// the same answer no matter why it is wrong. Only the size is limited.
export const loginRequest = z.object({
  accountName: z.string().max(100),
  password: z.string().max(PASSWORD_MAX_LENGTH),
});
export type LoginRequest = z.infer<typeof loginRequest>;

/** What the client learns about the logged-in player. */
export interface Me {
  displayName: string;
  /** Won with dungeons; belongs to the account, not to a character. */
  silver: number;
  /** The one-time hints this player has seen, so they aren't shown again (shared/hints.ts). */
  hintsSeen: HintId[];
}

/** Public settings the client shows, from the server's configuration. */
export interface ServerInfo {
  contactEmail: string | null;
}

/** The body of an error response from the API. */
export interface ApiError {
  error: string;
}
