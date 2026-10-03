// Puts the server together: security headers, the account API and the
// WebSocket. main.ts adds the client files; tests use this without them.

import { createServer, type Server } from "node:http";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { createApi } from "./api.ts";
import type { Db } from "./database.ts";
import { securityHeaders } from "./security-headers.ts";
import { attachWebSocket, Connections } from "./websocket.ts";

export interface AppOptions {
  db: Db;
  production: boolean;
  trustProxy: boolean;
  publicOrigin: string | undefined;
  contactEmail: string | undefined;
  signupsPerHour?: number;
  /** Returns the client version; called once the client files are set up. */
  version: () => string;
}

export function createAppServer(options: AppOptions): { app: Express; httpServer: Server } {
  const { db } = options;
  const app = express();
  // Don't advertise which framework the server runs; it only helps attackers.
  app.disable("x-powered-by");
  app.set("trust proxy", options.trustProxy);
  app.use(securityHeaders(options.production));

  const connections = new Connections();
  app.use(
    "/api",
    createApi({
      db,
      connections,
      secureCookies: options.production,
      publicOrigin: options.publicOrigin,
      contactEmail: options.contactEmail,
      signupsPerHour: options.signupsPerHour,
    }),
  );

  const httpServer = createServer(app);
  attachWebSocket(httpServer, connections, { db, version: options.version, publicOrigin: options.publicOrigin });
  return { app, httpServer };
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
