// The Origin check.
//
// A browser sends cookies with every request to our server, also when the
// request is made by a page on another website. The Origin header says which
// website that page came from, and a browser doesn't let pages fake it. So
// for anything that uses the login cookie, we check that the page is ours.
//
// This matters most for WebSockets: unlike fetch requests, browsers let any
// website open a WebSocket to any server, with that server's cookies. Without
// this check, a page you visit elsewhere could connect as you
// ("cross-site WebSocket hijacking").

import type { IncomingMessage } from "node:http";

export function isAllowedOrigin(request: IncomingMessage, publicOrigin: string | undefined): boolean {
  const origin = request.headers.origin;
  if (origin === undefined) return false;
  if (publicOrigin !== undefined) return origin === publicOrigin;
  // No configured address (development): the page must come from the same
  // host and port the request was sent to.
  const host = request.headers.host;
  return host !== undefined && (origin === `http://${host}` || origin === `https://${host}`);
}
