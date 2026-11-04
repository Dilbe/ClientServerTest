// Which events of a turn belong to which planned action (issue #336;
// architecture.md, Keeping the client in sync).
//
// A used plan loses its arrows one action at a time during the playback.
// The events the server sends don't say which action they belong to: a move
// of 3 hexes is 3 "moved" events, a cleave several hits. So the client runs
// the turn itself with the shared rules, the way the preview does, and lets
// `resolveTurn` say where each action ended. The rules have no randomness,
// so this gives exactly the server's events; that is checked anyway, and
// when they differ the answer is "don't know".
//
// No DOM here, so it can be unit tested (client/turn-actions.test.ts).

import { applyEvents, type GameEvent } from "../shared/rules/events.ts";
import type { CharacterId, GameState } from "../shared/rules/game-state.ts";
import type { Hex } from "../shared/rules/hex.ts";
import { resolveTurn, type Plan } from "../shared/rules/turn.ts";

export interface TurnActions {
  /** For each action that was tried: the index of the first event after it (see `resolveTurn`). */
  ends: number[];
  /** For each action that was tried: where the character stood when it started (`null`: not on the map yet). */
  starts: (Hex | null)[];
}

/**
 * Where each action of a character's turn ended, worked out by resolving the
 * turn again on `state` (the state before it) with the plan it used.
 * `undefined` when that doesn't give the server's `events`, or can't be
 * worked out at all.
 */
export function turnActions(
  state: GameState,
  characterId: CharacterId,
  plan: Plan,
  events: readonly GameEvent[],
): TurnActions | undefined {
  let result;
  try {
    result = resolveTurn(state, characterId, new Map([[characterId, plan]]));
  } catch {
    return undefined;
  }
  // Both sides are plain data from the same rules, so comparing their JSON is enough.
  if (JSON.stringify(result.events) !== JSON.stringify(events)) return undefined;
  const starts = result.actionEnds.map((_, i) => {
    const before = i === 0 ? 0 : result.actionEnds[i - 1]!;
    return applyEvents(state, events.slice(0, before)).characters.find((c) => c.id === characterId)?.position ?? null;
  });
  return { ends: result.actionEnds, starts };
}

/** The action the event at `index` belongs to; `undefined` after the character's last action (its monsters' part). */
export function actionOfEvent(actions: TurnActions, index: number): number | undefined {
  const action = actions.ends.findIndex((end) => index < end);
  return action === -1 ? undefined : action;
}
