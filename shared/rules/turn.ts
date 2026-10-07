// Resolving a turn (design.md, Turns, Entering the room, Planning, Doors and
// sleeping rooms, and Guards and alert range).
//
// `resolveTurn` is the heart of the rules layer: the game manager calls it
// when a character's turn fires, stores the events it returns and sends them
// to the clients. It is a pure function: it reads the state and the plans and
// returns a new state, without changing its input, looking at the clock or
// using randomness. The client runs the same function for the preview.

import { isOnMap, isStartHex, roomAround, sleepsAtStart, type DungeonMap } from "./dungeon-map.ts";
import { applyEvent, type CancelReason, type GameEvent } from "./events.ts";
import {
  isClosedDoor,
  isFree,
  type CharacterId,
  type GameState,
  type MonsterId,
  type MonsterState,
  type TrackSlot,
} from "./game-state.ts";
import { areNeighbours, distance, hexKey, type Hex } from "./hex.ts";
import { decideMonsterAction } from "./monsters.ts";
import { ABILITIES, HEAVY_STRIKE_DAMAGE_MULTIPLIER, type AbilityId } from "./abilities.ts";
import { maxXp } from "./advancement.ts";
import { DEFAULT_DIFFICULTY, monsterStats, monsterXp, type DifficultyId } from "./difficulties.ts";
import { xpAfterKills } from "./diminishing-returns.ts";
import { MONSTER_TYPES, type Stats } from "./stats.ts";

/** One action a player plans for their character. */
export type PlannedAction =
  | { type: "place"; hex: Hex }
  | { type: "move"; to: Hex }
  | { type: "attack"; monsterId: MonsterId }
  /** An attack for double damage, with a cooldown (design.md, Heavy strike). */
  | { type: "heavyStrike"; monsterId: MonsterId }
  /** Opens the closed door on the hex `door`, next to the character. */
  | { type: "openDoor"; door: Hex };

/**
 * What a player plans for their character's next turn: its actions, in the
 * order they are carried out. At most as many as the character's actions
 * stat (design.md, Actions); the game manager refuses longer plans.
 */
export type Plan = PlannedAction[];

/**
 * The current plan of each character. A character without an entry has no
 * plan. Plans are kept by the game manager; after a turn the plan of the
 * character that acted is used up, whether it was carried out or cancelled.
 */
export type Plans = ReadonlyMap<CharacterId, Plan>;

export interface NewCharacter {
  id: CharacterId;
  stats: Stats;
  /**
   * The most XP it can gain in the game (see CharacterState). Without it:
   * a rank 1 character with 0 XP.
   */
  maxXpGain?: number;
  /** Its earlier kills in this dungeon on this difficulty (see CharacterState). Without them: none. */
  earlierKills?: readonly number[];
  /** Its abilities (see CharacterState). Without them: none, as at rank 1. */
  abilities?: readonly AbilityId[];
}

/**
 * The state at the start of a game: characters at full hit points and off
 * the map, the map's monsters in their places (asleep behind a closed door,
 * on guard if their type has an alert range, or awake), every door closed,
 * and the given track (see `createTrack`). The monsters' hit points are those
 * of the difficulty.
 */
export function newGameState(
  map: DungeonMap,
  characters: readonly NewCharacter[],
  track: TrackSlot[],
  difficulty: DifficultyId = DEFAULT_DIFFICULTY,
): GameState {
  return {
    map,
    difficulty,
    characters: characters.map((c) => ({
      id: c.id,
      stats: c.stats,
      hp: c.stats.hitPoints,
      position: null,
      xpGained: 0,
      maxXpGain: c.maxXpGain ?? maxXp(1),
      earlierKills: [...(c.earlierKills ?? [])],
      abilities: [...(c.abilities ?? [])],
      cooldowns: {},
    })),
    monsters: map.monsters.map((m, id) => ({
      id,
      type: m.type,
      hp: monsterStats(m.type, difficulty).hitPoints,
      position: m.position,
      asleep: MONSTER_TYPES[m.type].alertRange !== undefined || sleepsAtStart(map, m.position),
    })),
    track,
    closedDoors: [...map.doors],
  };
}

