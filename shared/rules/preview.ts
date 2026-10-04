// The preview: what will happen with the current plans (design.md, Planning
// and Monsters; architecture.md, Keeping the client in sync).
//
// The game is deterministic, so the preview needs no rules of its own: it
// runs the same `resolveTurn` the server runs, for each upcoming turn in
// order, on a copy of the state. As long as nobody changes a plan, what it
// shows is exactly what the server will do. If a player changes a plan, the
// client simply runs the preview again.
//
// It looks one cycle ahead: every character on the track acts once, and with
// it the monsters that follow it, so every monster gets its next action.

import { applyEvent, type GameEvent } from "./events.ts";
import type { CharacterId, GameState, MonsterId } from "./game-state.ts";
import type { Hex } from "./hex.ts";
import { decideMonsterAction } from "./monsters.ts";
import { gameResult, resolveTurn, type Plans } from "./turn.ts";

/** One previewed turn: the character whose turn fires, and what happens in it. */
export interface PreviewTurn {
  characterId: CharacterId;
  events: GameEvent[];
}

/** What a monster does next, according to the preview. */
export type MonsterPreview =
  | {
      type: "attack";
      /** The character whose turn it acts in. */
      after: CharacterId;
      target: CharacterId;
      /** Where the target stands when it is attacked (it may have moved first). */
      targetAt: Hex;
      damage: number;
      kills: boolean;
    }
  | { type: "move"; after: CharacterId; from: Hex; to: Hex; target: CharacterId }
  /** It is killed in the turn of `after`, without having moved or attacked first. */
  | { type: "dies"; after: CharacterId }
  /** It doesn't move: no target, or no free hex brings it closer. */
  | { type: "stays" };

export interface Preview {
  turns: PreviewTurn[];
  /** For every monster that is alive now. */
  monsters: Map<MonsterId, MonsterPreview>;
}

/**
 * Resolves the upcoming turns in `turnOrder` (soonest first, as the server's
 * "next turns" lists them) with the given plans. Stops when the game ends; a
 * character that dies before its turn is skipped, as the server would.
 */
export function previewCycle(state: GameState, turnOrder: readonly CharacterId[], plans: Plans): Preview {
  const turns: PreviewTurn[] = [];
  const monsters = new Map<MonsterId, MonsterPreview>();
  for (const m of state.monsters) if (m.hp > 0) monsters.set(m.id, { type: "stays" });
  const known = new Set<MonsterId>();

  let current = state;
  for (const characterId of turnOrder) {
    if (gameResult(current) !== null) break;
    if (!current.track.some((s) => s.characterId === characterId)) continue; // Died this cycle.
    const { events } = resolveTurn(current, characterId, plans);
    turns.push({ characterId, events });

    // Walk through the events one by one, so each monster's action can be
    // looked at in the state the monster saw when it decided.
    for (const event of events) {
      const preview = monsterPreview(current, event, characterId);
      if (preview && !known.has(preview.id)) {
        known.add(preview.id);
        monsters.set(preview.id, preview.preview);
      }
      current = applyEvent(current, event);
    }
  }
  return { turns, monsters };
}

/** The monster preview an event gives, if it is about a monster acting or dying. */
function monsterPreview(
  before: GameState,
  event: GameEvent,
  after: CharacterId,
): { id: MonsterId; preview: MonsterPreview } | undefined {
  if (event.type === "died" && event.who.kind === "monster") {
    return { id: event.who.id, preview: { type: "dies", after } };
  }
  if (event.type === "moved" && event.actor.kind === "monster") {
    // The events don't say whom the monster is after; asking the rules again
    // in the same state gives the same decision.
    const decision = decideMonsterAction(before, event.actor.id);
    if (decision.type !== "move") throw new Error("The preview doesn't match the monster's decision.");
    return {
      id: event.actor.id,
      preview: { type: "move", after, from: event.from, to: event.to, target: decision.target },
    };
  }
  if (event.type === "attacked" && event.attacker.kind === "monster" && event.target.kind === "character") {
    const target = before.characters.find((c) => c.id === event.target.id)!;
    return {
      id: event.attacker.id,
      preview: {
        type: "attack",
        after,
        target: target.id,
        targetAt: target.position!,
        damage: event.damage,
        kills: target.hp - event.damage <= 0,
      },
    };
  }
  return undefined;
}
