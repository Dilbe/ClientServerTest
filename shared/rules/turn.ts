// Resolving a turn (design.md, Turns, Entering the room and Planning).
//
// `resolveTurn` is the heart of the rules layer: the game manager calls it
// when a character's turn fires, stores the events it returns and sends them
// to the clients. It is a pure function: it reads the state and the plans and
// returns a new state, without changing its input, looking at the clock or
// using randomness. The client runs the same function for the preview.

import { isOnMap, type DungeonMap } from "./dungeon-map.ts";
import { applyEvent, type CancelReason, type GameEvent } from "./events.ts";
import { isFree, type AccountId, type CharacterId, type GameState, type MonsterId, type TrackSlot } from "./game-state.ts";
import { areNeighbours, hexEquals, type Hex } from "./hex.ts";
import { decideMonsterAction } from "./monsters.ts";
import { MONSTER_TYPES, type Stats } from "./stats.ts";

/** What a player plans for their character's next turn. */
export type Plan =
  | { type: "place"; hex: Hex }
  | { type: "move"; to: Hex }
  | { type: "attack"; monsterId: MonsterId };

/**
 * The current plan of each character. A character without an entry has no
 * plan. Plans are kept by the game manager; after a turn the plan of the
 * character that acted is used up, whether it was carried out or cancelled.
 */
export type Plans = ReadonlyMap<CharacterId, Plan>;

export interface NewCharacter {
  id: CharacterId;
  accountId: AccountId;
  stats: Stats;
}

/**
 * The state at the start of a game: characters at full hit points and off
 * the map, the map's monsters in their places, and the given track (see
 * `createTrack`).
 */
export function newGameState(map: DungeonMap, characters: readonly NewCharacter[], track: TrackSlot[]): GameState {
  return {
    map,
    characters: characters.map((c) => ({ ...c, hp: c.stats.hitPoints, position: null })),
    monsters: map.monsters.map((m, id) => ({
      id,
      type: m.type,
      hp: MONSTER_TYPES[m.type].stats.hitPoints,
      position: m.position,
    })),
    track,
  };
}

/** Won when every monster is dead, lost when every character is dead, otherwise `null`. */
export function gameResult(state: GameState): "won" | "lost" | null {
  if (state.monsters.every((m) => m.hp === 0)) return "won";
  if (state.characters.every((c) => c.hp === 0)) return "lost";
  return null;
}

/**
 * Resolves the turn of one character: its action, and then the actions of
 * the monsters that follow it on the track.
 *
 * Throws when the turn can't be resolved at all (the game is over, or the
 * character isn't on the track): that is a mistake in the caller, not a
 * situation in the game.
 */
export function resolveTurn(
  state: GameState,
  characterId: CharacterId,
  plans: Plans,
): { newState: GameState; events: GameEvent[] } {
  if (gameResult(state) !== null) throw new Error("The game is over.");
  if (!state.track.some((s) => s.characterId === characterId)) {
    throw new Error(`Character ${characterId} isn't on the initiative track.`);
  }

  // Every event is applied as soon as it happens, so each step sees the
  // result of the steps before it.
  let current = state;
  const events: GameEvent[] = [];
  const emit = (event: GameEvent) => {
    events.push(event);
    current = applyEvent(current, event);
  };

  const character = state.characters.find((c) => c.id === characterId)!;
  const plan = plans.get(characterId);
  if (character.position === null) {
    enterTheRoom(current, characterId, plan, emit);
  } else {
    carryOutPlan(current, characterId, character.position, plan, emit);
  }

  // The monsters that follow the character at the start of the turn act,
  // even if a monster kills that character halfway (its remaining monsters
  // then move to another player on the track, but still act now).
  const monsterIds = state.track.find((s) => s.characterId === characterId)!.monsterIds;
  for (const monsterId of monsterIds) {
    if (gameResult(current) !== null) break; // Nobody left to fight.
    if (current.monsters.find((m) => m.id === monsterId)!.hp === 0) continue;
    monsterTurn(current, monsterId, emit);
  }

  const result = gameResult(current);
  if (result !== null) emit({ type: "gameEnded", result });
  return { newState: current, events };
}

/**
 * A character that isn't on the map yet is placed: on its planned start hex
 * if that is still possible, and otherwise on the first free one. A plan that
 * can't be carried out is cancelled, which leaves the character without a
 * plan, so it is placed automatically like a character that had none.
 */
function enterTheRoom(state: GameState, characterId: CharacterId, plan: Plan | undefined, emit: Emit) {
  if (plan?.type === "place") {
    const problem = placementProblem(state, plan.hex);
    if (problem === null) return emit({ type: "placed", characterId, position: plan.hex });
    emit({ type: "planCancelled", characterId, reason: problem });
  } else if (plan) {
    emit({ type: "planCancelled", characterId, reason: "not placed" });
  }

  const free = state.map.startHexes.find((h) => isFree(state, h));
  emit(free ? { type: "placed", characterId, position: free } : { type: "notPlaced", characterId });
}

function placementProblem(state: GameState, h: Hex): CancelReason | null {
  if (!state.map.startHexes.some((s) => hexEquals(s, h))) return "not a start hex";
  if (!isFree(state, h)) return "hex taken";
  return null;
}

function carryOutPlan(
  state: GameState,
  characterId: CharacterId,
  position: Hex,
  plan: Plan | undefined,
  emit: Emit,
) {
  if (!plan) return; // No plan: the character does nothing.
  const cancel = (reason: CancelReason) => emit({ type: "planCancelled", characterId, reason });
  const actor = { kind: "character", id: characterId } as const;

  switch (plan.type) {
    case "place":
      return cancel("already placed");

    case "move":
      // Every character moves 1 hex for now. Once the movement stat can be
      // higher, this needs a path instead of a single neighbour.
      if (!areNeighbours(position, plan.to)) return cancel("not a neighbour");
      if (!isOnMap(state.map, plan.to)) return cancel("not on the map");
      if (!isFree(state, plan.to)) return cancel("hex taken");
      return emit({ type: "moved", actor, from: position, to: plan.to });

    case "attack": {
      const monster = state.monsters.find((m) => m.id === plan.monsterId);
      if (!monster || monster.hp === 0 || !areNeighbours(position, monster.position)) {
        return cancel("target gone");
      }
      const damage = state.characters.find((c) => c.id === characterId)!.stats.attackDamage;
      const target = { kind: "monster", id: monster.id } as const;
      emit({ type: "attacked", attacker: actor, target, damage });
      if (monster.hp - damage <= 0) emit({ type: "died", who: target });
      return;
    }
  }
}

function monsterTurn(state: GameState, monsterId: MonsterId, emit: Emit) {
  const monster = state.monsters.find((m) => m.id === monsterId)!;
  const actor = { kind: "monster", id: monsterId } as const;
  const action = decideMonsterAction(state, monsterId);

  switch (action.type) {
    case "wait":
      return;
    case "move":
      return emit({ type: "moved", actor, from: monster.position, to: action.to });
    case "attack": {
      const damage = MONSTER_TYPES[monster.type].stats.attackDamage;
      const target = { kind: "character", id: action.target } as const;
      emit({ type: "attacked", attacker: actor, target, damage });
      const hp = state.characters.find((c) => c.id === action.target)!.hp;
      if (hp - damage <= 0) emit({ type: "died", who: target });
      return;
    }
  }
}

type Emit = (event: GameEvent) => void;
