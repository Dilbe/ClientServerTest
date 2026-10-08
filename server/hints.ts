// The one-time hints each account has seen (design.md, Rewards).

import { HINT_IDS, type HintId } from "../shared/hints.ts";
import type { Db } from "./database.ts";

/** The hints the account has seen, in the order of HINT_IDS. */
export function hintsSeen(db: Db, accountId: number): HintId[] {
  const rows = db.prepare("SELECT hint_id FROM hints_seen WHERE account_id = ?").all(accountId) as {
    hint_id: string;
  }[];
  const seen = new Set(rows.map((r) => r.hint_id));
  // Only known ids: a row for a hint that no longer exists is left out.
  return HINT_IDS.filter((id) => seen.has(id));
}

/** Marks a hint as seen. Marking it again changes nothing. */
export function markHintSeen(db: Db, accountId: number, hint: HintId): void {
  db.prepare("INSERT OR IGNORE INTO hints_seen (account_id, hint_id) VALUES (?, ?)").run(accountId, hint);
}