/**
 * Won when every monster is dead, lost when every character is dead,
 * otherwise `null`. Every monster means every one: also the ones asleep
 * behind a door that was never opened.
 */
export function gameResult(state: GameState): "won" | "lost" | null {
  if (state.monsters.every((m) => m.hp === 0)) return "won";
  if (state.characters.every((c) => c.hp === 0)) return "lost";
  return null;
}

/**
 * Resolves the turn of one character: its actions, and then the actions of
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

  // The character does as many actions as its actions stat says, one
  // planned action each. An action that can't be carried out is cancelled,
  // and the next one is still tried (design.md, Actions). Without a planned
  // action the character does nothing, except that a character that isn't on
  // the map yet enters the room automatically.
  const character = state.characters.find((c) => c.id === characterId)!;
  const plan = plans.get(characterId) ?? [];
  // Every own turn counts down the cooldowns, also when the character isn't
  // on the map (design.md, Heavy strike). An ability that was on cooldown at
  // the start of the turn can't be used in it.
  if (Object.values(character.cooldowns).some((turns) => turns > 0)) emit({ type: "cooldownsAdvanced", characterId });
  for (let index = 0; index < character.stats.actions; index++) {
    if (gameResult(current) !== null) break; // Won halfway: nothing left to do.
    const action = plan[index];
    const position = current.characters.find((c) => c.id === characterId)!.position;
    if (position === null) {
      // No free start hex: it stays off the map, and without a hex on the
      // map none of its other actions can be carried out either.
      if (!enterTheRoom(current, characterId, action, index, emit)) break;
    } else if (action) {
      carryOutAction(current, state, characterId, position, action, index, emit);
    }
  }

  // The monsters that follow the character at the start of the turn act,
  // even if a monster kills that character halfway (its remaining monsters
  // then move to another player on the track, but still act now). Sleeping
  // monsters skip their turn; a monster that the character just woke up by
  // opening a door or attacking it is awake now, so it acts. A monster on
  // guard first checks whether a character has come within its alert range.
  const monsterIds = state.track.find((s) => s.characterId === characterId)!.monsterIds;
  for (const monsterId of monsterIds) {
    if (gameResult(current) !== null) break;
    if (current.monsters.find((m) => m.id === monsterId)!.asleep) checkAlert(current, monsterId, emit);
    const monster = current.monsters.find((m) => m.id === monsterId)!;
    if (monster.hp === 0 || monster.asleep) continue;
    for (let i = 0; i < monsterStats(monster.type, current.difficulty).actions; i++) {
      if (gameResult(current) !== null) break; // Nobody left to fight.
      // A monster that waits would wait again: nothing has changed.
      if (!monsterAction(current, monsterId, emit)) break;
    }
  }

  const result = gameResult(current);
  if (result !== null) emit({ type: "gameEnded", result });
  return { newState: current, events };
}

/**
 * The plan a character starts its next turn with, after its turn resolved
 * with these events (design.md, Keeping a monster targeted): when the last
 * action it carried out was an attack on a monster that is still alive, as
 * many attacks on that monster as it takes to kill it, but no more than its
 * actions stat. Otherwise `null`: no plan. A heavy strike counts as an
 * attack here, but the follow-up plan only has normal attacks.
 *
 * A pure function like `resolveTurn`. The game manager stores the result
 * with the turn, so rebuilding a game after a restart doesn't run it again.
 */
export function followUpPlan(state: GameState, characterId: CharacterId, events: readonly GameEvent[]): Plan | null {
  const character = state.characters.find((c) => c.id === characterId);
  if (!character || character.hp === 0) return null;

  // The character's own actions are the events about it; the monsters' come
  // after them, and a monster's attack on it doesn't count as its action.
  const lastAction = events.findLast(
    (e) =>
      (e.type === "attacked" && e.attacker.kind === "character" && e.attacker.id === characterId) ||
      (e.type === "moved" && e.actor.kind === "character" && e.actor.id === characterId) ||
      (e.type === "placed" && e.characterId === characterId) ||
      (e.type === "doorOpened" && e.characterId === characterId),
  );
  if (lastAction?.type !== "attacked" || lastAction.target.kind !== "monster") return null;

  const monsterId = lastAction.target.id;
  const monster = state.monsters.find((m) => m.id === monsterId);
  if (!monster || monster.hp === 0) return null;
  const attacksToKill = Math.ceil(monster.hp / character.stats.attackDamage);
  const count = Math.min(attacksToKill, character.stats.actions);
  return Array.from({ length: count }, () => ({ type: "attack", monsterId }) as const);
}

