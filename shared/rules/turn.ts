// Resolving a turn (design.md, Turns, Entering the room, Planning, Doors and
// sleeping rooms, and Guards and alert range).
//
// `resolveTurn` is the heart of the rules layer: the game manager calls it
// when a character's turn fires, stores the events it returns and sends them
// to the clients. It is a pure function: it reads the state and the plans and
// returns a new state, without changing its input, looking at the clock or
// using randomness. The client runs the same function for the preview.

import { isOnMap, isStartHex, roomAround, sleepsAtStart, type DungeonMap } from "./dungeon-map.ts";
import { applyEvent, type Actor, type CancelReason, type GameEvent } from "./events.ts";
import {
  isClosedDoor,
  isFree,
  monsterAt,
  type CharacterId,
  type CharacterState,
  type GameState,
  type MonsterId,
  type MonsterState,
  type TrackSlot,
} from "./game-state.ts";
import { areNeighbours, distance, hexEquals, hexKey, type Hex } from "./hex.ts";
import { decideMonsterAction } from "./monsters.ts";
import {
  ABILITIES,
  abilityCooldown,
  blockAttack,
  anyMonsterAwake,
  chargesLeft,
  fullCharges,
  usedCharges,
  blockCharges,
  regenHealing,
  regenTurns,
  HEAVY_STRIKE_DAMAGE_MULTIPLIER,
  type AbilityId,
  type AbilityUpgradeCounts,
} from "./abilities.ts";
import { chargeMaxDistance, chargePath, chargeProblem } from "./charge.ts";
import { leapMaxDistance, leapProblem } from "./leap.ts";
import { fireballArea, fireballProblem, monstersIn } from "./fireball.ts";
import { frostWaveLength, lineFrom } from "./frost-wave.ts";
import { maxXp } from "./advancement.ts";
import { CLASSES, meleeDamage, type ClassId } from "./classes.ts";
import { DEFAULT_DIFFICULTY, monsterStats, monsterXp, type DifficultyId } from "./difficulties.ts";
import { xpAfterKills } from "./diminishing-returns.ts";
import { MONSTER_TYPES, type Stats } from "./stats.ts";

/**
 * One action a player plans for their character. Attacks and the abilities
 * that hit one monster target a hex, not a monster: they hit whichever
 * monster stands on `target` when they are carried out, so a player can plan
 * an attack on a monster that isn't there yet (design.md, Planning).
 */
