// Reading the session cookie from a request.

import type { IncomingMessage } from "node:http";

export const SESSION_COOKIE = "session";

/** Returns the value of one cookie from the Cookie header. */
export function readCookie(request: IncomingMessage, name: string): string | undefined {
  // The header looks like "name1=value1; name2=value2".
  for (const part of (request.headers.cookie ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return undefined;
}
