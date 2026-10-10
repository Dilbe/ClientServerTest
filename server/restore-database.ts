// Admin script: puts a copy made before migrations back in place of the
// database (architecture.md, Rolling back; README, Restoring the database).
// Run it with the server stopped:
//
//   node server/restore-database.ts game.db.before-step-9
//
// The copy is looked for in the data folder (DATA_DIR, like the server). The
// current database is moved aside, not deleted.

import path from "node:path";
import { databaseFile } from "./config.ts";
import { restoreDatabase } from "./database.ts";

const name = process.argv[2];
if (!name) {
  console.error("Usage: node server/restore-database.ts <copy>, for example game.db.before-step-9");
  process.exit(1);
}

const file = databaseFile();
const copy = path.resolve(path.dirname(file), name);
const aside = restoreDatabase(copy, file);
console.log(`Restored ${copy} to ${file}.`);
console.log(`The database it replaced is now ${aside}.`);
