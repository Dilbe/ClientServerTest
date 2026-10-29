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
import {
  advancedClassRequest,
  buyAdventurerRequest,
  rankUpRequest,
  renameCharacterRequest,
  resetUpgradesRequest,
  upgradeAbilityRequest,
  upgradeStatRequest,
  type CharactersPage,
} from "../shared/characters.ts";
import { hintSeenRequest } from "../shared/hints.ts";
import { MAX_RANK, MIN_RANK } from "../shared/rules/advancement.ts";
import { restFromNow, restState } from "../shared/rules/rest.ts";
import { BUILDINGS } from "../shared/rules/village.ts";
import { startJobRequest, takeOutRequest, type VillagePage } from "../shared/village.ts";
import { buyUpgrade, type BuyUpgradeResult, type UpgradeChoice } from "../shared/rules/upgrades.ts";
import { checkLogin, createAccount, findAccount, silverOf, type Account } from "./accounts.ts";
import {
  buyAdventurer,
  characterOfAccount,
  charactersOfAccount,
  makeAdvancedClass,
  priceOfAdventurer,
  rankUp,
  renameCharacter,
  resetUpgrades,
  upgradeCharacter,
} from "./characters.ts";
import { readCookie, SESSION_COOKIE } from "./cookies.ts";
import type { Db } from "./database.ts";
import { hintsSeen, markHintSeen } from "./hints.ts";
import { logError } from "./log.ts";
import { isAllowedOrigin } from "./origin.ts";
import { RateLimiter } from "./rate-limit.ts";
import { createSession, deleteSession, SESSION_DAYS, useSession } from "./sessions.ts";
import { buildingsOf, hasVillage, jobsOf, resourcesOf, settleJobs, startJob, takeOut } from "./village.ts";
import type { CharacterGames, Connections } from "./websocket.ts";

export interface ApiOptions {
  db: Db;
  connections: Connections;
  /** Which characters are in a game, and upgrades bought during one (websocket.ts knows). */
  characterGames: CharacterGames;
  /** Send the cookie only over HTTPS. */
  secureCookies: boolean;
  publicOrigin: string | undefined;
  contactEmail: string | undefined;
  /** New accounts allowed per address per hour (default 5). Tests raise it. */
  signupsPerHour?: number;
}

const MINUTE = 60 * 1000;

