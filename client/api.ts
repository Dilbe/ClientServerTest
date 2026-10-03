// Calls to the server's account API.

import type { ApiError, LoginRequest, Me, ServerInfo, SignupRequest } from "../shared/accounts.ts";

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
};
