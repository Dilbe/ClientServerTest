// The WebSocket connection to the server, opened after logging in. It
// reconnects by itself: on a phone, dropped connections are normal (screen
// lock, switching apps, a train tunnel), not an error.

import { MAX_MESSAGE_BYTES, parseMessage, serverMessage, type ClientMessage, type ServerMessage } from "../shared/protocol.ts";

export interface Connection {
  /** Sends a message; returns false when not connected right now. */
  send(message: ClientMessage): boolean;
  /** Closes the connection for good (when logging out). */
  close(): void;
}

export interface ConnectionEvents {
  onOpen(): void;
  onMessage(message: ServerMessage): void;
  /** The connection dropped; it reconnects after `retryInMs`. */
  onLost(retryInMs: number): void;
  /** The session has ended (logged out, possibly in another tab): stop. */
  onLoggedOut(): void;
  /** Asks the server whether this browser is still logged in. */
  isLoggedIn(): Promise<boolean>;
}

/** Wait times between reconnect attempts, in seconds; the last one repeats. */
const BACKOFF_SECONDS = [1, 2, 4, 8, 15, 30];

export function connect(events: ConnectionEvents): Connection {
  let socket: WebSocket | undefined;
  let failures = 0;
  let retryTimer: number | undefined;
  let stopped = false;

  function open(): void {
    window.clearTimeout(retryTimer);
    retryTimer = undefined;
    // The WebSocket lives at /ws on the same address as the page. A page
    // loaded over https must use wss:// (WebSocket over TLS). The browser
    // sends the session cookie along when it opens the connection.
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const current = new WebSocket(`${protocol}//${location.host}/ws`);
    socket = current;
    let opened = false;

    current.addEventListener("open", () => {
      opened = true;
      failures = 0;
      events.onOpen();
    });

    current.addEventListener("message", (event) => {
      // The server is trusted more than a client is, but checking its
      // messages too catches mismatches between client and server code early.
      const message = parseMessage(serverMessage, String(event.data));
      if (message === undefined) {
        console.warn("Ignoring unexpected message", event.data);
        return;
      }
      events.onMessage(message);
    });

    current.addEventListener("close", async (event) => {
      if (stopped || socket !== current) return;
      socket = undefined;
      if (event.code === 4001) return stop();
      // When the server refuses the connection (for example because the
      // session expired), the browser doesn't tell us the HTTP status: a
      // page may not learn details about a refused WebSocket. So ask the API.
      if (!opened && !(await events.isLoggedIn())) return stop();
      const wait = BACKOFF_SECONDS[Math.min(failures, BACKOFF_SECONDS.length - 1)]! * 1000;
      failures++;
      events.onLost(wait);
      retryTimer = window.setTimeout(open, wait);
    });
  }

  function stop(): void {
    stopped = true;
    window.clearTimeout(retryTimer);
    removeEventListener("online", reconnectNow);
    document.removeEventListener("visibilitychange", reconnectNow);
    events.onLoggedOut();
  }

  /** When the phone wakes up or the network returns, don't wait for the timer. */
  function reconnectNow(): void {
    if (stopped || document.visibilityState !== "visible") return;
    if (retryTimer !== undefined) {
      failures = 0;
      open();
    }
  }
  addEventListener("online", reconnectNow);
  document.addEventListener("visibilitychange", reconnectNow);

  open();

  return {
    send(message) {
      if (socket?.readyState !== WebSocket.OPEN) return false;
      const text = JSON.stringify(message);
      if (new TextEncoder().encode(text).length > MAX_MESSAGE_BYTES) throw new Error("message too large");
      socket.send(text);
      return true;
    },
    close() {
      stopped = true;
      window.clearTimeout(retryTimer);
      removeEventListener("online", reconnectNow);
      document.removeEventListener("visibilitychange", reconnectNow);
      socket?.close();
    },
  };
}

/**
 * The server runs a newer version than this page (the tab was open during a
 * deploy). Reload to get the new client, but at most once a minute, so a
 * persistent mismatch can't cause an endless reload loop. Returns false when
 * it didn't reload.
 */
export function reloadForNewVersion(): boolean {
  const key = "lastVersionReload";
  const last = Number(sessionStorage.getItem(key) ?? 0);
  if (Date.now() - last < 60_000) return false;
  sessionStorage.setItem(key, String(Date.now()));
  location.reload();
  return true;
}
