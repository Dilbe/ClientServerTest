// Entry point: opens the database and starts the server.

import { addErrorHandler, createAppServer } from "./app.ts";
import { serveClient } from "./client-files.ts";
import { readConfig } from "./config.ts";
import { openDatabase, restoreOnStartup } from "./database.ts";
import { deleteExpiredSessions } from "./sessions.ts";

const config = readConfig();
// Before the database is opened: nothing may be using it while it's replaced.
try {
  const restored = restoreOnStartup(config.restoreDatabase, config.databaseFile);
  if (restored) {
    console.log(`Restored the database from ${restored.copy}.`);
    console.log(`The database it replaced is now ${restored.aside}.`);
  }
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}
const db = openDatabase(config.databaseFile);
setInterval(() => deleteExpiredSessions(db), 60 * 60 * 1000).unref();

let version = "";
const { app, httpServer, stopGames } = createAppServer({ ...config, db, version: () => version });
version = await serveClient(app, httpServer, config.production);
addErrorHandler(app);

httpServer.listen(config.port, config.host, () => {
  const mode = config.production ? "production" : "development";
  console.log(`Server running in ${mode} mode at http://${config.host}:${config.port}`);
});

// A normal shutdown. A deploy or `docker stop` sends SIGTERM, Ctrl+C sends
// SIGINT, and `npm run dev` sends SIGTERM when it restarts after a change.
// These are signals, the Unix way of asking a process to stop, comparable to
// OnStop in a Windows service. Without a handler, Node stops at once. Here
// the server time is saved first, so the downtime until the next start
// doesn't count as game time, and the database is closed cleanly.
//
// Running games need nothing else: every change was saved when it happened.
// After a crash (no signal at all) they come back the same way, only the
// last few seconds of game time may be lost.
function shutdown(signal: string): void {
  console.log(`${signal} received, stopping.`);
  stopGames();
  db.close();
  process.exit(0);
}
process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
