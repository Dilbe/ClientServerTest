import { test } from "node:test";
import assert from "node:assert/strict";
import { createTrack, removeCharacterFromTrack, removeMonsterFromTrack, rotateTrack } from "./track.ts";
import type { TrackSlot } from "./game-state.ts";

const A = 1;
const B = 2;
const C = 3;

/** Who acts, in order, as "A", "B", "monster 1" and so on. */
function actingOrder(track: TrackSlot[]): string[] {
  const names: Record<number, string> = { [A]: "A", [B]: "B", [C]: "C" };
  return track.flatMap((s) => [names[s.characterId]!, ...s.monsterIds.map((m) => `monster ${m}`)]);
}

test("design.md's track table: 2 players, each followed by their own monster", () => {
  // | 30s | Player A, then directly Monster A |
  // | 60s | Player B, then directly Monster B |
  // | 90s | Player A, then directly Monster A |
  const track = createTrack([A, B], new Map([[0, A], [1, B]]));
  assert.deepEqual(track, [
    { characterId: A, monsterIds: [0] },
    { characterId: B, monsterIds: [1] },
  ]);
  assert.deepEqual(actingOrder(track), ["A", "monster 0", "B", "monster 1"]);
});

test("the player order is taken as given", () => {
  const track = createTrack([B, A], new Map([[0, A], [1, B]]));
  assert.deepEqual(actingOrder(track), ["B", "monster 1", "A", "monster 0"]);
});

test("2 players and 3 monsters: one player is followed by 2 monsters, in id order", () => {
  const track = createTrack([A, B], new Map([[2, B], [0, A], [1, B]]));
  assert.deepEqual(actingOrder(track), ["A", "monster 0", "B", "monster 1", "monster 2"]);
});

test("3 players and 1 monster: the monster follows one player", () => {
  const track = createTrack([A, B, C], new Map([[0, C]]));
  assert.deepEqual(actingOrder(track), ["A", "B", "C", "monster 0"]);
});

test("monsters that aren't spread evenly are refused", () => {
  assert.throws(() => createTrack([A, B], new Map([[0, A], [1, A]])), /evenly/);
});

test("a monster can only follow a character on the track", () => {
  assert.throws(() => createTrack([A], new Map([[0, B]])), /isn't on the track/);
  assert.throws(() => createTrack([A, A], new Map()), /twice/);
});

test("design.md: A, monster 1, B, monster 2, C. When B dies, it becomes A, monster 1, monster 2, C", () => {
  const track = createTrack([A, B, C], new Map([[1, A], [2, B]]));
  assert.deepEqual(actingOrder(track), ["A", "monster 1", "B", "monster 2", "C"]);
  assert.deepEqual(actingOrder(removeCharacterFromTrack(track, B)), ["A", "monster 1", "monster 2", "C"]);
});

test("when the first player dies, their monsters go to the last player, after its own", () => {
  const track = createTrack([A, B, C], new Map([[0, A], [1, B], [2, C]]));
  assert.deepEqual(actingOrder(removeCharacterFromTrack(track, A)), ["B", "monster 1", "C", "monster 2", "monster 0"]);
});

test("when the last player dies, the track is empty", () => {
  const track = createTrack([A], new Map([[0, A]]));
  assert.deepEqual(removeCharacterFromTrack(track, A), []);
});

test("a dead monster leaves the track", () => {
  const track = createTrack([A, B], new Map([[0, A], [1, B]]));
  assert.deepEqual(actingOrder(removeMonsterFromTrack(track, 0)), ["A", "B", "monster 1"]);
});

test("the shown track starts with the next to act; the group that acted moves to the end", () => {
  const track = createTrack([A, B, C], new Map([[1, A], [2, B]]));
  assert.deepEqual(actingOrder(rotateTrack(track, A)), ["A", "monster 1", "B", "monster 2", "C"]);
  assert.deepEqual(actingOrder(rotateTrack(track, B)), ["B", "monster 2", "C", "A", "monster 1"]);
  assert.deepEqual(actingOrder(rotateTrack(track, C)), ["C", "A", "monster 1", "B", "monster 2"]);
});

test("after a death the shown track still starts with the next to act", () => {
  // B dies; monster 2 moves to A. C is next.
  const track = removeCharacterFromTrack(createTrack([A, B, C], new Map([[1, A], [2, B]])), B);
  assert.deepEqual(actingOrder(rotateTrack(track, C)), ["C", "A", "monster 1", "monster 2"]);
});

test("without a known next character the track is shown as it is", () => {
  const track = createTrack([A, B], new Map([[1, A]]));
  assert.deepEqual(actingOrder(rotateTrack(track, undefined)), ["A", "monster 1", "B"]);
  assert.deepEqual(actingOrder(rotateTrack(track, C)), ["A", "monster 1", "B"]);
});
