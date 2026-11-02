import { test } from "node:test";
import assert from "node:assert/strict";
import { MIN_SCALE, MIN_STEP_MS, playbackPace, SLIDE_MS, STEP_MS } from "./playback-pace.ts";

test("with enough time, the playback keeps its normal pace", () => {
  assert.deepEqual(playbackPace({ budgetMs: 10_000, steps: 3, slides: 2 }), { scale: 1, jump: false });
});

test("without a deadline or anything to show, the pace is normal", () => {
  assert.deepEqual(playbackPace({ budgetMs: undefined, steps: 20, slides: 10 }), { scale: 1, jump: false });
  assert.deepEqual(playbackPace({ budgetMs: 0, steps: 0, slides: 0 }), { scale: 1, jump: false });
});

test("with too little time, it speeds up just enough to finish within the budget", () => {
  // 4 steps and 2 slides take 4.2 s at normal pace; 2.1 s is half of that.
  const pace = playbackPace({ budgetMs: 2100, steps: 4, slides: 2 });
  assert.equal(pace.jump, false);
  assert.equal(pace.scale, 0.5);
  assert.equal(pace.scale * (4 * STEP_MS + 2 * SLIDE_MS), 2100);
});

test("it never gets faster than the minimum step: then it says to jump", () => {
  // 6 s of playback in 0.5 s would make a step 67 ms.
  const pace = playbackPace({ budgetMs: 500, steps: 6, slides: 2 });
  assert.equal(pace.jump, true);
  assert.equal(pace.scale, MIN_SCALE);
  assert.equal(pace.scale * STEP_MS, MIN_STEP_MS);
});

test("exactly at the minimum step, it still plays back without jumping", () => {
  const pace = playbackPace({ budgetMs: MIN_STEP_MS * 4, steps: 4, slides: 0 });
  assert.deepEqual(pace, { scale: MIN_SCALE, jump: false });
});

test("a deadline that has passed jumps", () => {
  assert.deepEqual(playbackPace({ budgetMs: -300, steps: 1, slides: 0 }), { scale: MIN_SCALE, jump: true });
});
