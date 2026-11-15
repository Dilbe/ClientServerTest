// How the turn duration for new games is remembered (design.md, Lobby;
// issue #399): the turn duration a host started their last game with, under
// one key in the browser's `localStorage`. character-filter.ts explains what
// localStorage is and why what comes out of it is checked.
//
// Like character-filter-storage.ts, this file uses no browser features: it
// is given the storage to use, so Node can run its tests with a stand-in.

import { DEFAULT_TURN_DURATION, TURN_DURATION_IDS, type TurnDurationId } from "../shared/turn-durations.ts";
import type { KeyValueStorage } from "./character-filter-storage.ts";

export const TURN_DURATION_KEY = "startTurnDuration";

/**
 * The remembered turn duration, or the default when there is none (yet) or
 * it isn't one of the choices (any more): a player can change it by hand.
 * Can throw when the browser doesn't allow storage (some private modes).
 */
export function loadTurnDuration(storage: Pick<KeyValueStorage, "getItem">): TurnDurationId {
  const stored = storage.getItem(TURN_DURATION_KEY);
  return TURN_DURATION_IDS.find((id) => id === stored) ?? DEFAULT_TURN_DURATION;
}

/** Remembers the turn duration a game started with. Can throw when storage isn't allowed or is full. */
export function saveTurnDuration(storage: Pick<KeyValueStorage, "setItem">, turnDuration: TurnDurationId): void {
  storage.setItem(TURN_DURATION_KEY, turnDuration);
}