/**
 * One action of a character that isn't on the map yet: it is placed, on its
 * planned start hex if that is still possible, and otherwise on the first
 * free one. An action that can't be carried out is cancelled, and the
 * character is placed automatically, as if it had no plan for this action.
 * Returns whether the character is on the map now.
 */
function enterTheRoom(
  state: GameState,
  characterId: CharacterId,
  action: PlannedAction | undefined,
  index: number,
  emit: Emit,
): boolean {
  const cancel = (reason: CancelReason) => emit({ type: "planCancelled", characterId, action: index, reason });
  if (action?.type === "place") {
    const problem = placementProblem(state, action.hex);
    if (problem === null) {
      emit({ type: "placed", characterId, position: action.hex });
      return true;
    }
    cancel(problem);
  } else if (action) {
    cancel("not placed");
  }

  const free = state.map.startHexes.find((h) => isFree(state, h));
  emit(free ? { type: "placed", characterId, position: free } : { type: "notPlaced", characterId });
  return free !== undefined;
}

function placementProblem(state: GameState, h: Hex): CancelReason | null {
  if (!isStartHex(state.map, h)) return "not a start hex";
  if (!isFree(state, h)) return "hex taken";
  return null;
}

/**
 * One action of a character that is on the map. `state` is the state now;
 * `turnStart` the state at the start of the turn, for the cooldowns.
 */
function carryOutAction(
  state: GameState,
  turnStart: GameState,
  characterId: CharacterId,
  position: Hex,
  action: PlannedAction,
  index: number,
  emit: Emit,
) {
  const cancel = (reason: CancelReason) => emit({ type: "planCancelled", characterId, action: index, reason });
  const actor = { kind: "character", id: characterId } as const;

  switch (action.type) {
    case "place":
      return cancel("already placed");

    case "move":
      // Every character moves 1 hex for now. Once the movement stat can be
      // higher, this needs a path instead of a single neighbour.
      if (!areNeighbours(position, action.to)) return cancel("not a neighbour");
      if (!isOnMap(state.map, action.to)) return cancel("not on the map");
      if (isClosedDoor(state, action.to)) return cancel("door closed");
      if (!isFree(state, action.to)) return cancel("hex taken");
      return emit({ type: "moved", actor, from: position, to: action.to });

    case "attack":
    case "heavyStrike": {
      const character = state.characters.find((c) => c.id === characterId)!;
      const ability = action.type === "heavyStrike" ? action.type : undefined;
      if (ability !== undefined) {
        if (!character.abilities.includes(ability)) return cancel("no ability");
        // On cooldown at the start of the turn, or already used in it.
        const atStart = turnStart.characters.find((c) => c.id === characterId)!;
        if ((atStart.cooldowns[ability] ?? 0) > 0 || (character.cooldowns[ability] ?? 0) > 0) {
          return cancel("not ready");
        }
      }
      const monster = state.monsters.find((m) => m.id === action.monsterId);
      // A cancelled heavy strike wasn't carried out, so its cooldown doesn't start.
      if (!monster || monster.hp === 0 || !areNeighbours(position, monster.position)) {
        return cancel("target gone");
      }
      const damage = character.stats.attackDamage * (ability === "heavyStrike" ? HEAVY_STRIKE_DAMAGE_MULTIPLIER : 1);
      const target = { kind: "monster", id: monster.id } as const;
      emit({ type: "attacked", attacker: actor, target, damage, ...(ability && { ability }) });
      if (ability !== undefined) {
        emit({ type: "cooldownStarted", characterId, ability, turns: ABILITIES[ability].cooldown });
      }
      if (monster.hp - damage <= 0) {
        emit({ type: "died", who: target });
        gainXp(state, monster, emit);
      } else if (monster.asleep) {
        // Being attacked wakes any monster (design.md, Guards and alert range).
        emit({ type: "monstersWoke", monsterIds: [monster.id] });
      }
      return;
    }

    case "openDoor": {
      if (!areNeighbours(position, action.door)) return cancel("not a neighbour");
      // Already opened, for example by another character earlier in the cycle.
      if (!isClosedDoor(state, action.door)) return cancel("no closed door");
      emit({ type: "doorOpened", characterId, position: action.door });
      wakeRoom(state, action.door, emit);
      return;
    }
  }
}

