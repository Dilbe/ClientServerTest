// The medical bay's and the tavern's speed-ups of an account (design.md, The
// medical bay and the tavern; issue #298), read from its running jobs.
//
// A module of its own because both characters.ts (the rest after a dungeon)
// and village.ts (the rests that change when a hero comes or goes) need it,
// and village.ts already imports characters.ts. It only reads the jobs
// table, so it imports neither.

import { NO_SPEED_UPS, type RestSpeedUps } from "../shared/rules/rest.ts";
import { BUILDING_IDS, BUILDINGS, type BuildingId } from "../shared/rules/village.ts";
import type { Db } from "./database.ts";

/**
 * The account's speed-ups at `now`: the hero in the medical bay speeds up
 * healing, the one in the tavern resting, each until its job ends. The
 * speed was stored in the job's per_hour when it started (see `startJob`),
 * like what a job in the woodcutter earns.
 */
export function restSpeedUps(db: Db, accountId: number, now: number): RestSpeedUps {
  const rows = db
    .prepare("SELECT building_id, per_hour, ends_at FROM village_jobs WHERE account_id = ? AND ends_at > ?")
    .all(accountId, now) as { building_id: string; per_hour: number; ends_at: number }[];
  const speedUps: RestSpeedUps = { ...NO_SPEED_UPS };
  for (const row of rows) {
    if (!(BUILDING_IDS as readonly string[]).includes(row.building_id)) continue;
    const speedsUp = BUILDINGS[row.building_id as BuildingId].speedsUp;
    if (speedsUp) speedUps[speedsUp] = { speed: row.per_hour, until: row.ends_at };
  }
  return speedUps;
}
