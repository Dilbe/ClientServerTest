import { test } from "node:test";
import assert from "node:assert/strict";
import { RateLimiter } from "./rate-limit.ts";

test("allows attempts up to the limit within the window", () => {
  const limiter = new RateLimiter(2, 1000);
  assert.equal(limiter.retryAfter("k", 0), 0);
  limiter.record("k", 0);
  limiter.record("k", 100);
  assert.equal(limiter.retryAfter("k", 200), 800);
  assert.equal(limiter.retryAfter("other", 200), 0);
  assert.equal(limiter.retryAfter("k", 1001), 0);
});

test("reset and prune forget a key", () => {
  const limiter = new RateLimiter(1, 1000);
  limiter.record("k", 0);
  limiter.reset("k");
  assert.equal(limiter.retryAfter("k", 0), 0);
  limiter.record("k", 0);
  limiter.prune(2000);
  assert.equal(limiter.retryAfter("k", 0), 0);
});
