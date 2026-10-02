// Entry point of the browser code: connects to the server and shows that the
// connection works.

import { MAX_MESSAGE_BYTES, parseMessage, serverMessage, type ClientMessage } from "../shared/protocol.ts";

const statusElement = document.querySelector<HTMLElement>("#status")!;
const latencyElement = document.querySelector<HTMLElement>("#latency")!;

// The WebSocket lives at /ws on the same address as the page. A page loaded
// over https must use wss:// (WebSocket over TLS).
const protocol = location.protocol === "https:" ? "wss:" : "ws:";
const socket = new WebSocket(`${protocol}//${location.host}/ws`);

const pingsSent = new Map<number, number>();
let nextPingId = 0;

function send(message: ClientMessage): void {
  const text = JSON.stringify(message);
  if (new TextEncoder().encode(text).length > MAX_MESSAGE_BYTES) throw new Error("message too large");
  socket.send(text);
}

function sendPing(): void {
  if (socket.readyState !== WebSocket.OPEN) return;
  const id = nextPingId++;
  pingsSent.set(id, performance.now());
  send({ type: "ping", id });
}

socket.addEventListener("open", () => {
  statusElement.textContent = "connected";
  sendPing();
  setInterval(sendPing, 2000);
});

socket.addEventListener("close", () => {
  statusElement.textContent = "disconnected";
});

socket.addEventListener("message", (event) => {
  // The server is trusted more than a client is, but checking its messages
  // too catches mismatches between client and server code early.
  const message = parseMessage(serverMessage, String(event.data));
  if (message === undefined) {
    console.warn("Ignoring unexpected message", event.data);
    return;
  }

  switch (message.type) {
    case "hello":
      if (message.version !== __APP_VERSION__) reloadForNewVersion();
      break;
    case "pong": {
      const sentAt = pingsSent.get(message.id);
      pingsSent.delete(message.id);
      if (sentAt !== undefined) latencyElement.textContent = `${Math.round(performance.now() - sentAt)} ms`;
      break;
    }
  }
});

/**
 * The server runs a newer version than this page (the tab was open during a
 * deploy). Reload to get the new client, but at most once a minute, so a
 * persistent mismatch can't cause an endless reload loop.
 */
function reloadForNewVersion(): void {
  const key = "lastVersionReload";
  const last = Number(sessionStorage.getItem(key) ?? 0);
  if (Date.now() - last < 60_000) {
    statusElement.textContent = "outdated: please reload the page";
    return;
  }
  sessionStorage.setItem(key, String(Date.now()));
  location.reload();
}
