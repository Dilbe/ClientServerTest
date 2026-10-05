// Puts the server together: security headers, the account API and the
// WebSocket. main.ts adds the client files; tests use this without them.

import { createServer, type Server } from "node:http";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { createApi } from "./api.ts";
import type { Db } from "./database.ts";
import { Lobby } from "./lobby.ts";
import { securityHeaders } from "./security-headers.ts";
import { attachWebSocket, Connections } from "./websocket.ts";

export interface AppOptions {
  db: Db;
  production: boolean;
  trustProxy: boolean;
  publicOrigin: string | undefined;
  contactEmail: string | undefined;
  signupsPerHour?: number;
  /** How long one turn cycle lasts (see config.ts). */
  turnCycleMs: number;
  /** Returns the client version; called once the client files are set up. */
  version: () => string;
}

export interface AppServer {
  app: Express;
  httpServer: Server;
  /** For a normal shutdown: stops the game timers and saves the server time. */
  stopGames: () => void;
}

export function createAppServer(options: AppOptions): AppServer {
  const { db } = options;
  const app = express();
  // Don't advertise which framework the server runs; it only helps attackers.
  app.disable("x-powered-by");
  // Trust exactly one proxy: the hosting platform's. It appends the address it
  // saw to X-Forwarded-For, after anything the client sent itself, so only the
  // last entry can be trusted. With `true`, Express would read the first
  // entry, which the client can fake to dodge the rate limits.
  app.set("trust proxy", options.trustProxy ? 1 : false);
  app.use(securityHeaders(options.production));

  const connections = new Connections();
  // The API needs the lobby too: the character page refuses changes while
  // the account is in a game.
  const lobby = new Lobby((accountId) => connections.isOnline(accountId));
  app.use(
    "/api",
    createApi({
      db,
      connections,
      isInGame: (accountId) => lobby.gameIdOf(accountId) !== undefined,
      secureCookies: options.production,
      publicOrigin: options.publicOrigin,
      contactEmail: options.contactEmail,
      signupsPerHour: options.signupsPerHour,
    }),
  );

  const httpServer = createServer(app);
  const stopGames = attachWebSocket(httpServer, connections, lobby, {
    db,
    version: options.version,
    publicOrigin: options.publicOrigin,
    turnCycleMs: options.turnCycleMs,
  });
  return { app, httpServer, stopGames };
}

/**
 * The last handler, for errors outside the API (for example while serving a
 * file). Without it, Express's built-in handler would show the error's stack
 * trace in the browser unless NODE_ENV is "production".
 */
export function addErrorHandler(app: Express): void {
  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    const status = (error as { status?: number }).status;
    if (status === undefined || status >= 500) console.error(error);
    response.status(status ?? 500).type("text/plain").send("Something went wrong.");
  });
}
