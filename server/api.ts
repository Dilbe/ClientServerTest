// The HTTP API: accounts (sign up, log in, log out, who am I) and the
// character page.

import express, { type NextFunction, type Request, type Response } from "express";
import type { z } from "zod";
import {
  accountNameKey,
  loginRequest,
  signupRequest,
  type ApiError,
  type Me,
  type ServerInfo,
} from "../shared/accounts.ts";
import { renameCharacterRequest, type CharactersPage } from "../shared/characters.ts";
import { adventurerPrice } from "../shared/rules/advancement.ts";
import { checkLogin, createAccount, findAccount, silverOf, type Account } from "./accounts.ts";
import { buyAdventurer, charactersOfAccount, renameCharacter } from "./characters.ts";
import { readCookie, SESSION_COOKIE } from "./cookies.ts";
import type { Db } from "./database.ts";
import { isAllowedOrigin } from "./origin.ts";
import { RateLimiter } from "./rate-limit.ts";
import { createSession, deleteSession, SESSION_DAYS, useSession } from "./sessions.ts";
import type { Connections } from "./websocket.ts";

export interface ApiOptions {
  db: Db;
  connections: Connections;
  /** Whether the account is in a game, open or running (the lobby knows). */
  isInGame: (accountId: number) => boolean;
  /** Send the cookie only over HTTPS. */
  secureCookies: boolean;
  publicOrigin: string | undefined;
  contactEmail: string | undefined;
  /** New accounts allowed per address per hour (default 5). Tests raise it. */
  signupsPerHour?: number;
}

const MINUTE = 60 * 1000;

