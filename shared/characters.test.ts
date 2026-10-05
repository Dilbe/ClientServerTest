import { test } from "node:test";
import assert from "node:assert/strict";
import { characterName, nameOfCharacter } from "./characters.ts";

test("a character without a name goes by its class and number", () => {
  assert.equal(nameOfCharacter({ class: "adventurer", number: 1 }), "Adventurer 1");
  assert.equal(nameOfCharacter({ name: null, class: "adventurer", number: 12 }), "Adventurer 12");
  assert.equal(nameOfCharacter({ name: "Runner", class: "adventurer", number: 2 }), "Runner");
});

test("character names follow the display name rules, but may be short", () => {
  for (const ok of ["R", "Runner", "Tank 2", "big-hitter_3", "a".repeat(20)]) assert.ok(characterName.safeParse(ok).success, ok);
  for (const bad of ["", " Runner", "Runner ", "Two  spaces", "Bоb", "<b>", "a".repeat(21)]) {
    assert.ok(!characterName.safeParse(bad).success, bad);
  }
});