/**
 * A door was just opened (`state` is from before that): every sleeping
 * monster in the room the door now opens onto wakes up. That room is
 * worked out with the door open, so it includes the rooms on both sides.
 * Monsters on guard ignore doors: they wait for a character to come close.
 */
function wakeRoom(state: GameState, door: Hex, emit: Emit) {
  const closedDoors = state.closedDoors.filter((d) => hexKey(d) !== hexKey(door));
  const room = roomAround(state.map, closedDoors, door);
  const monsterIds = state.monsters
    .filter((m) => m.asleep && m.hp > 0 && room.has(hexKey(m.position)))
    .filter((m) => MONSTER_TYPES[m.type].alertRange === undefined)
    .map((m) => m.id);
  if (monsterIds.length > 0) emit({ type: "monstersWoke", monsterIds });
}

/**
 * The start of the turn of a monster that is asleep: if its type has an
 * alert range and a character on the map is within that range, in a straight
 * line (walls, pillars and closed doors don't matter), it wakes up
 * (design.md, Guards and alert range).
 */
function checkAlert(state: GameState, monsterId: MonsterId, emit: Emit) {
  const monster = state.monsters.find((m) => m.id === monsterId)!;
  const range = MONSTER_TYPES[monster.type].alertRange;
  if (monster.hp === 0 || range === undefined) return;
  const seen = state.characters.some(
    (c) => c.hp > 0 && c.position !== null && distance(c.position, monster.position) <= range,
  );
  if (seen) emit({ type: "monstersWoke", monsterIds: [monsterId] });
}

/**
 * One action of a monster. It decides anew for every action, so it can for
 * example move next to its target and then attack it. Returns `false` when it
 * waits.
 */
function monsterAction(state: GameState, monsterId: MonsterId, emit: Emit): boolean {
  const monster = state.monsters.find((m) => m.id === monsterId)!;
  const actor = { kind: "monster", id: monsterId } as const;
  const action = decideMonsterAction(state, monsterId);

  switch (action.type) {
    case "wait":
      return false;
    case "move":
      emit({ type: "moved", actor, from: monster.position, to: action.to });
      return true;
    case "attack": {
      const damage = monsterStats(monster.type, state.difficulty).attackDamage;
      const target = { kind: "character", id: action.target } as const;
      emit({ type: "attacked", attacker: actor, target, damage });
      const hp = state.characters.find((c) => c.id === action.target)!.hp;
      if (hp - damage <= 0) emit({ type: "died", who: target });
      return true;
    }
  }
}

/**
 * A monster died: every character in the game gains its XP, alive or dead,
 * placed or not, but never more than its max level needs (design.md,
 * Rewards). The full XP is the type's, times the difficulty's multiplier;
 * each character gets less of it the more often it killed this monster
 * before (design.md, Diminishing returns). Only characters that gain
 * something are in the event.
 */
function gainXp(state: GameState, monster: MonsterState, emit: Emit) {
  const fullXp = monsterXp(monster.type, state.difficulty);
  const gains = state.characters
    .map((c) => {
      const xp = xpAfterKills(fullXp, c.earlierKills[monster.id] ?? 0);
      return { characterId: c.id, xp: Math.min(xp, c.maxXpGain - c.xpGained) };
    })
    .filter((g) => g.xp > 0);
  if (gains.length > 0) emit({ type: "xpGained", gains });
}

type Emit = (event: GameEvent) => void;
