// Entry point: starts the web server and the WebSocket endpoint.

import { createServer } from "node:http";
import express from "express";
import { readConfig } from "./config.ts";
import { serveClient } from "./client-files.ts";
import { attachWebSocket } from "./websocket.ts";

const config = readConfig();

const app = express();
// Don't advertise which framework the server runs; it only helps attackers.
app.disable("x-powered-by");

const httpServer = createServer(app);
const version = await serveClient(app, httpServer, config.production);
attachWebSocket(httpServer, version);

httpServer.listen(config.port, config.host, () => {
  const mode = config.production ? "production" : "development";
  console.log(`Server running in ${mode} mode at http://${config.host}:${config.port}`);
});
