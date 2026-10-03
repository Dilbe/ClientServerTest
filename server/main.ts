// Entry point: opens the database and starts the server.

import { addErrorHandler, createAppServer } from "./app.ts";
import { serveClient } from "./client-files.ts";
import { readConfig } from "./config.ts";
import { openDatabase } from "./database.ts";
import { deleteExpiredSessions } from "./sessions.ts";

const config = readConfig();
const db = openDatabase(config.databaseFile);
setInterval(() => deleteExpiredSessions(db), 60 * 60 * 1000).unref();

let version = "";
const { app, httpServer } = createAppServer({ ...config, db, version: () => version });
version = await serveClient(app, httpServer, config.production);
addErrorHandler(app);

httpServer.listen(config.port, config.host, () => {
  const mode = config.production ? "production" : "development";
  console.log(`Server running in ${mode} mode at http://${config.host}:${config.port}`);
});
