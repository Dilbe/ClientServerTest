import { test } from "node:test";
import assert from "node:assert/strict";
import { localTime, restText } from "./rest-text.ts";

const hour = 3_600_000;

test("a healing character shows when the healing ends and when it is ready", () => {
  const now = Date.now();
  const rest = { healingUntil: now + hour, restingUntil: now + 3 * hour };
  assert.equal(restText(rest), `Healing until ${localTime(now + hour)} · ready at ${localTime(now + 3 * hour)}`);
});

test("a resting character shows only when it is ready", () => {
  const now = Date.now();
  const rest = { healingUntil: now - hour, restingUntil: now + 2 * hour };
  assert.equal(restText(rest), `Resting · ready at ${localTime(now + 2 * hour)}`);
});

test("a working character shows where it works and when it is done", () => {
  const now = Date.now();
  const rest = { workingUntil: now + hour, healingUntil: 0, restingUntil: now + 2 * hour };
  assert.equal(restText(rest, "woodcutter"), `Woodcutter · done at ${localTime(now + hour)}`);
});

test("a ready character shows nothing", () => {
  assert.equal(restText({ healingUntil: 0, restingUntil: 0 }), undefined);
});
