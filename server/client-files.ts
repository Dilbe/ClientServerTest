// Serves the client: through Vite during development, or the files built by
// `npm run build` in production.

import { readFile } from "node:fs/promises";
import path from "node:path";
import express, { type Express } from "express";
import type { Server } from "node:http";

const distDir = path.resolve(import.meta.dirname, "../dist/client");

/**
 * Adds the routes that serve the client to `app`, and returns the version of
 * the client files being served.
 */
export async function serveClient(app: Express, httpServer: Server, production: boolean): Promise<string> {
  if (production) {
    const versionFile = await readFile(path.join(distDir, "version.json"), "utf8").catch(() => {
      throw new Error("dist/client/version.json not found: run `npm run build` first");
    });
    // express.static only serves files inside distDir, so a request like
    // /../server/config.ts can't escape it (a "path traversal" attack).
    app.use(express.static(distDir));
    return (JSON.parse(versionFile) as { version: string }).version;
  }

  // Development: Vite runs inside this server as middleware, so the page,
  // the API and the WebSocket all share one address. Vite is a development
  // dependency, so it is only loaded here.
  const { createServer } = await import("vite");
  const vite = await createServer({
    server: { middlewareMode: true, hmr: { server: httpServer } },
    appType: "spa",
  });
  app.use(vite.middlewares);
  return "dev";
}
