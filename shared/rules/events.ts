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
import { removeCharacterFromTrack, removeMonsterFromTrack, returnCharacterToTrack } from "./track.ts";

/** Who did something, or had something done to them. */
export type Actor = { kind: "character"; id: CharacterId } | { kind: "monster"; id: MonsterId };

/** Why a planned action couldn't be carried out. */
export type CancelReason =
  | "already placed" // a place plan for a character that is on the map
  | "not placed" // a move or attack plan for a character that isn't on the map yet
  | "not a start hex"
  | "hex taken" // a placement, move or leap onto a hex where someone stands
  | "not a neighbour" // a move, attack, stun or door opening on a hex that isn't next to the character
  | "not on the map"
  | "door closed" // a move or leap onto a closed door
  | "no closed door" // an open-door plan for a hex that isn't a closed door (any more)
  | "target gone" // no living monster on the hex an attack, charge or stun targets (any more)
  | "no monster adjacent" // a cleave with no monster next to the character
  | "not in line" // a charge at a monster that isn't in a straight line 2 to 4 hexes away
  | "path blocked" // a charge with something in the way, or a move with no free path short enough
  | "no ally" // a protect on a hex without a living character, or a heal on a character that is dead or off the map
  | "full hit points" // a healing touch on a character at its max hit points
  | "nobody hurt" // a group heal while every living character on the map is at its max hit points
  | "not dead" // a revive of a character that is alive (again)
  | "out of range" // a move of more than 1 hex, leap, teleport, fireball or meteor further than the character can reach
  | "closed room" // a teleport into a room behind a closed door
  | "created wall" // a move, leap or teleport onto a created wall
  | "no free hex" // a create wall where every hex of the line is taken
  | "out of sight" // a leap, fireball or meteor to a hex the character can't see
  | "no monster in area" // a fireball, frost wave or meteor with no monster in it
  | "no charges" // a spell with no charges left
  | "no monsters awake" // a recall while every monster is asleep, on guard or dead
  | "no charges used" // a recall while every spell has all its charges
  | "no ability" // an ability the character doesn't have
  | "not ready"; // an ability on cooldown, or already used in this plan