export type PlannedAction =
  | { type: "place"; hex: Hex }
  | { type: "move"; to: Hex }
  | { type: "attack"; target: Hex }
  /** An attack for double damage, with a cooldown (design.md, Heavy strike). */
  | { type: "heavyStrike"; target: Hex }
  /**
   * A run in a straight line towards a hex 2 to 4 hexes away, then an
   * attack on the monster on it, as one action, with a cooldown (design.md,
   * Charge).
   */
  | { type: "charge"; target: Hex }
  /**
   * An attack on every monster next to the character, as one action, with a
   * cooldown (design.md, Cleave). It needs no target: which monsters it hits
   * is decided when it is carried out.
   */
  | { type: "cleave" }
  /**
   * Stuns the monster on a hex next to the character: it skips its next
   * turn. No damage, one action, with a cooldown (design.md, Stun).
   */
  | { type: "stun"; target: Hex }
  /**
   * Taunts the monster on a hex next to the character: on its next turn it
   * goes after the character. No damage, one action, with a cooldown
   * (design.md, Taunt).
   */
  | { type: "taunt"; target: Hex }
  /**
   * Protects the ally on a hex next to the character until the start of its
   * next turn: attacks on the ally hit the character instead. One action,
   * with a cooldown (design.md, Protect).
   */
  | { type: "protect"; target: Hex }
  /**
   * Jumps to a free hex up to 4 hexes away, in line of sight, over whatever
   * is in between. One action, no damage, with a cooldown (design.md, Leap).
   */
  | { type: "leap"; target: Hex }
  /**
   * Hits every monster on a hex up to 4 hexes away, in line of sight, and on
   * the 6 hexes around it. One action, with charges (design.md, Fireball).
   */
  | { type: "fireball"; target: Hex }
  /**
   * Gives back 1 used charge of each spell with charges, while a monster is
   * awake. One action, with a cooldown (design.md, Recall).
   */
  | { type: "recall" }
  /**
   * A line of hexes in the direction of `target`, a hex next to the
   * character: every monster on it is hit and frozen. One action, with a
   * cooldown and charges (design.md, Frost wave).
   */
  | { type: "frostWave"; target: Hex }
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
  /** How often it upgraded its abilities (see CharacterState). Without them: never. */
  abilityUpgrades?: AbilityUpgradeCounts;
  /** Its class, for what the class does differently in a game (see CharacterState). Without it: an adventurer. */
  classId?: ClassId;
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
      maxXpGain: c.maxXpGain ?? maxXp("adventurer", 1),
      earlierKills: [...(c.earlierKills ?? [])],
      abilities: [...(c.abilities ?? [])],
      abilityUpgrades: structuredClone(c.abilityUpgrades ?? {}),
      cooldowns: {},
      ...(c.classId && CLASSES[c.classId].halfMeleeDamage && { halfMeleeDamage: true as const }),
      ...(c.abilities?.some((a) => ABILITIES[a].charges !== undefined) && {
        spellCharges: fullCharges(c.abilities, c.abilityUpgrades ?? {}),
      }),
      // Block starts full: monsters may attack before the character's first turn.
      ...(c.abilities?.includes("block") && { blockCharges: blockCharges(c.abilityUpgrades ?? {}) }),
    })),
    monsters: map.monsters.map((m, id) => ({
      id,
      type: m.type,
      hp: monsterStats(m.type, difficulty).hitPoints,
      position: m.position,
      asleep: MONSTER_TYPES[m.type].alertRange !== undefined || sleepsAtStart(map, m.position),
      stunned: false,
    })),
    track,
    closedDoors: [...map.doors],
  };
}

/**
 * Won when every monster is dead, lost when every character is dead or the
 * game was abandoned (see GameState), otherwise `null`. Every monster means every one: also the ones asleep
 * behind a door that was never opened.
 */
export function gameResult(state: GameState): "won" | "lost" | null {
  if (state.abandoned) return "lost";
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
  // A protect lasts until the start of the protector's next turn (design.md, Protect).
  const protectedAlly = state.characters.find((c) => c.protectedBy === characterId);
  if (protectedAlly) emit({ type: "protectEnded", characterId: protectedAlly.id });
  // Block charges are back to full; unused ones don't carry over (design.md, Block).
  if (character.abilities.includes("block")) {
    const charges = blockCharges(character.abilityUpgrades);
    if (character.blockCharges !== charges) emit({ type: "blockRefilled", characterId, charges });
  }
  // Regen heals at the start of the turn, never above the max hit points
  // (design.md, Regen). A turn at full hit points still counts.
  if ((character.regenTurns ?? 0) > 0 && character.hp > 0) {
    const healed = Math.min(regenHealing(character.abilityUpgrades), character.stats.hitPoints - character.hp);
    emit({ type: "regenerated", characterId, healed: Math.max(0, healed) });
  }
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
  // A stunned monster skips this turn, and isn't stunned after it.
  const monsterIds = state.track.find((s) => s.characterId === characterId)!.monsterIds;
  for (const monsterId of monsterIds) {
    if (gameResult(current) !== null) break;
    if (current.monsters.find((m) => m.id === monsterId)!.asleep) checkAlert(current, monsterId, emit);
    const monster = current.monsters.find((m) => m.id === monsterId)!;
    if (monster.hp === 0 || monster.asleep) continue;
    // A stunned monster that is also taunted or frozen just skips its turn:
    // that was the turn of the taunt and the freeze too (design.md, Taunt
    // and Frost wave).
    if (monster.stunned) {
      emit({ type: "turnSkipped", monsterId });
      continue;
    }
    for (let i = 0; i < monsterStats(monster.type, current.difficulty).actions; i++) {
      if (gameResult(current) !== null) break; // Nobody left to fight.
      // A monster that waits would wait again: nothing has changed.
      if (!monsterAction(current, monsterId, emit)) break;
    }
    // The taunt and the freeze last one turn of the monster.
    const after = current.monsters.find((m) => m.id === monsterId)!;
    if (after.tauntedBy !== undefined && after.hp > 0) emit({ type: "tauntEnded", monsterId });
    if (after.frozen && after.hp > 0) emit({ type: "thawed", monsterId });
  }

  const result = gameResult(current);
  if (result !== null) emit({ type: "gameEnded", result });
  return { newState: current, events };
}

