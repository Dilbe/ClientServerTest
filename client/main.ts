// Entry point of the browser code: shows one screen at a time, handles
// logging in and out, and runs the lobby.

import "./zod-setup.ts";
import {
  ACCOUNT_NAME_RULES,
  DISPLAY_NAME_RULES,
  PASSWORD_MIN_LENGTH,
  loginRequest,
  signupRequest,
  type Me,
} from "../shared/accounts.ts";
import { api } from "./api.ts";
import type { ClientMessage } from "../shared/protocol.ts";
import { connect, reloadForNewVersion, type Connection } from "./connection.ts";
import { renderLobby } from "./lobby.ts";

type Screen = "loading" | "login" | "signup" | "privacy" | "home";

function element<T extends HTMLElement = HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`missing element ${selector}`);
  return found;
}

function show(screen: Screen): void {
  for (const section of document.querySelectorAll<HTMLElement>("main > section")) {
    section.hidden = section.id !== `screen-${screen}`;
  }
}

// ---- Navigation ----
//
// The screens are addressed by the part of the URL after "#" (#/signup,
// #/privacy). Changing it doesn't load a new page, so this works without the
// server knowing about these addresses.

let me: Me | undefined;

function route(): void {
  const path = location.hash.replace(/^#/, "") || "/";
  if (path === "/privacy") return show("privacy");
  if (me) return showHome(me);
  show(path === "/signup" ? "signup" : "login");
}

window.addEventListener("hashchange", route);

// ---- Log in and sign up ----

// textContent, never innerHTML, for anything that isn't our own fixed text:
// innerHTML would run HTML that a player put in their name ("cross-site scripting").
for (const [key, text] of Object.entries({
  accountName: ACCOUNT_NAME_RULES,
  displayName: DISPLAY_NAME_RULES,
  passwordMin: String(PASSWORD_MIN_LENGTH),
})) {
  for (const span of document.querySelectorAll(`[data-rules="${key}"]`)) span.textContent = text;
}

const FIELD_NAMES: Record<string, string> = {
  accountName: "Account name",
  displayName: "Display name",
  password: "Password",
};

function handleForm(form: HTMLFormElement, submit: (values: Record<string, string>) => Promise<string | undefined>): void {
  const error = form.querySelector<HTMLElement>(".error")!;
  const button = form.querySelector<HTMLButtonElement>("button")!;
  form.addEventListener("submit", async (event) => {
    event.preventDefault(); // stay on this page; we send the data ourselves
    const values = Object.fromEntries(new FormData(form)) as Record<string, string>;
    button.disabled = true;
    error.textContent = (await submit(values)) ?? "";
    button.disabled = false;
  });
}

handleForm(element<HTMLFormElement>("#login-form"), async (values) => {
  const request = loginRequest.safeParse(values);
  if (!request.success) return "Enter your account name and password.";
  const result = await api.login(request.data);
  if (!result.ok) return result.error;
  loggedIn(result.data);
  return undefined;
});

handleForm(element<HTMLFormElement>("#signup-form"), async (values) => {
  // The same rules the server checks, so most mistakes show at once.
  const request = signupRequest.safeParse(values);
  if (!request.success) {
    const issue = request.error.issues[0]!;
    return `${FIELD_NAMES[String(issue.path[0])] ?? "Form"}: ${issue.message}`;
  }
  if (values.password !== values.passwordAgain) return "The two passwords are different.";
  const result = await api.signup(request.data);
  if (!result.ok) return result.error;
  loggedIn(result.data);
  return undefined;
});

function loggedIn(account: Me): void {
  me = account;
  for (const form of document.querySelectorAll("form")) form.reset();
  location.hash = "#/";
  route();
}

// ---- Logged in: the lobby ----

let connection: Connection | undefined;
let pingTimer: number | undefined;
const statusElement = element("#status");
const latencyElement = element("#latency");
const refusedElement = element("#refused");

function showHome(account: Me): void {
  element("#display-name").textContent = account.displayName;
  show("home");
  if (!connection) startConnection();
}

function startConnection(): void {
  const pingsSent = new Map<number, number>();
  let nextPingId = 0;
  statusElement.textContent = "connecting…";

  connection = connect({
    onOpen() {
      statusElement.textContent = "connected";
      window.clearInterval(pingTimer);
      const ping = () => {
        const id = nextPingId++;
        pingsSent.set(id, performance.now());
        connection?.send({ type: "ping", id });
      };
      ping();
      pingTimer = window.setInterval(ping, 5000);
    },
    onMessage(message) {
      switch (message.type) {
        case "hello":
          if (message.version !== __APP_VERSION__ && !reloadForNewVersion()) {
            statusElement.textContent = "outdated: please reload the page";
          }
          break;
        case "pong": {
          const sentAt = pingsSent.get(message.id);
          pingsSent.delete(message.id);
          if (sentAt !== undefined) latencyElement.textContent = `${Math.round(performance.now() - sentAt)} ms`;
          break;
        }
        case "lobby":
          refusedElement.textContent = "";
          renderLobby(message, me?.displayName ?? "", {
            join: (gameId) => send({ type: "join-game", gameId }),
          });
          break;
        case "refused":
          refusedElement.textContent = message.reason;
          break;
      }
    },
    onLost(retryInMs) {
      window.clearInterval(pingTimer);
      latencyElement.textContent = "";
      statusElement.textContent = `reconnecting in ${Math.round(retryInMs / 1000)} s…`;
    },
    onLoggedOut() {
      showLoggedOut();
    },
    async isLoggedIn() {
      const result = await api.me();
      // A network error means we can't tell yet: keep trying to reconnect.
      return result.ok || result.status !== 401;
    },
  });
}

function send(message: ClientMessage): void {
  if (!connection?.send(message)) refusedElement.textContent = "Not connected right now. Try again in a moment.";
}

element("#create-button").addEventListener("click", () => send({ type: "create-game" }));
element("#start-button").addEventListener("click", () => send({ type: "start-game" }));
element("#leave-button").addEventListener("click", () => send({ type: "leave-game" }));
element("#leave-game-button").addEventListener("click", () => send({ type: "leave-game" }));

function showLoggedOut(): void {
  me = undefined;
  window.clearInterval(pingTimer);
  connection?.close();
  connection = undefined;
  location.hash = "#/";
  route();
}

element("#logout-button").addEventListener("click", async () => {
  await api.logout();
  showLoggedOut();
});

// ---- Start ----

const [meResult, infoResult] = await Promise.all([api.me(), api.info()]);
if (meResult.ok) me = meResult.data;
if (infoResult.ok && infoResult.data.contactEmail) {
  element("#contact-email").textContent = infoResult.data.contactEmail;
}
route();
