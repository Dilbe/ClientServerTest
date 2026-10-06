// The state of a running game, as the rules see it. Plain data only: no
// methods, no timers, no network (`isFree` below is a plain function that
// reads it). The game manager on the server keeps one
// of these per running game; the client gets a copy to draw and to preview.
//
// Turn timing (when the next turn fires) is not part of this: that belongs to
// the game manager (architecture.md, Turn timing).

import type { DifficultyId } from "./difficulties.ts";
import type { DungeonMap } from "./dungeon-map.ts";
import { hexEquals, hexKey, type Hex } from "./hex.ts";
import type { MonsterTypeId, Stats } from "./stats.ts";

/**
 * A character's number within its game: 1, 2, 3, ... The rules never see
 * database or account ids; the game manager on the server keeps the link
 * (architecture.md, Characters).
 */
export type CharacterId = number;
/** A monster's number within its game: 0, 1, 2, ... in the order of the map's monster list. */
export type MonsterId = number;

export interface CharacterState {
  id: CharacterId;
  /** Copied from the character record when the game starts. */
  stats: Stats;
  /** 0 means dead. */
  hp: number;
  /** `null` while the character is not on the map yet (it hasn't been placed). */
  position: Hex | null;
  /**
   * The XP gained in this game so far. It is written to the character
   * record when the game ends, won or lost (design.md, Rewards).
   */
  xpGained: number;
  /**
   * The most XP the character can gain in this game: what its max level
   * needs, minus the XP it had at the start. Copied from the record when
   * the game starts; XP beyond it is lost.
   */
  maxXpGain: number;
  /**
   * How often the character had killed each monster of this dungeon, on
   * this difficulty, before the game: by monster id (the monster's place in
   * the map's list). Copied from the record when the game starts; a monster
   * gives less XP the more often it was killed (design.md, Diminishing
   * returns). A missing entry means no kills.
   */
  earlierKills: number[];
}

export interface MonsterState {
  id: MonsterId;
  type: MonsterTypeId;
  /** 0 means dead. */
  hp: number;
  position: Hex;
  /**
   * It skips its turns. Either it is in a room behind a closed door, until a
   * door into its room is opened (design.md, Doors and sleeping rooms), or
   * its type has an alert range and it is on guard, until a character comes
   * within that range or attacks it (design.md, Guards and alert range).
   * Once awake, it stays awake.
   */
  asleep: boolean;
}

/**
 * One player turn on the initiative track: a character, followed by the
 * monsters linked to it, which act directly after it (design.md, Turns).
 */
export interface TrackSlot {
  characterId: CharacterId;
  /** In the order they act. */
  monsterIds: MonsterId[];
}

export interface GameState {
  map: DungeonMap;
  /** Makes the monsters stronger and worth more XP (design.md, Difficulties). */
  difficulty: DifficultyId;
  characters: CharacterState[];
  monsters: MonsterState[];
  /** The initiative track, in turn order. */
  track: TrackSlot[];
  /** The map's doors that are still closed. A door never closes again once opened. */
  closedDoors: Hex[];
}

/** Only one character can stand on a hex. The dead don't take up room. */
export function isFree(state: GameState, h: Hex): boolean {
  return (
    !state.characters.some((c) => c.hp > 0 && c.position !== null && hexEquals(c.position, h)) &&
    !state.monsters.some((m) => m.hp > 0 && hexEquals(m.position, h))
  );
}

/** Whether `h` is a closed door: it blocks movement, like a wall. */
export function isClosedDoor(state: GameState, h: Hex): boolean {
  const key = hexKey(h);
  return state.closedDoors.some((d) => hexKey(d) === key);
}