export function createApi(options: ApiOptions): express.Router {
  const { db } = options;
  const router = express.Router();

  // At most 5 new accounts per address per hour, and at most 5 failed logins
  // per account name and 30 per address per 15 minutes.
  const signupsPerAddress = new RateLimiter(options.signupsPerHour ?? 5, 60 * MINUTE);
  const failedLoginsPerAccount = new RateLimiter(5, 15 * MINUTE);
  const failedLoginsPerAddress = new RateLimiter(30, 15 * MINUTE);
  const pruneTimer = setInterval(() => {
    for (const limiter of [signupsPerAddress, failedLoginsPerAccount, failedLoginsPerAddress]) limiter.prune();
  }, 10 * MINUTE);
  pruneTimer.unref(); // don't keep the process alive just for this timer

  // Request bodies are JSON and small. Larger ones are refused before they
  // are read into memory.
  router.use(express.json({ limit: "4kb" }));

  // Requests that change something must come from our own page (see
  // origin.ts) and be JSON. A form on another website can't send JSON
  // to us without the browser asking our permission first, which we never give.
  router.use((request, response, next) => {
    if (request.method === "GET") return next();
    if (!isAllowedOrigin(request, options.publicOrigin)) return fail(response, 403, "Forbidden.");
    if (!request.is("application/json")) return fail(response, 415, "Expected JSON.");
    next();
  });

  router.get("/info", (_request, response) => {
    const info: ServerInfo = { contactEmail: options.contactEmail ?? null };
    response.json(info);
  });

  router.get("/me", (request, response) => {
    const current = currentSession(request, response);
    if (!current) return fail(response, 401, "Not logged in.");
    response.json(me(db, current.account));
  });

  router.post("/signup", async (request, response) => {
    const address = request.ip ?? "unknown";
    const wait = signupsPerAddress.retryAfter(address);
    if (wait > 0) return tooManyAttempts(response, wait);

    const body = validate(signupRequest, request.body, response);
    if (!body) return;

    signupsPerAddress.record(address);
    const result = await createAccount(db, body);
    if (!result.ok) {
      const text =
        result.reason === "account-name-taken"
          ? "That account name is already taken."
          : "That display name is already taken.";
      return fail(response, 409, text);
    }
    startSession(response, result.account);
    response.status(201).json(me(db, result.account));
  });

  router.post("/login", async (request, response) => {
    const body = validate(loginRequest, request.body, response);
    if (!body) return;

    const address = request.ip ?? "unknown";
    const accountKey = accountNameKey(body.accountName);
    const wait = Math.max(failedLoginsPerAccount.retryAfter(accountKey), failedLoginsPerAddress.retryAfter(address));
    if (wait > 0) return tooManyAttempts(response, wait);

    const account = await checkLogin(db, body.accountName, body.password);
    if (!account) {
      failedLoginsPerAccount.record(accountKey);
      failedLoginsPerAddress.record(address);
      // The same answer for an unknown account and a wrong password, so this
      // can't be used to find out which account names exist.
      return fail(response, 401, "Wrong account name or password.");
    }
    failedLoginsPerAccount.reset(accountKey);
    startSession(response, account);
    response.json(me(db, account));
  });

  router.post("/logout", (request, response) => {
    const token = readCookie(request, SESSION_COOKIE);
    const session = token === undefined ? undefined : useSession(db, token);
    if (session) {
      deleteSession(db, session.tokenHash);
      options.connections.closeSession(session.tokenHash);
    }
    response.clearCookie(SESSION_COOKIE, cookieOptions());
    response.status(204).end();
  });

  // ---- The character page ----
  //
  // The client only shows what's possible; every rule is checked here
  // again, because a request doesn't have to come from our client.

  router.get("/characters", (request, response) => {
    const current = currentSession(request, response);
    if (!current) return fail(response, 401, "Not logged in.");
    response.json(charactersPage(current.account.id));
  });

  // The body names what the player wants, never what it costs: the server
  // works out the price from what it has stored.
  router.post("/characters/buy-adventurer", (request, response) => {
    const current = currentSession(request, response);
    if (!current) return fail(response, 401, "Not logged in.");
    const accountId = current.account.id;
    // A character in a game must not change underneath it (architecture.md,
    // Characters). From here to the end of the transaction there is no
    // await, so the player can't join a game in between.
    if (options.isInGame(accountId)) return fail(response, 409, "You can't buy characters while you are in a game.");
    const result = buyAdventurer(db, accountId, Date.now());
    if (!result.ok) return fail(response, 409, "Not enough silver.");
    response.json(charactersPage(accountId));
  });

  router.post("/characters/rename", (request, response) => {
    const current = currentSession(request, response);
    if (!current) return fail(response, 401, "Not logged in.");
    const body = validate(renameCharacterRequest, request.body, response);
    if (!body) return;
    const accountId = current.account.id;
    // Other players in the game see the name, so it doesn't change while
    // the game runs.
    if (options.isInGame(accountId)) return fail(response, 409, "You can't rename characters while you are in a game.");
    // The character is looked up by this account and its number: someone
    // else's character number simply isn't found.
    const result = renameCharacter(db, accountId, body.number, body.name, Date.now());
    if (!result.ok) return fail(response, 404, "You have no character with that number.");
    response.json(charactersPage(accountId));
  });

  function charactersPage(accountId: number): CharactersPage {
    const characters = charactersOfAccount(db, accountId);
    return {
      characters: characters.map((c) => ({
        number: c.number,
        name: c.data.name ?? null,
        class: c.data.class,
        rank: c.data.rank,
        xp: c.data.xp,
      })),
      silver: silverOf(db, accountId),
      adventurerPrice: adventurerPrice(characters.length),
      inGame: options.isInGame(accountId),
    };
  }

  // Unknown API paths get a JSON 404 instead of falling through to the client files.
  router.use((_request, response) => fail(response, 404, "Not found."));

  // Express calls this for any error thrown in a route. It answers with a
  // generic message: details like stack traces help attackers, not players.
  router.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    const status = (error as { status?: number }).status;
    // Errors with a status come from express.json: a body that is too large or isn't valid JSON.
    if (status !== undefined && status >= 400 && status < 500) return fail(response, status, "Bad request.");
    console.error(error);
    fail(response, 500, "Something went wrong.");
  });

  function cookieOptions() {
    return {
      httpOnly: true, // page scripts can't read it, so injected script can't steal it
      secure: options.secureCookies, // only sent over HTTPS
      sameSite: "strict" as const, // not sent when another website makes the request
      path: "/",
    };
  }

  function startSession(response: Response, account: Account): void {
    setSessionCookie(response, createSession(db, account.id));
  }

  function setSessionCookie(response: Response, token: string): void {
    response.cookie(SESSION_COOKIE, token, { ...cookieOptions(), maxAge: SESSION_DAYS * 24 * 60 * MINUTE });
  }

  /** The logged-in account for this request; refreshes the cookie when the session was extended. */
  function currentSession(request: Request, response: Response): { account: Account } | undefined {
    const token = readCookie(request, SESSION_COOKIE);
    if (token === undefined) return undefined;
    const session = useSession(db, token);
    const account = session && findAccount(db, session.accountId);
    if (!session || !account) return undefined;
    if (session.extended) setSessionCookie(response, token);
    return { account };
  }

  return router;
}

function me(db: Db, account: Account): Me {
  return { displayName: account.displayName, silver: silverOf(db, account.id) };
}

const FIELD_NAMES: Record<string, string> = {
  accountName: "Account name",
  displayName: "Display name",
  name: "Name",
  password: "Password",
};

/** Checks a request body against its schema; on failure, answers 400 and returns `undefined`. */
function validate<T>(schema: z.ZodType<T>, body: unknown, response: Response): T | undefined {
  const result = schema.safeParse(body);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  const field = FIELD_NAMES[String(issue?.path[0])] ?? "Request";
  fail(response, 400, `${field}: ${issue?.message ?? "invalid."}`);
  return undefined;
}

function tooManyAttempts(response: Response, waitMs: number): void {
  const seconds = Math.ceil(waitMs / 1000);
  response.setHeader("Retry-After", String(seconds));
  fail(response, 429, `Too many attempts. Try again in ${Math.ceil(seconds / 60)} minute(s).`);
}

function fail(response: Response, status: number, error: string): void {
  const body: ApiError = { error };
  response.status(status).json(body);
}
