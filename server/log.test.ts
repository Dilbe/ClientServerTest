// The server's log lines start with their own time (issue #168).

import { test } from "node:test";
import assert from "node:assert/strict";
import { log, logError } from "./log.ts";

/** An ISO time in UTC with milliseconds, then a space: `2026-10-10T18:31:05.123Z `. */
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z /;

test("a log line starts with the time, with milliseconds, and goes to standard output", (t) => {
  const written = t.mock.method(console, "log", () => {});

  log("Server running");

  const [line] = written.mock.calls[0]!.arguments as [string];
  assert.match(line, TIME);
  assert.equal(line.replace(TIME, ""), "Server running");
});

test("an error line starts with the time and goes to standard error, with the error after it", (t) => {
  const written = t.mock.method(console, "error", () => {});
  const error = new Error("boom");

  logError("A request failed:", error);

  const [line, detail] = written.mock.calls[0]!.arguments as [string, unknown];
  assert.match(line, TIME);
  assert.equal(line.replace(TIME, ""), "A request failed:");
  // Passed on as it is, so console.error prints its stack trace.
  assert.equal(detail, error);
});

test("the time is the current time", (t) => {
  const written = t.mock.method(console, "log", () => {});
  const before = Date.now();

  log("now");

  const after = Date.now();
  const [line] = written.mock.calls[0]!.arguments as [string];
  const time = Date.parse(line.slice(0, 24));
  assert.ok(before <= time && time <= after);
});