export type GameEvent =
  | { type: "placed"; characterId: CharacterId; position: Hex }
  /** No start hex was free: the character stays off the map and tries again next turn. */
  | { type: "notPlaced"; characterId: CharacterId }
  /**
   * One hex: a move of more than 1 hex is one of these per hex (design.md,
   * Moving more than 1 hex). `ability` is set for the run of a charge, which can go
   * further (design.md, Charge), with the attack following as its own
   * event; for a leap, a jump over whatever is in between (design.md, Leap);
   * and for a teleport, without passing the hexes in between at all
   * (design.md, Teleport).
   */
  | { type: "moved"; actor: Actor; from: Hex; to: Hex; ability?: AbilityId }
  /**
   * `ability` is set when a character attacked with an ability, such as heavy
   * strike or charge. A cleave or a fireball is one of these for every
   * monster it hits, right after each other: the hits land at the same time. `damage` is what
   * the target took; `blocked` is set when a character's block took damage
   * off, which used one of its charges (design.md, Block). `protecting` is
   * set when the attack was aimed at that character and the target, its
   * protector, took it instead (design.md, Protect). `absorbed` is set when
   * the target's ward took damage, after its block, before its hit points
   * (design.md, Ward).
   */
  | {
      type: "attacked";
      attacker: Actor;
      target: Actor;
      damage: number;
      ability?: AbilityId;
      blocked?: number;
      protecting?: CharacterId;
      absorbed?: number;
    }
  /**
   * A character with regen was attacked and lived: it heals on its next
   * `turns` turns, counting from now, also when regen was already running
   * (design.md, Regen).
   */
  | { type: "regenStarted"; characterId: CharacterId; turns: number }
  /**
   * The start of a turn of a character whose regen runs: it healed `healed`
   * hit points (0 at its max hit points), and regen has a turn less to go.
   */
  | { type: "regenerated"; characterId: CharacterId; healed: number }
  /**
   * A character's heal (design.md, The healer) restored `healed` hit points
   * of `targetId`, never above its max: the healer itself or a character
   * next to it. `ability` is the heal. A group heal is one of these for
   * every character it heals, right after each other (design.md, Group heal).
   */
  | { type: "healed"; characterId: CharacterId; targetId: CharacterId; healed: number; ability: AbilityId }
  /**
   * A character's renew (design.md, Renew): `targetId` heals at the start of
   * each of its next `turns` turns. A renew that already ran starts anew.
   */
  | { type: "renewStarted"; characterId: CharacterId; targetId: CharacterId; turns: number }
  /**
   * The start of a turn of a character that a renew runs on: it healed
   * `healed` hit points (0 at its max hit points), and renew has a turn less to go.
   */
  | { type: "renewHealed"; characterId: CharacterId; healed: number }
  /**
   * A character's ward (design.md, Ward): `targetId` has a shield of
   * `shield` until the start of the healer's next turn, in place of any
   * ward it had.
   */
  | { type: "warded"; characterId: CharacterId; targetId: CharacterId; shield: number }
  /** The healer's next turn started (or the healer died): `characterId` isn't warded any more. */
  | { type: "wardEnded"; characterId: CharacterId }
  /**
   * A character's revive (design.md, Revive): the dead `targetId` is back on
   * `position`, with `hp` hit points, and back in its old slot on the track.
   */
  | { type: "revived"; characterId: CharacterId; targetId: CharacterId; position: Hex; hp: number }
  /** A character's block charges are back to `charges` at the start of its turn (design.md, Block). */
  | { type: "blockRefilled"; characterId: CharacterId; charges: number }
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
   * A character cast a spell with charges (design.md, Spells): it has one
   * charge less of it. Only for a spell that was carried out.
   */
  | { type: "chargeUsed"; characterId: CharacterId; ability: AbilityId }
  /**
   * A character's recall gave back one charge of each of `abilities`, the
   * spells it had used charges of (design.md, Recall).
   */
  | { type: "chargesRecalled"; characterId: CharacterId; abilities: AbilityId[] }
  /**
   * The first event of a turn of a character with an ability on cooldown:
   * every cooldown it has counts down by one. The ability can't be used in
   * this turn yet, even when its cooldown is down to 0 now.
   */
  | { type: "cooldownsAdvanced"; characterId: CharacterId }
  /**
   * A character stunned a monster next to it (design.md, Stun): the monster
   * skips its next turn. A monster that was asleep wakes up first, in a
   * `monstersWoke` that follows.
   */
  | { type: "stunned"; characterId: CharacterId; monsterId: MonsterId }
  /**
   * A stunned monster's turn came: it did nothing, and isn't stunned any
   * more. A taunt or a freeze on it is used up as well: this was its next turn.
   */
  | { type: "turnSkipped"; monsterId: MonsterId }
  /**
   * A character taunted a monster next to it (design.md, Taunt): on its next
   * turn it goes after that character. The latest taunt counts. A monster
   * that was asleep wakes up first, in a `monstersWoke` that follows.
   */
  | { type: "taunted"; characterId: CharacterId; monsterId: MonsterId }
  /**
   * A character's frost wave froze these monsters (design.md, Frost wave):
   * on their next turn they can't move. Freezes don't stack.
   */
  | { type: "frozen"; characterId: CharacterId; monsterIds: MonsterId[] }
  /** A frozen monster's turn is over: it can move again. */
  | { type: "thawed"; monsterId: MonsterId }
  /**
   * A character created a wall on `hexes` (design.md, Create wall). It goes
   * at the start of the character's `turns`-th turn from now.
   */
  | { type: "wallCreated"; characterId: CharacterId; hexes: Hex[]; turns: number }
  /** The start of a turn of a character with a created wall: the wall has a turn less to go. */
  | { type: "wallCountedDown"; characterId: CharacterId }
  /** A character's created wall went: at the start of its last turn, or when the character died. */
  | { type: "wallRemoved"; characterId: CharacterId }
  /** A taunted monster's turn is over: it uses its usual rules again. */
  | { type: "tauntEnded"; monsterId: MonsterId }
  /**
   * A character protects the ally `allyId` next to it (design.md, Protect).
   * It protects one ally at a time, and the latest protect of an ally counts.
   */
  | { type: "protected"; characterId: CharacterId; allyId: CharacterId }
  /** The protector's next turn started: `characterId` isn't protected any more. */
  | { type: "protectEnded"; characterId: CharacterId }
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
        const { hp, blockCharges, ward } = findCharacter(state, target.id);
        const used = event.blocked ? { blockCharges: Math.max(0, (blockCharges ?? 0) - 1) } : {};
        // A used-up shield ends the ward (design.md, Ward).
        const shield = (ward?.shield ?? 0) - (event.absorbed ?? 0);
        const warded = event.absorbed ? { ward: ward && shield > 0 ? { ...ward, shield } : undefined } : {};
        return updateCharacter(state, target.id, { hp: Math.max(0, hp - event.damage), ...used, ...warded });
      }
      const hp = findMonster(state, target.id).hp;
      return updateMonster(state, target.id, { hp: Math.max(0, hp - event.damage) });
    }
    case "died":
      if (event.who.kind === "character") {
        const id = event.who.id;
        // Dying ends regen (design.md, Regen), renew (design.md, Renew), and protecting.
        if ((findCharacter(state, id).regenTurns ?? 0) > 0) state = updateCharacter(state, id, { regenTurns: 0 });
        if ((findCharacter(state, id).renewTurns ?? 0) > 0) state = updateCharacter(state, id, { renewTurns: 0 });
        for (const ally of state.characters.filter((c) => c.protectedBy === id)) {
          state = updateCharacter(state, ally.id, { protectedBy: undefined });
        }
        // What a dead character lost stays lost: its ward. A dead healer's
        // wards end too: it has no next turn to end them (design.md, Ward).
        for (const warded of state.characters.filter((c) => c.id === id || c.ward?.by === id)) {
          if (warded.ward) state = updateCharacter(state, warded.id, { ward: undefined });
        }
      }
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
    case "chargeUsed": {
      const character = findCharacter(state, event.characterId);
      const left = character.spellCharges?.[event.ability] ?? 0;
      return updateCharacter(state, event.characterId, {
        spellCharges: { ...character.spellCharges, [event.ability]: Math.max(0, left - 1) },
      });
    }
    case "chargesRecalled": {
      const character = findCharacter(state, event.characterId);
      const spellCharges = { ...character.spellCharges };
      for (const ability of event.abilities) spellCharges[ability] = (spellCharges[ability] ?? 0) + 1;
      return updateCharacter(state, event.characterId, { spellCharges });
    }
    case "cooldownsAdvanced": {
      const character = findCharacter(state, event.characterId);
      const cooldowns = Object.fromEntries(
        Object.entries(character.cooldowns).map(([ability, turns]) => [ability, Math.max(0, turns - 1)]),
      );
      return updateCharacter(state, event.characterId, { cooldowns });
    }
    case "regenStarted":
      return updateCharacter(state, event.characterId, { regenTurns: event.turns });
    case "regenerated": {
      const { hp, regenTurns } = findCharacter(state, event.characterId);
      return updateCharacter(state, event.characterId, {
        hp: hp + event.healed,
        regenTurns: Math.max(0, (regenTurns ?? 0) - 1),
      });
    }
    case "blockRefilled":
      return updateCharacter(state, event.characterId, { blockCharges: event.charges });
    case "revived": {
      findCharacter(state, event.characterId);
      const revived = updateCharacter(state, event.targetId, { hp: event.hp, position: event.position });
      const order = state.characters.map((c) => c.id);
      return { ...revived, track: returnCharacterToTrack(state.track, order, event.targetId) };
    }
    case "warded":
      findCharacter(state, event.characterId);
      return updateCharacter(state, event.targetId, { ward: { by: event.characterId, shield: event.shield } });
    case "wardEnded":
      return updateCharacter(state, event.characterId, { ward: undefined });
    case "renewStarted":
      findCharacter(state, event.characterId);
      return updateCharacter(state, event.targetId, { renewTurns: event.turns });
    case "renewHealed": {
      const { hp, renewTurns } = findCharacter(state, event.characterId);
      return updateCharacter(state, event.characterId, {
        hp: hp + event.healed,
        renewTurns: Math.max(0, (renewTurns ?? 0) - 1),
      });
    }
    case "healed": {
      findCharacter(state, event.characterId);
      const { hp } = findCharacter(state, event.targetId);
      return updateCharacter(state, event.targetId, { hp: hp + event.healed });
    }
    case "stunned":
      findCharacter(state, event.characterId);
      return updateMonster(state, event.monsterId, { stunned: true });
    case "turnSkipped":
      return updateMonster(state, event.monsterId, { stunned: false, tauntedBy: undefined, frozen: undefined });
    case "frozen":
      findCharacter(state, event.characterId);
      for (const id of event.monsterIds) state = updateMonster(state, id, { frozen: true });
      return state;
    case "wallCreated": {
      findCharacter(state, event.characterId);
      const wall = { characterId: event.characterId, hexes: event.hexes, turnsLeft: event.turns };
      return { ...state, createdWalls: [...(state.createdWalls ?? []), wall] };
    }
    case "wallCountedDown":
      return {
        ...state,
        createdWalls: (state.createdWalls ?? []).map((w) =>
          w.characterId === event.characterId ? { ...w, turnsLeft: Math.max(1, w.turnsLeft - 1) } : w,
        ),
      };
    case "wallRemoved": {
      const createdWalls = (state.createdWalls ?? []).filter((w) => w.characterId !== event.characterId);
      // Left out when there are none, as at the start of the game.
      const { createdWalls: _, ...rest } = state;
      return createdWalls.length > 0 ? { ...rest, createdWalls } : rest;
    }
    case "thawed":
      return updateMonster(state, event.monsterId, { frozen: undefined });
    case "taunted":
      findCharacter(state, event.characterId);
      return updateMonster(state, event.monsterId, { tauntedBy: event.characterId });
    case "tauntEnded":
      return updateMonster(state, event.monsterId, { tauntedBy: undefined });
    case "protected": {
      findCharacter(state, event.characterId);
      // One ally at a time: an earlier one isn't protected by it any more.
      for (const ally of state.characters.filter((c) => c.protectedBy === event.characterId)) {
        state = updateCharacter(state, ally.id, { protectedBy: undefined });
      }
      return updateCharacter(state, event.allyId, { protectedBy: event.characterId });
    }
    case "protectEnded":
      return updateCharacter(state, event.characterId, { protectedBy: undefined });
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
  changes: Partial<
    Pick<GameState["characters"][number], "hp" | "position" | "cooldowns" | "blockCharges" | "regenTurns" | "renewTurns" | "protectedBy" | "spellCharges" | "ward">
  >,
): GameState {
  findCharacter(state, id);
  return {
    ...state,
    characters: state.characters.map((c) => {
      if (c.id !== id) return c;
      const changed = { ...c, ...changes };
      // Left out rather than undefined, so a state rebuilt from events equals one sent as JSON.
      if (changed.protectedBy === undefined) delete changed.protectedBy;
      if (changed.ward === undefined) delete changed.ward;
      return changed;
    }),
  };
}

function updateMonster(
  state: GameState,
  id: MonsterId,
  changes: Partial<Pick<GameState["monsters"][number], "hp" | "position" | "stunned" | "tauntedBy" | "frozen">>,
): GameState {
  findMonster(state, id);
  return {
    ...state,
    monsters: state.monsters.map((m) => {
      if (m.id !== id) return m;
      const changed = { ...m, ...changes };
      // Left out rather than undefined, so a state rebuilt from events equals one sent as JSON.
      if (changed.tauntedBy === undefined) delete changed.tauntedBy;
      if (changed.frozen === undefined) delete changed.frozen;
      return changed;
    }),
  };
}
