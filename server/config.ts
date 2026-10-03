// Server settings, read once at startup from the command line and from
// environment variables (the usual way to configure a container).

import { parseArgs } from "node:util";

export interface Config {
  /** true: serve the built files from dist/client. false: run Vite for development. */
  production: boolean;
  /** Network address to listen on. */
  host: string;
  port: number;
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
  };
}
