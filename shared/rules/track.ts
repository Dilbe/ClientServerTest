// The initiative track (design.md, Turns): who acts in which order, and how
// the track changes when a character dies.
//
// Setting up the track is the only randomness in the game. The random choices
// (the player order and which monster follows which player) are made outside
// the rules layer, by the game manager; this file only turns those choices
// into a track. That keeps the rules pure: same input, same output.

import type { CharacterId, MonsterId, TrackSlot } from "./game-state.ts";

/**
 * Builds the track from a player order and a monster assignment.
 *
 * - `characterOrder`: the characters in the order they act.
 * - `monsterAssignment`: for each monster, the character it follows. Monsters
 *   that follow the same character act in the order of their ids.
 *
 * Throws when the input breaks the rules: an unknown character, or monsters
 * that aren't spread as evenly as possible (design.md, Setting up the track).
 */
export function createTrack(
  characterOrder: readonly CharacterId[],
  monsterAssignment: ReadonlyMap<MonsterId, CharacterId>,
): TrackSlot[] {
  if (new Set(characterOrder).size !== characterOrder.length) {
    throw new Error("A character is on the track twice.");
  }
  const track: TrackSlot[] = characterOrder.map((characterId) => ({ characterId, monsterIds: [] }));

  const monsterIds = [...monsterAssignment.keys()].sort((a, b) => a - b);
  for (const monsterId of monsterIds) {
    const characterId = monsterAssignment.get(monsterId)!;
    const slot = track.find((s) => s.characterId === characterId);
    if (!slot) throw new Error(`Monster ${monsterId} follows character ${characterId}, who isn't on the track.`);
    slot.monsterIds.push(monsterId);
  }

  const counts = track.map((s) => s.monsterIds.length);
  if (counts.length > 0 && Math.max(...counts) - Math.min(...counts) > 1) {
    throw new Error("The monsters aren't spread over the characters as evenly as possible.");
  }
  return track;
}

/**
 * Removes a dead character from the track. Its monsters move to the character
 * before it (wrapping around), after the monsters that character already had,
 * so everyone still acts in the same order (design.md, When a player dies).
 * When the last character dies its monsters have nobody to follow and the
 * track is empty: the game is lost anyway.
 */
export function removeCharacterFromTrack(track: readonly TrackSlot[], characterId: CharacterId): TrackSlot[] {
  const index = track.findIndex((s) => s.characterId === characterId);
  if (index === -1) return [...track];
  const dead = track[index]!;
  const rest = track.filter((_, i) => i !== index);
  if (rest.length === 0) return [];

  // The slot before the dead one. For the first slot that is the last one.
  const beforeIndex = (index - 1 + rest.length) % rest.length;
  return rest.map((slot, i) =>
    i === beforeIndex ? { ...slot, monsterIds: [...slot.monsterIds, ...dead.monsterIds] } : slot,
  );
}

/** Removes a dead monster from the track. */
export function removeMonsterFromTrack(track: readonly TrackSlot[], monsterId: MonsterId): TrackSlot[] {
  return track.map((slot) => ({ ...slot, monsterIds: slot.monsterIds.filter((id) => id !== monsterId) }));
}
