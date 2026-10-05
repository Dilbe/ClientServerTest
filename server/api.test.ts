import { test, after } from "node:test";
import assert from "node:assert/strict";
import { sessionCookie, startTestServer } from "./test-helpers.ts";

const server = await startTestServer();
after(() => server.close());
const password = "correct horse battery";

test("sign up logs in and sets a safe session cookie", async () => {
  const response = await server.post("/api/signup", { accountName: "Carol", displayName: "Carol C", password });
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { displayName: "Carol C", silver: 0 });

  const setCookie = response.headers.getSetCookie().find((c) => c.startsWith("session="))!;
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  assert.match(setCookie, /Max-Age=2592000/); // 30 days

  const me = await server.get("/api/me", sessionCookie(response));
  assert.deepEqual(await me.json(), { displayName: "Carol C", silver: 0 });
});

test("the cookie is Secure in production", async () => {
  const production = await startTestServer({ production: true });
  try {
    const response = await production.post("/api/signup", { accountName: "dave", displayName: "Dave", password });
    assert.match(response.headers.getSetCookie()[0]!, /Secure/);
    assert.match(response.headers.get("content-security-policy")!, /frame-ancestors 'none'/);
  } finally {
    await production.close();
  }
});

test("sign up checks the rules", async () => {
  const cases = [
    [{ accountName: "ab", displayName: "Okay", password }, /Account name/],
    [{ accountName: "has space", displayName: "Okay", password }, /Account name/],
    [{ accountName: "okay1", displayName: "Bоb", password }, /Display name/], // Cyrillic о
    [{ accountName: "okay2", displayName: " Bob", password }, /Display name/],
    [{ accountName: "okay3", displayName: "Okay", password: "short" }, /Password: At least 10/],
  ] as const;
  for (const [body, message] of cases) {
    const response = await server.post("/api/signup", body);
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.match(((await response.json()) as { error: string }).error, message);
  }
});

test("account names and display names are unique", async () => {
  await server.signup("erin", "Erin");
  const sameAccount = await server.post("/api/signup", { accountName: "ERIN", displayName: "Other", password });
  assert.equal(sameAccount.status, 409);
  assert.match(((await sameAccount.json()) as { error: string }).error, /account name/);

  for (const lookAlike of ["erin", "E R I N", "Erin_", "e-rin"]) {
    const response = await server.post("/api/signup", { accountName: "someone", displayName: lookAlike, password });
    assert.equal(response.status, 409, lookAlike);
    assert.match(((await response.json()) as { error: string }).error, /display name/);
  }
});

test("log in, log out", async () => {
  await server.signup("frank", "Frank");
  const login = await server.post("/api/login", { accountName: "FRANK", password });
  assert.equal(login.status, 200);
  const cookie = sessionCookie(login)!;
  assert.equal((await server.get("/api/me", cookie)).status, 200);

  const logout = await server.post("/api/logout", {}, cookie);
  assert.equal(logout.status, 204);
  assert.equal((await server.get("/api/me", cookie)).status, 401);
});

test("a wrong password and an unknown account get the same answer", async () => {
  await server.signup("grace", "Grace");
  const wrongPassword = await server.post("/api/login", { accountName: "grace", password: "wrong password!" });
  const unknown = await server.post("/api/login", { accountName: "nobody", password: "wrong password!" });
  assert.equal(wrongPassword.status, 401);
  assert.equal(unknown.status, 401);
  assert.deepEqual(await wrongPassword.json(), await unknown.json());
});

test("too many failed logins for an account are blocked, even with the right password", async () => {
  await server.signup("heidi", "Heidi");
  for (let i = 0; i < 5; i++) {
    assert.equal((await server.post("/api/login", { accountName: "heidi", password: "wrong password!" })).status, 401);
  }
  const blocked = await server.post("/api/login", { accountName: "heidi", password });
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get("retry-after")) > 0);
});

test("too many sign-ups from one address are blocked", async () => {
  const fresh = await startTestServer({ signupsPerHour: 5 });
  try {
    for (let i = 0; i < 5; i++) await fresh.signup(`user${i}`, `User ${i}`);
    const blocked = await fresh.post("/api/signup", { accountName: "user5", displayName: "User 5", password });
    assert.equal(blocked.status, 429);
  } finally {
    await fresh.close();
  }
});

test("behind a proxy, a faked leading X-Forwarded-For address doesn't dodge the sign-up limit", async () => {
  const fresh = await startTestServer({ signupsPerHour: 1, trustProxy: true });
  // The platform's proxy appends the address it saw after whatever the
  // client sent, so the client controls every entry except the last.
  const signup = (n: number, forwardedFor: string) =>
    fetch(fresh.origin + "/api/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: fresh.origin, "X-Forwarded-For": forwardedFor },
      body: JSON.stringify({ accountName: `proxied${n}`, displayName: `Proxied ${n}`, password }),
    });
  try {
    assert.equal((await signup(0, "10.0.0.1, 203.0.113.7")).status, 201);
    assert.equal((await signup(1, "10.0.0.2, 203.0.113.7")).status, 429);
    // A different real address (last entry) has its own limit.
    assert.equal((await signup(2, "10.0.0.1, 203.0.113.8")).status, 201);
  } finally {
    await fresh.close();
  }
});

test("requests from another website are refused", async () => {
  const response = await fetch(server.origin + "/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://evil.example" },
    body: JSON.stringify({ accountName: "grace", password }),
  });
  assert.equal(response.status, 403);
});

test("requests that aren't JSON are refused", async () => {
  // What a plain HTML form on another website would send.
  const response = await fetch(server.origin + "/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: server.origin },
    body: "accountName=grace&password=x",
  });
  assert.equal(response.status, 415);
});

test("a body that is too large is refused", async () => {
  const response = await server.post("/api/login", { accountName: "x", password: "y".repeat(5000) });
  assert.equal(response.status, 413);
});

test("errors don't reveal details", async () => {
  const response = await fetch(server.origin + "/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: server.origin },
    body: "{not json",
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Bad request." });
});

test("info returns the contact email", async () => {
  assert.deepEqual(await (await server.get("/api/info")).json(), { contactEmail: "owner@example.com" });
});
