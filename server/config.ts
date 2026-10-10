// Server settings, read once at startup from the command line and from
// environment variables (the usual way to configure a container).

import path from "node:path";
import { parseArgs } from "node:util";

export interface Config {
  /** true: serve the built files from dist/client. false: run Vite for development. */
  production: boolean;
  /** Network address to listen on. */
  host: string;
  port: number;
  /** The SQLite database file. */
  databaseFile: string;
  /**
   * The address players use, like "https://game.example.com". Requests from
   * pages on any other address are refused (see origin.ts). When not set, the
   * address in the request's Host header is used, which is fine for
   * development but should be set in production.
   */
  publicOrigin: string | undefined;
  /**
   * Whether the server runs behind a proxy (the hosting platform's load
   * balancer) that reports the player's address in X-Forwarded-For. Exactly
   * one proxy is trusted: the address is the last entry, the one that proxy
   * added; earlier entries come from the client and are ignored. Only switch
   * this on when that is true: otherwise anyone can send that header and
   * pick their own address, which defeats the rate limits.
   */
  trustProxy: boolean;
  /** Shown on the "what we store" page. */
  contactEmail: string | undefined;
}

export function readConfig(): Config {
  const { values } = parseArgs({
    options: { production: { type: "boolean", default: false } },
  });
  return {
    production: values.production,
    // Only this computer can connect by default. Set HOST=0.0.0.0 to allow
    // other devices on the network, for example a phone on the same Wi-Fi.
    host: process.env.HOST ?? "127.0.0.1",
    port: Number(process.env.PORT ?? 3000),
    databaseFile: databaseFile(),
    publicOrigin: process.env.PUBLIC_ORIGIN || undefined,
    trustProxy: process.env.TRUST_PROXY === "1",
    contactEmail: process.env.CONTACT_EMAIL || undefined,
  };
}

/** The database file: `game.db` in DATA_DIR. Also used by server/restore-database.ts. */
export function databaseFile(): string {
  return path.resolve(process.env.DATA_DIR ?? "data", "game.db");
}
