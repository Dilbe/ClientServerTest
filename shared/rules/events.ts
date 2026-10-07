// What happened during a turn, as data. The game manager writes these to the
// event store and sends them to the clients (architecture.md, Event store).
//
// Events are *results*, not inputs: "character 7 moved to 2,1", not "character
// 7 planned to move". `applyEvent` changes a state by one event without
// running any rules, so a stored game can be rebuilt after a restart even if
// the rules have changed since. `resolveTurn` builds its new state the same
// way, so the state in memory and the state rebuilt from events can't drift
// apart.

import type { AbilityId } from "./abilities.ts";
import type { CharacterId, GameState, MonsterId } from "./game-state.ts";
import { hexEquals, type Hex } from "./hex.ts";
import { removeCharacterFromTrack, removeMonsterFromTrack } from "./track.ts";

/** Who did something, or had something done to them. */
export type Actor = { kind: "character"; id: CharacterId } | { kind: "monster"; id: MonsterId };

/** Why a planned action couldn't be carried out. */
export type CancelReason =
  | "already placed" // a place plan for a character that is on the map
  | "not placed" // a move or attack plan for a character that isn't on the map yet
  | "not a start hex"
  | "hex taken"
  | "not a neighbour"
  | "not on the map"
  | "door closed" // a move onto a closed door
  | "no closed door" // an open-door plan for a hex that isn't a closed door (any more)
  | "target gone" // the target died or isn't adjacent any more
  | "no ability" // an ability the character doesn't have
  | "not ready"; // an ability on cooldown, or already used in this plan

export type GameEvent =
  | { type: "placed"; characterId: CharacterId; position: Hex }
  /** No start hex was free: the character stays off the map and tries again next turn. */
  | { type: "notPlaced"; characterId: CharacterId }
  | { type: "moved"; actor: Actor; from: Hex; to: Hex }
  /** `ability` is set when a character attacked with an ability, such as heavy strike. */
  | { type: "attacked"; attacker: Actor; target: Actor; damage: number; ability?: AbilityId }
  /** Follows an attack that brought the target to 0 hit points. */
  | { type: "died"; who: Actor }
  /**
   * Follows a monster's death: what each character gained from it (design.md,
   * Rewards). Characters that gained nothing (at their max level) are left out.
   */
  | { type: "xpGained"; gains: { characterId: CharacterId; xp: number }[] }
  /** A character opened the door on `position` (design.md, Doors and sleeping rooms). */
  | { type: "doorOpened"; characterId: CharacterId; position: Hex }
  /**
   * Sleeping monsters woke up: after a `doorOpened`, the ones in the room
   * behind the door; after an `attacked`, the monster that was attacked; or,
   * at the start of its turn, a monster on guard that a character came close
   * to (design.md, Guards and alert range).
   */
  | { type: "monstersWoke"; monsterIds: MonsterId[] }
  /**
   * A character used an ability: it can't use it again on its next `turns`
   * turns (design.md, Abilities). Only for an ability that was carried out.
   */
  | { type: "cooldownStarted"; characterId: CharacterId; ability: AbilityId; turns: number }
  /**
   * The first event of a turn of a character with an ability on cooldown:
   * every cooldown it has counts down by one. The ability can't be used in
   * this turn yet, even when its cooldown is down to 0 now.
   */
  | { type: "cooldownsAdvanced"; characterId: CharacterId }
  /** `action` is the index of the cancelled action in the character's plan: 0 for the first. */
  | { type: "planCancelled"; characterId: CharacterId; action: number; reason: CancelReason }
  | { type: "gameEnded"; result: "won" | "lost" };

/** Returns a new state with one event applied. The given state isn't changed. */
export function applyEvent(state: GameState, event: GameEvent): GameState {
  switch (event.type) {
    case "placed":
      return updateCharacter(state, event.characterId, { position: event.position });
    case "moved":
      return event.actor.kind === "character"
        ? updateCharacter(state, event.actor.id, { position: event.to })
        : updateMonster(state, event.actor.id, { position: event.to });
    case "attacked": {
      const target = event.target;
      if (target.kind === "character") {
        const hp = findCharacter(state, target.id).hp;
        return updateCharacter(state, target.id, { hp: Math.max(0, hp - event.damage) });
      }
      const hp = findMonster(state, target.id).hp;
      return updateMonster(state, target.id, { hp: Math.max(0, hp - event.damage) });
    }
    case "died":
      return {
        ...state,
        track:
          event.who.kind === "character"
            ? removeCharacterFromTrack(state.track, event.who.id)
            : removeMonsterFromTrack(state.track, event.who.id),
      };
    case "xpGained":
      for (const gain of event.gains) findCharacter(state, gain.characterId);
      return {
        ...state,
        characters: state.characters.map((c) => {
          const gain = event.gains.find((g) => g.characterId === c.id);
          return gain ? { ...c, xpGained: c.xpGained + gain.xp } : c;
        }),
      };
    case "doorOpened":
      findCharacter(state, event.characterId);
      return { ...state, closedDoors: state.closedDoors.filter((d) => !hexEquals(d, event.position)) };
    case "monstersWoke":
      for (const id of event.monsterIds) findMonster(state, id);
      return {
        ...state,
        monsters: state.monsters.map((m) => (event.monsterIds.includes(m.id) ? { ...m, asleep: false } : m)),
      };
    case "cooldownStarted": {
      const character = findCharacter(state, event.characterId);
      return updateCharacter(state, event.characterId, {
        cooldowns: { ...character.cooldowns, [event.ability]: event.turns },
      });
    }
    case "cooldownsAdvanced": {
      const character = findCharacter(state, event.characterId);
      const cooldowns = Object.fromEntries(
        Object.entries(character.cooldowns).map(([ability, turns]) => [ability, Math.max(0, turns - 1)]),
      );
      return updateCharacter(state, event.characterId, { cooldowns });
    }
    case "notPlaced":
    case "planCancelled":
    case "gameEnded":
      // Worth showing and storing, but they don't change the state:
      // `gameResult` works the result out from the state itself.
      return state;
  }
}

export function applyEvents(state: GameState, events: readonly GameEvent[]): GameState {
  return events.reduce(applyEvent, state);
}

function findCharacter(state: GameState, id: CharacterId) {
  const character = state.characters.find((c) => c.id === id);
  if (!character) throw new Error(`Character ${id} isn't in this game.`);
  return character;
}

function findMonster(state: GameState, id: MonsterId) {
  const monster = state.monsters.find((m) => m.id === id);
  if (!monster) throw new Error(`Monster ${id} isn't in this game.`);
  return monster;
}

function updateCharacter(
  state: GameState,
  id: CharacterId,
  changes: Partial<Pick<GameState["characters"][number], "hp" | "position" | "cooldowns">>,
): GameState {
  findCharacter(state, id);
  return { ...state, characters: state.characters.map((c) => (c.id === id ? { ...c, ...changes } : c)) };
}

function updateMonster(
  state: GameState,
  id: MonsterId,
  changes: Partial<Pick<GameState["monsters"][number], "hp" | "position">>,
): GameState {
  findMonster(state, id);
  return { ...state, monsters: state.monsters.map((m) => (m.id === id ? { ...m, ...changes } : m)) };
}