export function createApi(options: ApiOptions): express.Router {
  const { db, characterGames: games } = options;
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

  // The player closed a one-time hint. The body can only name a known hint
  // (see hintSeenRequest), so nothing else can be stored on the account this
  // way. Allowed during a game: the hints are shown on its result screen.
  router.post("/hints/seen", (request, response) => {
    const current = currentSession(request, response);
    if (!current) return fail(response, 401, "Not logged in.");
    const body = validate(hintSeenRequest, request.body, response);
    if (!body) return;
    markHintSeen(db, current.account.id, body.hint);
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

  // The body names what the player wants (the rank), never what it costs:
  // the server works out the price from what it has stored. Buying changes
  // no character that is in a game, so it is allowed during one (issue #153).
  router.post("/characters/buy-adventurer", (request, response) => {
    const current = currentSession(request, response);
    if (!current) return fail(response, 401, "Not logged in.");
    const body = validate(buyAdventurerRequest, request.body, response);
    if (!body) return;
    const accountId = current.account.id;
    const result = buyAdventurer(db, accountId, body.rank, Date.now());
    if (!result.ok) return fail(response, 409, "Not enough silver.");
    response.json(charactersPage(accountId));
  });

  // A character in a running game can't be renamed, reset or ranked up: the
  // game read its name, class and rank when it started, and adds its XP when
  // it ends. Everything else is allowed during a game (issue #153). A
  // character chosen in an open party isn't in a running game: the game
  // reads it again when it starts, and the party's choice is brought up to
  // date (`charactersChanged`).
  //
  // From the check to the end of the action there is no await, so the game
  // can't start or end in between: Node runs one piece of JavaScript at a time.

  router.post("/characters/rename", (request, response) => {
    const current = currentSession(request, response);
    if (!current) return fail(response, 401, "Not logged in.");
    const body = validate(renameCharacterRequest, request.body, response);
    if (!body) return;
    const accountId = current.account.id;
    // The character is looked up by this account and its number: someone
    // else's character number simply isn't found.
    const character = characterOfAccount(db, accountId, body.number);
    if (!character) return fail(response, 404, "You have no character with that number.");
    // Other players in the game see the name, so it doesn't change while the game runs.
    if (games.progressInGame(character.id)) return fail(response, 409, "You can't rename a character while it is in a game.");
    renameCharacter(db, accountId, body.number, body.name, Date.now());
    games.charactersChanged(accountId);
    response.json(charactersPage(accountId));
  });

  // Like buying, the body names what to upgrade, never what it costs.
  router.post("/characters/upgrade", (request, response) => {
    const current = currentSession(request, response);
    if (!current) return fail(response, 401, "Not logged in.");
    const body = validate(upgradeStatRequest, request.body, response);
    if (!body) return;
    upgrade(response, current.account.id, body.number, { stat: body.stat });
  });

  // Like upgrading a stat: the body names the ability and the upgrade, never the cost.
  router.post("/characters/upgrade-ability", (request, response) => {
    const current = currentSession(request, response);
    if (!current) return fail(response, 401, "Not logged in.");
    const body = validate(upgradeAbilityRequest, request.body, response);
    if (!body) return;
    upgrade(response, current.account.id, body.number, { ability: body.ability, upgrade: body.upgrade });
  });

  /**
   * Buys a stat or ability upgrade. A character in a running game gets it in
   * the game, where it counts at once, with the points of its level there;
   * its record gets it when the game ends (see game-manager.ts, Upgrades).
   * Any other character gets it on its record right away.
   */
  function upgrade(response: Response, accountId: number, number: number, choice: UpgradeChoice): void {
    const character = characterOfAccount(db, accountId, number);
    if (!character) return fail(response, 404, "You have no character with that number.");
    const progress = games.progressInGame(character.id);
    let result: BuyUpgradeResult | ReturnType<typeof upgradeCharacter>;
    if (progress) {
      const bought = buyUpgrade(character.data, progress.level, [...character.data.upgrades, ...progress.upgrades], choice);
      if (bought.ok) {
        const problem = games.upgradeInGame(progress, bought.upgrade);
        if (problem !== undefined) return fail(response, 409, problem);
      }
      result = bought;
    } else {
      result = upgradeCharacter(db, accountId, number, choice, Date.now());
    }
    if (!result.ok) {
      switch (result.reason) {
        case "no-such-character":
          return fail(response, 404, "You have no character with that number.");
        case "no-stat":
          return fail(response, 409, "That character's class doesn't have that stat.");
        case "no-ability":
          return fail(response, 409, "That character's rank doesn't give it that ability.");
        case "not-upgradable":
          return fail(response, 409, "That can't be upgraded that way any more.");
        case "not-enough-points":
          return fail(response, 409, "Not enough upgrade points.");
      }
    }
    response.json(charactersPage(accountId));
  }

  router.post("/characters/reset-upgrades", (request, response) => {
    const current = currentSession(request, response);
    if (!current) return fail(response, 401, "Not logged in.");
    const body = validate(resetUpgradesRequest, request.body, response);
    if (!body) return;
    const accountId = current.account.id;
    const character = characterOfAccount(db, accountId, body.number);
    if (!character) return fail(response, 404, "You have no character with that number.");
    // The XP changes too, and the game adds XP to the record when it ends.
    if (games.progressInGame(character.id)) {
      return fail(response, 409, "You can't reset the upgrades of a character while it is in a game.");
    }
    const result = resetUpgrades(db, accountId, body.number, Date.now());
    if (!result.ok) {
      return result.reason === "no-such-character"
        ? fail(response, 404, "You have no character with that number.")
        : fail(response, 409, "Only characters of level 2 or higher can reset their upgrades.");
    }
    // The party shows the character's level.
    games.charactersChanged(accountId);
    response.json(charactersPage(accountId));
  });

  // The body names only the two characters. Everything that decides whether
  // they may rank up is read from the database, never taken from the client.
  router.post("/characters/rank-up", (request, response) => {
    const current = currentSession(request, response);
    if (!current) return fail(response, 401, "Not logged in.");
    const body = validate(rankUpRequest, request.body, response);
    if (!body) return;
    const accountId = current.account.id;
    // A character in a running game must not disappear underneath it.
    for (const number of [body.first, body.second]) {
      const character = characterOfAccount(db, accountId, number);
      if (character && games.progressInGame(character.id)) {
        return fail(response, 409, "You can't rank up a character while it is in a game.");
      }
    }
    if (refuseWorking(response, accountId, [body.first, body.second])) return;
    const result = rankUp(db, accountId, body.first, body.second, Date.now());
    if (!result.ok) {
      switch (result.reason) {
        case "no-such-character":
          return fail(response, 404, "You have no character with that number.");
        case "different-class-or-rank":
          return fail(response, 409, "Only two characters of the same class and rank can rank up together.");
        case "not-max-level":
          return fail(response, 409, "Both characters must be at the max level of their rank.");
        case "max-rank":
          return fail(response, 409, "Rank 5 is the highest rank.");
      }
    }
    // Characters chosen in an open party may be gone now.
    games.charactersChanged(accountId);
    response.json(charactersPage(accountId));
  });

  // Like a rank-up: the body names the two characters and the class the
  // player picked (only an advanced class passes the schema). Everything
  // that decides whether they may be combined is read from the database.
  router.post("/characters/advanced-class", (request, response) => {
    const current = currentSession(request, response);
    if (!current) return fail(response, 401, "Not logged in.");
    const body = validate(advancedClassRequest, request.body, response);
    if (!body) return;
    const accountId = current.account.id;
    for (const number of [body.first, body.second]) {
      const character = characterOfAccount(db, accountId, number);
      if (character && games.progressInGame(character.id)) {
        return fail(response, 409, "You can't use up a character while it is in a game.");
      }
    }
    if (refuseWorking(response, accountId, [body.first, body.second])) return;
    const result = makeAdvancedClass(db, accountId, body.first, body.second, body.class, Date.now());
    if (!result.ok) {
      switch (result.reason) {
        case "no-such-character":
          return fail(response, 404, "You have no character with that number.");
        case "not-rank-5-adventurers":
          return fail(response, 409, "Only two rank 5 adventurers can make an advanced class.");
        case "not-max-level":
          return fail(response, 409, "Both adventurers must be at their max level.");
      }
    }
    games.charactersChanged(accountId);
    response.json(charactersPage(accountId));
  });

  /**
   * Refuses to use up a character that works in the village: its job would
   * be lost. Pays out ended jobs first, since removing a character removes
   * its job with what it earned. Returns whether it refused.
   */
  function refuseWorking(response: Response, accountId: number, numbers: readonly number[]): boolean {
    const now = Date.now();
    settleJobs(db, accountId, now);
    for (const number of numbers) {
      const character = characterOfAccount(db, accountId, number);
      if (character && restState(character.rest, now) === "working") {
        fail(response, 409, "You can't use up a character while it works in the village. Take it out first.");
        return true;
      }
    }
    return false;
  }

  // ---- The village (design.md, The village; issue #295) ----
  //
  // Like the character page, the body names only the character and the
  // building. How long a job lasts and what it earns are worked out here
  // from what is stored, and so is whether the character may go to work.

  router.get("/village", (request, response) => {
    const current = currentSession(request, response);
    if (!current) return fail(response, 401, "Not logged in.");
    response.json(villagePage(current.account.id));
  });

  router.post("/village/start-job", (request, response) => {
    const current = currentSession(request, response);
    if (!current) return fail(response, 401, "Not logged in.");
    const body = validate(startJobRequest, request.body, response);
    if (!body) return;
    const accountId = current.account.id;
    const character = characterOfAccount(db, accountId, body.number);
    if (!character) return fail(response, 404, "You have no character with that number.");
    // Chosen in a party, or in a game: it can't be in two places at once.
    // As elsewhere, there is no await between this check and the job
    // starting, so a game can't start in between.
    if (games.inGameCheck(accountId)(character)) {
      return fail(response, 409, "That character is in a game or a party. Take it out of the party first.");
    }
    const result = startJob(db, accountId, body.number, body.building, Date.now());
    if (!result.ok) {
      switch (result.reason) {
        case "no-village":
          return fail(response, 409, "You don't have that building.");
        case "no-such-character":
          return fail(response, 404, "You have no character with that number.");
        case "not-ready":
          return fail(response, 409, "That character is working, healing or resting.");
        case "building-full":
          return fail(response, 409, `The ${BUILDINGS[body.building].name.toLowerCase()} has no free slot.`);
      }
    }
    // The lobby shows the character as working now.
    games.charactersChanged(accountId);
    response.json(villagePage(accountId));
  });

  router.post("/village/take-out", (request, response) => {
    const current = currentSession(request, response);
    if (!current) return fail(response, 401, "Not logged in.");
    const body = validate(takeOutRequest, request.body, response);
    if (!body) return;
    const accountId = current.account.id;
    const result = takeOut(db, accountId, body.number, Date.now());
    if (!result.ok) {
      return result.reason === "no-such-character"
        ? fail(response, 404, "You have no character with that number.")
        : fail(response, 409, "That character isn't working.");
    }
    games.charactersChanged(accountId);
    response.json(villagePage(accountId));
  });

  /** The village page. Pays out the jobs that have ended first, so the wood and stone are up to date. */
  function villagePage(accountId: number): VillagePage {
    const now = Date.now();
    settleJobs(db, accountId, now);
    const characters = charactersOfAccount(db, accountId);
    const jobs = jobsOf(db, accountId);
    return {
      unlocked: hasVillage(db, accountId),
      ...resourcesOf(db, accountId),
      buildings: buildingsOf(db, accountId).map(({ id, level }) => ({
        id,
        level,
        slots: BUILDINGS[id].slots(level),
        jobs: jobs
          .filter((job) => job.building === id)
          .flatMap((job) => {
            const character = characters.find((c) => c.id === job.characterId);
            if (!character) return [];
            return [
              {
                number: character.number,
                perHour: job.perHour,
                startedMsAgo: Math.max(0, now - job.startedAt),
                doneInMs: Math.max(0, job.endsAt - now),
              },
            ];
          }),
      })),
      characters: charactersPage(accountId).characters,
    };
  }

  /**
   * The character page. A character in a running game is shown as the game
   * sees it: with the XP it gained and the upgrades it bought there so far
   * (issue #153), which its record only gets when the game ends.
   */
  function charactersPage(accountId: number): CharactersPage {
    const characters = charactersOfAccount(db, accountId);
    const inGame = games.inGameCheck(accountId);
    return {
      characters: characters.map((c) => {
        const progress = games.progressInGame(c.id);
        return {
          number: c.number,
          name: c.data.name ?? null,
          class: c.data.class,
          rank: c.data.rank,
          xp: c.data.xp + (progress?.xpGained ?? 0),
          upgrades: [...c.data.upgrades, ...(progress?.upgrades ?? [])],
          ...restFromNow(c.rest, Date.now()),
          workplace: c.workplace,
          inGame: inGame(c),
          inRunningGame: progress !== undefined,
        };
      }),
      silver: silverOf(db, accountId),
      adventurerPrices: pricesOfAdventurers(accountId),
    };
  }

  function pricesOfAdventurers(accountId: number): CharactersPage["adventurerPrices"] {
    const now = Date.now();
    const prices: CharactersPage["adventurerPrices"] = [];
    for (let rank = MIN_RANK; rank <= MAX_RANK; rank++) {
      prices.push({ rank, price: priceOfAdventurer(db, accountId, rank, now) });
    }
    return prices;
  }

  // Unknown API paths get a JSON 404 instead of falling through to the client files.
  router.use((_request, response) => fail(response, 404, "Not found."));

  // Express calls this for any error thrown in a route. It answers with a
  // generic message: details like stack traces help attackers, not players.
  router.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    const status = (error as { status?: number }).status;
    // Errors with a status come from express.json: a body that is too large or isn't valid JSON.
    if (status !== undefined && status >= 400 && status < 500) return fail(response, status, "Bad request.");
    logError("An API request failed:", error);
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

/** Who is logged in. Pays out the village jobs that have ended first, so the wood and stone are up to date. */
function me(db: Db, account: Account): Me {
  settleJobs(db, account.id, Date.now());
  return {
    displayName: account.displayName,
    silver: silverOf(db, account.id),
    village: hasVillage(db, account.id),
    ...resourcesOf(db, account.id),
    hintsSeen: hintsSeen(db, account.id),
  };
}

const FIELD_NAMES: Record<string, string> = {
  accountName: "Account name",
  building: "Building",
  displayName: "Display name",
  first: "Character",
  hint: "Hint",
  name: "Name",
  number: "Character",
  password: "Password",
  rank: "Rank",
  class: "Class",
  second: "Character",
  stat: "Stat",
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
