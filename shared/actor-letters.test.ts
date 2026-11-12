import { test } from "node:test";
import assert from "node:assert/strict";
import { characterLetter, letterAt, monsterLetter } from "./actor-letters.ts";

test("the sequence goes A–Z, then a–z, then numbers from 1", () => {
  assert.equal(letterAt(0), "A");
  assert.equal(letterAt(25), "Z");
  assert.equal(letterAt(26), "a");
  assert.equal(letterAt(51), "z");
  assert.equal(letterAt(52), "1");
  assert.equal(letterAt(53), "2");
});

test("characters start at A", () => {
  assert.equal(characterLetter(1), "A");
  assert.equal(characterLetter(3), "C");
});

test("the first monster gets the letter after the last character", () => {
  assert.equal(monsterLetter(0, 3), "D");
  assert.equal(monsterLetter(1, 3), "E");
  assert.equal(monsterLetter(0, 1), "B");
  assert.equal(monsterLetter(23, 3), "a");
});
