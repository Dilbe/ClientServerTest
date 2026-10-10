// A one-time migration step (issue #161, see database.ts): new accounts start
// with 3 level 1, rank 1 adventurers instead of 1, and accounts made before
// get the missing ones. Every account gets them, whatever it has now: what it
// bought or won since is its own, not instead of the starting characters.

import { insertCharacter } from "./characters.ts";
import type { Db } from "./database.ts";

export function addStartingCharacters(db: Db, count: number, now: number): void {
  const accounts = db.prepare("SELECT id FROM accounts").pluck().all() as number[];
  for (const accountId of accounts) {
    for (let i = 0; i < count; i++) insertCharacter(db, accountId, now);
  }
}
