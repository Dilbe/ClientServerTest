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
// it the monsters that follow it, so every monster gets its next turn.
//
// Because every turn of the cycle is resolved with everyone's plans, the
// preview also shows which planned actions will be cancelled: for example a
// move to a hex another character will have stepped onto first, or an
// attack on a monster another character will have killed.

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

/** One action of a monster, according to the preview. */
export type MonsterStep =
  | {
      type: "attack";
      target: CharacterId;
      /** Where the target stands when it is attacked (it may have moved first). */
      targetAt: Hex;
      damage: number;
      kills: boolean;
    }
  | { type: "move"; from: Hex; to: Hex; target: CharacterId };

/** What a monster does on its next turn, according to the preview. */
export type MonsterPreview =
  /** `after` is the character whose turn it acts in; `steps` its actions, in order. */
  | { type: "acts"; after: CharacterId; steps: MonsterStep[] }
  /** It is killed in the turn of `after`, without having moved or attacked first. */
  | { type: "dies"; after: CharacterId }
  /** It doesn't move: no target, or no free hex brings it closer. */
  | { type: "stays" }
  /**
   * It is asleep behind a closed door, or on guard, and nothing wakes it
   * this cycle.
   */
  | { type: "asleep" };

/** A planned action that the preview says will be cancelled. */
export type PreviewCancellation = Extract<GameEvent, { type: "planCancelled" }>;

export interface Preview {
  turns: PreviewTurn[];
  /** For every monster that is alive now. */
  monsters: Map<MonsterId, MonsterPreview>;
  /** Every planned action that won't go through, in the order the turns fire. */
  cancellations: PreviewCancellation[];
}

/**
 * Resolves the upcoming turns in `turnOrder` (soonest first, as the server's
 * "next turns" lists them) with the given plans. Stops when the game ends; a
 * character that dies before its turn is skipped, as the server would.
 */
export function previewCycle(state: GameState, turnOrder: readonly CharacterId[], plans: Plans): Preview {
  const turns: PreviewTurn[] = [];
  const monsters = new Map<MonsterId, MonsterPreview>();
  for (const m of state.monsters) if (m.hp > 0) monsters.set(m.id, { type: m.asleep ? "asleep" : "stays" });
  const cancellations: PreviewCancellation[] = [];
  /** The monsters whose next turn is known: their first event in the cycle decides. */
  const known = new Set<MonsterId>();

  let current = state;
  for (const characterId of turnOrder) {
    if (gameResult(current) !== null) break;
    if (!current.track.some((s) => s.characterId === characterId)) continue; // Died this cycle.
    const { events } = resolveTurn(current, characterId, plans);
    turns.push({ characterId, events });
    /** The steps of the monsters whose next turn is this one. */
    const actingNow = new Map<MonsterId, MonsterStep[]>();

    // Walk through the events one by one, so each monster's action can be
    // looked at in the state the monster saw when it decided.
    for (const event of events) {
      if (event.type === "planCancelled") cancellations.push(event);
      // Woken up this cycle: awake, though it may not get to act before the cycle ends.
      if (event.type === "monstersWoke") for (const id of event.monsterIds) monsters.set(id, { type: "stays" });
      if (event.type === "died" && event.who.kind === "monster" && !known.has(event.who.id)) {
        known.add(event.who.id);
        monsters.set(event.who.id, { type: "dies", after: characterId });
      }
      const step = monsterStep(current, event);
      if (step && !known.has(step.id)) {
        known.add(step.id);
        const steps: MonsterStep[] = [];
        actingNow.set(step.id, steps);
        monsters.set(step.id, { type: "acts", after: characterId, steps });
      }
      if (step) actingNow.get(step.id)?.push(step.step);
      current = applyEvent(current, event);
    }
  }
  return { turns, monsters, cancellations };
}

/** The monster step an event gives, if it is about a monster acting. */
function monsterStep(before: GameState, event: GameEvent): { id: MonsterId; step: MonsterStep } | undefined {
  if (event.type === "moved" && event.actor.kind === "monster") {
    // The events don't say whom the monster is after; asking the rules again
    // in the same state gives the same decision.
    const decision = decideMonsterAction(before, event.actor.id);
    if (decision.type !== "move") throw new Error("The preview doesn't match the monster's decision.");
    return { id: event.actor.id, step: { type: "move", from: event.from, to: event.to, target: decision.target } };
  }
  if (event.type === "attacked" && event.attacker.kind === "monster" && event.target.kind === "character") {
    const target = before.characters.find((c) => c.id === event.target.id)!;
    return {
      id: event.attacker.id,
      step: {
        type: "attack",
        target: target.id,
        targetAt: target.position!,
        damage: event.damage,
        kills: target.hp - event.damage <= 0,
      },
    };
  }
  return undefined;
}
