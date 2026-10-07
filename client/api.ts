// Calls to the server's HTTP API: accounts and the character page.

import type { ApiError, LoginRequest, Me, ServerInfo, SignupRequest } from "../shared/accounts.ts";
import type {
  BuyAdventurerRequest,
  CharactersPage,
  RankUpRequest,
  RenameCharacterRequest,
  ResetUpgradesRequest,
  UpgradeStatRequest,
} from "../shared/characters.ts";

/** The result of an API call: the data, or the error message to show. */
export type Result<T> = { ok: true; data: T } | { ok: false; error: string; status?: number };

async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<Result<T>> {
  let response: Response;
  try {
    // fetch sends our cookies automatically, because the API is on the same
    // address as the page.
    response = await fetch(`/api${path}`, {
      method,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return { ok: false, error: "Can't reach the server. Check your connection." };
  }
  if (response.status === 204) return { ok: true, data: undefined as T };
  const json: unknown = await response.json().catch(() => undefined);
  if (response.ok) return { ok: true, data: json as T };
  const error = (json as ApiError | undefined)?.error ?? `Server error (${response.status}).`;
  return { ok: false, error, status: response.status };
}

export const api = {
  me: () => call<Me>("GET", "/me"),
  info: () => call<ServerInfo>("GET", "/info"),
  signup: (request: SignupRequest) => call<Me>("POST", "/signup", request),
  login: (request: LoginRequest) => call<Me>("POST", "/login", request),
  logout: () => call<void>("POST", "/logout", {}),
  characters: () => call<CharactersPage>("GET", "/characters"),
  // Says only which rank to buy: the server works out the price itself.
  buyAdventurer: (request: BuyAdventurerRequest) => call<CharactersPage>("POST", "/characters/buy-adventurer", request),
  renameCharacter: (request: RenameCharacterRequest) => call<CharactersPage>("POST", "/characters/rename", request),
  // Says only which stat: the server works out the cost itself.
  upgradeStat: (request: UpgradeStatRequest) => call<CharactersPage>("POST", "/characters/upgrade", request),
  resetUpgrades: (request: ResetUpgradesRequest) => call<CharactersPage>("POST", "/characters/reset-upgrades", request),
  // Says only which two characters: the server checks they can rank up.
  rankUp: (request: RankUpRequest) => call<CharactersPage>("POST", "/characters/rank-up", request),
};