/**
 * The plan a character starts its next turn with, after its turn resolved
 * with these events (design.md, Keeping a monster targeted): when the last
 * action it carried out was an attack on a monster that is still alive, as
 * many attacks on the hex it stands on as it takes to kill it, but no more
 * than its actions stat. Otherwise `null`: no plan. A heavy strike or a charge counts
 * as an attack here, but the follow-up plan only has normal attacks. After a
 * cleave, a fireball or a frost wave there is none: it has no single monster to keep targeting. A stun,
 * a taunt, a protect or a recall isn't an attack, so after one there is none either.
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
      (e.type === "stunned" && e.characterId === characterId) ||
      (e.type === "taunted" && e.characterId === characterId) ||
      (e.type === "protected" && e.characterId === characterId) ||
      (e.type === "chargesRecalled" && e.characterId === characterId) ||
      (e.type === "moved" && e.actor.kind === "character" && e.actor.id === characterId) ||
      (e.type === "placed" && e.characterId === characterId) ||
      (e.type === "doorOpened" && e.characterId === characterId),
  );
  if (lastAction?.type !== "attacked" || lastAction.target.kind !== "monster") return null;
  if (lastAction.ability === "cleave" || lastAction.ability === "fireball" || lastAction.ability === "frostWave") {
    return null;
  }

  const monsterId = lastAction.target.id;
  const monster = state.monsters.find((m) => m.id === monsterId);
  if (!monster || monster.hp === 0) return null;
  // Follow-up attacks are melee attacks: a caster's do half damage (design.md, The caster).
  const attacksToKill = Math.ceil(monster.hp / meleeDamage(character));
  const count = Math.min(attacksToKill, character.stats.actions);
  // Attacks target a hex: the one the monster stands on now, at the end of
  // the turn. If it moves away before the next turn, they are cancelled,
  // unless another monster has stepped onto the hex by then.
  return Array.from({ length: count }, () => ({ type: "attack", target: monster.position }) as const);
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
      const ability = action.type === "heavyStrike" ? action.type : undefined;
      const notReady = ability && abilityNotReady(state, turnStart, characterId, ability);
      if (notReady) return cancel(notReady);
      // A cancelled heavy strike wasn't carried out, so its cooldown doesn't start.
      if (!areNeighbours(position, action.target)) return cancel("not a neighbour");
      const monster = monsterAt(state, action.target);
      if (!monster) return cancel("target gone");
      const character = state.characters.find((c) => c.id === characterId)!;
      const damage = meleeDamage(character) * (ability === "heavyStrike" ? HEAVY_STRIKE_DAMAGE_MULTIPLIER : 1);
      return attackMonsters(state, characterId, [monster], damage, ability, emit);
    }

    case "charge": {
      const notReady = abilityNotReady(state, turnStart, characterId, "charge");
      if (notReady) return cancel(notReady);
      // All or nothing (design.md, Charge): a charge that can't reach its
      // monster isn't carried out at all, so its cooldown doesn't start.
      const character = state.characters.find((c) => c.id === characterId)!;
      const maxDistance = chargeMaxDistance(character.abilityUpgrades);
      const problem = chargeProblem(state, position, action.target, maxDistance);
      if (problem) return cancel(problem);
      const monster = monsterAt(state, action.target)!;
      const stop = chargePath(position, action.target, maxDistance)!.at(-1)!;
      emit({ type: "moved", actor, from: position, to: stop, ability: "charge" });
      // The run changes nothing about the monster or anyone's XP, so `state`
      // still says all the attack needs.
      return attackMonsters(state, characterId, [monster], meleeDamage(character), "charge", emit);
    }

    case "cleave": {
      const notReady = abilityNotReady(state, turnStart, characterId, "cleave");
      if (notReady) return cancel(notReady);
      // Every monster next to the character now (design.md, Cleave). With
      // none, it isn't carried out at all, so its cooldown doesn't start.
      const monsters = state.monsters.filter((m) => m.hp > 0 && areNeighbours(position, m.position));
      if (monsters.length === 0) return cancel("no monster adjacent");
      const character = state.characters.find((c) => c.id === characterId)!;
      return attackMonsters(state, characterId, monsters, meleeDamage(character), "cleave", emit);
    }

    case "stun": {
      const notReady = abilityNotReady(state, turnStart, characterId, "stun");
      if (notReady) return cancel(notReady);
      // A cancelled stun wasn't carried out, so its cooldown doesn't start.
      if (!areNeighbours(position, action.target)) return cancel("not a neighbour");
      const monster = monsterAt(state, action.target);
      if (!monster) return cancel("target gone");
      const character = state.characters.find((c) => c.id === characterId)!;
      emit({ type: "stunned", characterId, monsterId: monster.id });
      emit({ type: "cooldownStarted", characterId, ability: "stun", turns: abilityCooldown("stun", character.abilityUpgrades) });
      // Being stunned wakes a monster, like being attacked (design.md, Stun):
      // it skips its next turn as an awake monster, not one it would have
      // slept through anyway.
      if (monster.asleep) emit({ type: "monstersWoke", monsterIds: [monster.id] });
      return;
    }

    case "taunt": {
      const notReady = abilityNotReady(state, turnStart, characterId, "taunt");
      if (notReady) return cancel(notReady);
      // A cancelled taunt wasn't carried out, so its cooldown doesn't start.
      if (!areNeighbours(position, action.target)) return cancel("not a neighbour");
      const monster = monsterAt(state, action.target);
      if (!monster) return cancel("target gone");
      const character = state.characters.find((c) => c.id === characterId)!;
      emit({ type: "taunted", characterId, monsterId: monster.id });
      emit({ type: "cooldownStarted", characterId, ability: "taunt", turns: abilityCooldown("taunt", character.abilityUpgrades) });
      // A taunt wakes a monster, like an attack (design.md, Taunt).
      if (monster.asleep) emit({ type: "monstersWoke", monsterIds: [monster.id] });
      return;
    }

    case "leap": {
      const notReady = abilityNotReady(state, turnStart, characterId, "leap");
      if (notReady) return cancel(notReady);
      // All or nothing (design.md, Leap): a leap that can't land isn't
      // carried out at all, so its cooldown doesn't start.
      const character = state.characters.find((c) => c.id === characterId)!;
      const problem = leapProblem(state, position, action.target, leapMaxDistance(character.abilityUpgrades));
      if (problem) return cancel(problem);
      emit({ type: "moved", actor, from: position, to: action.target, ability: "leap" });
      emit({ type: "cooldownStarted", characterId, ability: "leap", turns: abilityCooldown("leap", character.abilityUpgrades) });
      return;
    }

    case "fireball": {
      const notReady = abilityNotReady(state, turnStart, characterId, "fireball");
      if (notReady) return cancel(notReady);
      // A cancelled fireball wasn't cast, so it uses no charge (design.md, Fireball).
      const problem = fireballProblem(state, position, action.target);
      if (problem) return cancel(problem);
      // Spells use the full attack damage, and never hurt characters.
      const character = state.characters.find((c) => c.id === characterId)!;
      const monsters = monstersIn(state, fireballArea(action.target));
      return attackMonsters(state, characterId, monsters, character.stats.attackDamage, "fireball", emit);
    }

    case "frostWave": {
      const notReady = abilityNotReady(state, turnStart, characterId, "frostWave");
      if (notReady) return cancel(notReady);
      if (!areNeighbours(position, action.target)) return cancel("not a neighbour");
      const character = state.characters.find((c) => c.id === characterId)!;
      const line = lineFrom(state, position, action.target, frostWaveLength(character.abilityUpgrades));
      const monsters = monstersIn(state, line);
      // A cancelled frost wave uses no charge and doesn't start the cooldown.
      if (monsters.length === 0) return cancel("no monster in area");
      const damage = character.stats.attackDamage;
      attackMonsters(state, characterId, monsters, damage, "frostWave", emit);
      // The ones that survive are frozen (design.md, Frost wave).
      const survivors = monsters.filter((m) => m.hp - damage > 0).map((m) => m.id);
      if (survivors.length > 0) emit({ type: "frozen", characterId, monsterIds: survivors });
      return;
    }

    case "recall": {
      const notReady = abilityNotReady(state, turnStart, characterId, "recall");
      if (notReady) return cancel(notReady);
      // A cancelled recall doesn't start its cooldown (design.md, Recall).
      if (!anyMonsterAwake(state)) return cancel("no monsters awake");
      const character = state.characters.find((c) => c.id === characterId)!;
      const abilities = usedCharges(character);
      if (abilities.length === 0) return cancel("no charges used");
      emit({ type: "chargesRecalled", characterId, abilities });
      return abilityUsed(state, characterId, "recall", emit);
    }

    case "protect": {
      const notReady = abilityNotReady(state, turnStart, characterId, "protect");
      if (notReady) return cancel(notReady);
      // A cancelled protect wasn't carried out, so its cooldown doesn't start.
      if (!areNeighbours(position, action.target)) return cancel("not a neighbour");
      // A living ally on the map: never the character itself, which isn't next to itself.
      const ally = state.characters.find((c) => c.hp > 0 && c.position !== null && hexEquals(c.position, action.target));
      if (!ally) return cancel("no ally");
      const character = state.characters.find((c) => c.id === characterId)!;
      emit({ type: "protected", characterId, allyId: ally.id });
      emit({ type: "cooldownStarted", characterId, ability: "protect", turns: abilityCooldown("protect", character.abilityUpgrades) });
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
 * Why a character can't use an ability now, or `undefined` when it can: it
 * doesn't have it, it is a spell without charges left, or it was on
 * cooldown at the start of the turn (`turnStart`), or it was already used in
 * this turn (`state`).
 */
