// The WebSocket connection to the server, opened after logging in.

import { MAX_MESSAGE_BYTES, parseMessage, serverMessage, type ClientMessage, type ServerMessage } from "../shared/protocol.ts";

export interface Connection {
  send(message: ClientMessage): void;
  close(): void;
}

export interface ConnectionEvents {
  onOpen(): void;
  onMessage(message: ServerMessage): void;
  /** `loggedOut` is true when the server closed the connection because the session ended. */
  onClose(loggedOut: boolean): void;
}

export function connect(events: ConnectionEvents): Connection {
  // The WebSocket lives at /ws on the same address as the page. A page loaded
  // over https must use wss:// (WebSocket over TLS). The browser sends the
  // session cookie along when it opens the connection.
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(`${protocol}//${location.host}/ws`);

  socket.addEventListener("open", () => events.onOpen());
  socket.addEventListener("close", (event) => events.onClose(event.code === 4001));
  socket.addEventListener("message", (event) => {
    // The server is trusted more than a client is, but checking its messages
    // too catches mismatches between client and server code early.
    const message = parseMessage(serverMessage, String(event.data));
    if (message === undefined) {
      console.warn("Ignoring unexpected message", event.data);
      return;
    }
    events.onMessage(message);
  });

  return {
    send(message) {
      if (socket.readyState !== WebSocket.OPEN) return;
      const text = JSON.stringify(message);
      if (new TextEncoder().encode(text).length > MAX_MESSAGE_BYTES) throw new Error("message too large");
      socket.send(text);
    },
    close() {
      socket.close();
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
