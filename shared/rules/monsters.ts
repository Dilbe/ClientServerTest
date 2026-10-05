// Monster behaviour (design.md, Monsters): what a monster does on its turn.
//
// Monsters follow fixed rules so players can predict them. Every decision
// here is a pure function of the state, which is what lets the client show
// the same decisions in its preview that the server will make.
//
// For each action it has on its turn (its actions stat), a monster first
// chooses a target. If the target is adjacent it attacks; otherwise it moves
// 1 hex towards it. It chooses again for every action, in the state as the
// previous action left it.
//
// Hexes taken by other characters or monsters block the way, just like
// walls: a monster can't walk through them. Start hexes block monsters too:
// they never step on one, so only characters can block a start hex. A
// monster can still attack a character on a start hex from next to it.
// Closed doors are walls to monsters: they never open doors.

import { isOnMap, isStartHex } from "./dungeon-map.ts";
import { isClosedDoor, isFree, type CharacterId, type CharacterState, type GameState, type MonsterId, type MonsterState } from "./game-state.ts";
import { areNeighbours, distance, hexKey, neighbours, stepsFrom, type Hex } from "./hex.ts";
import { MONSTER_TYPES, type TargetRuleId } from "./stats.ts";

export type MonsterAction =
  | { type: "attack"; target: CharacterId }
  | { type: "move"; to: Hex; target: CharacterId }
  /** No target, or no free hex brings the monster closer to it. */
  | { type: "wait" };

/** What the monster does with its next action. */
export function decideMonsterAction(state: GameState, monsterId: MonsterId): MonsterAction {
  const monster = findMonster(state, monsterId);
  const target = chooseTarget(state, monsterId);
  if (target === null) return { type: "wait" };
  const targetPosition = target.position!;
  if (areNeighbours(monster.position, targetPosition)) return { type: "attack", target: target.id };

  const to = chooseStep(state, monster.position, targetPosition);
  return to === null ? { type: "wait" } : { type: "move", to, target: target.id };
}

/**
 * The player the monster goes after, or `null` when no character is on the
 * map. The monster type's target rules are applied in order until one player
 * is left. The players start out in track order after the monster, so if the
 * rules still leave a tie, the first player after the monster wins.
 */
export function chooseTarget(state: GameState, monsterId: MonsterId): CharacterState | null {
  const monster = findMonster(state, monsterId);
  let candidates = playersInTrackOrderAfter(state, monsterId).filter((c) => c.hp > 0 && c.position !== null);
  if (candidates.length === 0) return null;

  // How far each player is: in turns if the monster can reach anyone, and
  // otherwise in hexes in a straight line, ignoring obstacles.
  const reach = turnsToReach(state, monster);
  const anyReachable = candidates.some((c) => reach(c) !== null);
  const closeness = (c: CharacterState) =>
    anyReachable ? (reach(c) ?? Infinity) : distance(monster.position, c.position!);

  const rules: Record<TargetRuleId, (players: CharacterState[]) => CharacterState[]> = {
    closest: (players) => keepLowest(players, closeness),
    fewestHitPoints: (players) => keepLowest(players, (c) => c.hp),
    nextOnTrack: (players) => players.slice(0, 1),
  };
  for (const rule of MONSTER_TYPES[monster.type].targetRules) {
    if (candidates.length === 1) break;
    candidates = rules[rule](candidates);
  }
  return candidates[0]!;
}

/**
 * The hex the monster moves to, to get closer to `target`, or `null` when no
 * free hex brings it closer. Of several equally good hexes, the first in
 * clockwise order starting at straight up wins (design.md, Choosing a route).
 */
function chooseStep(state: GameState, from: Hex, target: Hex): Hex | null {
  const options = neighbours(from).filter((h) => canEnter(state, h));

  // Search outwards from the target: that gives, in one go, the number of
  // steps from each of the monster's neighbours to the target.
  const stepsToTarget = stepsFrom(target, (h) => canEnter(state, h));
  const byPath = (h: Hex) => stepsToTarget.get(hexKey(h)) ?? Infinity;
  if (options.some((h) => byPath(h) !== Infinity)) return firstLowest(options, byPath);

  // The target can't be reached: get closer in a straight line, if possible.
  const best = firstLowest(options, (h) => distance(h, target));
  return best !== null && distance(best, target) < distance(from, target) ? best : null;
}

/**
 * A function that gives the number of turns the monster needs to get next to
 * a player (0 if it already is), or `null` if every path is blocked.
 */
function turnsToReach(state: GameState, monster: MonsterState): (c: CharacterState) => number | null {
  const steps = stepsFrom(monster.position, (h) => canEnter(state, h));
  return (c) => {
    // The monster doesn't need the player's hex, just a hex next to it.
    const counts = neighbours(c.position!)
      .map((h) => steps.get(hexKey(h)))
      .filter((n) => n !== undefined);
    return counts.length === 0 ? null : Math.min(...counts);
  };
}

/**
 * The players on the track, starting with the one after the monster's slot on the
 * track and ending with the player the monster follows.
 */
function playersInTrackOrderAfter(state: GameState, monsterId: MonsterId): CharacterState[] {
  const index = state.track.findIndex((s) => s.monsterIds.includes(monsterId));
  const slots = [...state.track.slice(index + 1), ...state.track.slice(0, index + 1)];
  return slots.map((s) => state.characters.find((c) => c.id === s.characterId)!);
}

/** Whether the monster may step on `h`: a free hex of the map that isn't a start hex or a closed door. */
function canEnter(state: GameState, h: Hex): boolean {
  return isOnMap(state.map, h) && !isStartHex(state.map, h) && !isClosedDoor(state, h) && isFree(state, h);
}

/** Every item with the lowest score, in their original order. */
function keepLowest<T>(items: T[], score: (item: T) => number): T[] {
  const lowest = Math.min(...items.map(score));
  return items.filter((item) => score(item) === lowest);
}

/** The first item with the lowest score, or `null` if there are none. */
function firstLowest<T>(items: T[], score: (item: T) => number): T | null {
  return keepLowest(items, score)[0] ?? null;
}

function findMonster(state: GameState, id: MonsterId): MonsterState {
  const monster = state.monsters.find((m) => m.id === id);
  if (!monster) throw new Error(`Monster ${id} isn't in this game.`);
  return monster;
}