function abilityNotReady(
  state: GameState,
  turnStart: GameState,
  characterId: CharacterId,
  ability: AbilityId,
): CancelReason | undefined {
  const character = state.characters.find((c) => c.id === characterId)!;
  if (!character.abilities.includes(ability)) return "no ability";
  if (ABILITIES[ability].charges !== undefined && chargesLeft(character, ability) === 0) return "no charges";
  const atStart = turnStart.characters.find((c) => c.id === characterId)!;
  if ((atStart.cooldowns[ability] ?? 0) > 0 || (character.cooldowns[ability] ?? 0) > 0) return "not ready";
  return undefined;
}

/**
 * A character attacks one or more monsters at the same time, each for
 * `damage`, with an ability or without: first every hit, then the ability's
 * cooldown or charge, and then for each monster its death and the XP for
 * it, or waking it up. Only a cleave and a fireball hit more than one
 * (design.md, Cleave and Fireball).
 */
function attackMonsters(
  state: GameState,
  characterId: CharacterId,
  monsters: readonly MonsterState[],
  damage: number,
  ability: AbilityId | undefined,
  emit: Emit,
) {
  // The XP of each kill depends on the XP gained before it (a character
  // gains no more than its max level needs), so this follows the events.
  let current = state;
  const emitHere = (event: GameEvent) => {
    emit(event);
    current = applyEvent(current, event);
  };
  const attacker = { kind: "character", id: characterId } as const;
  for (const monster of monsters) {
    const target = { kind: "monster", id: monster.id } as const;
    emitHere({ type: "attacked", attacker, target, damage, ...(ability && { ability }) });
  }
  if (ability !== undefined) abilityUsed(state, characterId, ability, emitHere);
  for (const monster of monsters.filter((m) => m.hp - damage <= 0)) {
    emitHere({ type: "died", who: { kind: "monster", id: monster.id } });
    gainXp(current, monster, emitHere);
  }
  // Being attacked wakes any monster (design.md, Guards and alert range).
  const woken = monsters.filter((m) => m.asleep && m.hp - damage > 0).map((m) => m.id);
  if (woken.length > 0) emitHere({ type: "monstersWoke", monsterIds: woken });
}

/**
 * A character carried out an ability: its cooldown starts, if it has one,
 * and a spell with charges uses one (design.md, Spells).
 */
function abilityUsed(state: GameState, characterId: CharacterId, ability: AbilityId, emit: Emit) {
  const character = state.characters.find((c) => c.id === characterId)!;
  if (ABILITIES[ability].cooldown > 0) {
    emit({ type: "cooldownStarted", characterId, ability, turns: abilityCooldown(ability, character.abilityUpgrades) });
  }
  if (ABILITIES[ability].charges !== undefined) emit({ type: "chargeUsed", characterId, ability });
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
      hitCharacter(state, actor, action.target, monsterStats(monster.type, state.difficulty).attackDamage, emit);
      return true;
    }
  }
}

/**
 * An attack on a character, for `damage` before its block takes damage off
 * (design.md, Block), and its death if it brings the character to 0 hit
 * points. Characters are only ever attacked by monsters.
 *
 * An attack on a protected ally hits its protector instead, as long as the
 * protector is alive and next to the ally now (design.md, Protect).
 */
function hitCharacter(state: GameState, attacker: Actor, aimedAt: CharacterId, damage: number, emit: Emit) {
  const protector = protectorOf(state, aimedAt);
  const characterId = protector?.id ?? aimedAt;
  const character = state.characters.find((c) => c.id === characterId)!;
  const hit = blockAttack(character, damage);
  const target = { kind: "character", id: characterId } as const;
  emit({
    type: "attacked",
    attacker,
    target,
    damage: hit.damage,
    ...(hit.blocked > 0 && { blocked: hit.blocked }),
    ...(protector && { protecting: aimedAt }),
  });
  if (character.hp - hit.damage <= 0) emit({ type: "died", who: target });
  // Any attack starts regen, also one that was blocked completely; another
  // one while it runs sets it back to the full duration (design.md, Regen).
  else if (character.abilities.includes("regen")) {
    emit({ type: "regenStarted", characterId, turns: regenTurns(character.abilityUpgrades) });
  }
}

/** The living character next to `characterId` that protects it now, if any (design.md, Protect). */
export function protectorOf(state: GameState, characterId: CharacterId): CharacterState | undefined {
  const ally = state.characters.find((c) => c.id === characterId)!;
  if (ally.protectedBy === undefined || ally.position === null) return undefined;
  const protector = state.characters.find((c) => c.id === ally.protectedBy);
  if (!protector || protector.hp === 0 || protector.position === null) return undefined;
  return areNeighbours(protector.position, ally.position) ? protector : undefined;
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
