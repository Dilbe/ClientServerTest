// Abilities, defined as data (design.md, Abilities): actions that a higher
// rank unlocks. Adding an ability should mostly mean adding an entry here,
// plus what it does in turn.ts.

import { CLASSES, type ClassId } from "./classes.ts";
import { powerCost, type CostFormula } from "./costs.ts";
import { inLeapRange, LEAP_RANGE_UPGRADE, leapMaxDistance } from "./leap.ts";
import { FIREBALL_MAX_DISTANCE, inFireballRange } from "./fireball.ts";
import { inMeteorRange, METEOR_MAX_DISTANCE } from "./meteor.ts";
import { FROST_WAVE_LENGTH_UPGRADE, frostWaveLength } from "./frost-wave.ts";
import { areNeighbours } from "./hex.ts";
import { inSameRoom, inTeleportRange, TELEPORT_MAX_DISTANCE } from "./teleport.ts";
import { CHARGE_MIN_DISTANCE, CHARGE_RANGE_UPGRADE, chargeMaxDistance, chargePath } from "./charge.ts";
import type { CharacterId, CharacterState, GameState } from "./game-state.ts";
import { healTarget } from "./heal.ts";
import { stateAfterPlan } from "./planning.ts";
import type { Stats } from "./stats.ts";
import type { Plan, PlannedAction } from "./turn.ts";

export const ABILITY_IDS = [
  "heavyStrike",
  "charge",
  "cleave",
  "stun",
  "block",
  "taunt",
  "regen",
  "protect",
  "leap",
  "fireball",
  "recall",
  "frostWave",
  "teleport",
  "createWall",
  "meteor",
  "healingTouch",
  "renew",
] as const;
export type AbilityId = (typeof ABILITY_IDS)[number];

/**
 * What an ability upgrade improves (design.md, Ability upgrades): a shorter
 * cooldown, (for charge and leap) a longer range, (for block) more charges or more
 * damage blocked per charge, (for regen) more healing or more turns, (for
 * a spell with charges) a charge more per game, or (for frost wave) a longer
 * wave.
 */
export const ABILITY_UPGRADE_IDS = [
  "cooldown",
  "range",
  "charges",
  "blockedDamage",
  "healing",
  "duration",
  "length",
] as const;
export type AbilityUpgradeId = (typeof ABILITY_UPGRADE_IDS)[number];

export interface AbilityUpgradeDefinition {
  /** What the button shows next to the cost, like "−1" for a turn off the cooldown. */
  step: string;
  /**
   * What the n-th upgrade costs, in upgrade points, before it is rounded
   * up, as for stats (see costs.ts).
   */
  cost: CostFormula;
  /** It can't be upgraded more often than this. */
  maxUpgrades: number;
  /**
   * What one step is, for the guide, when it isn't the usual one for this
   * upgrade: a spell's charge is per game, block's per turn.
   */
  unit?: string;
}

export interface AbilityDefinition {
  name: string;
  description: string;
  /**
   * A passive ability works by itself (design.md, The tank): it takes no
   * action, has no entry in the action menu and no cooldown, so it is never
   * in a plan.
   */
  passive?: true;
  /**
   * After using it, the character can't use it on this many of its own next
   * turns. Turns in which it is dead or not on the map count too. Cooldown
   * upgrades make it shorter (see `abilityCooldown`). 0 for a passive ability.
   */
  cooldown: number;
  /** At most this many in one plan, whatever the actions stat. 0 for a passive ability. */
  maxPerPlan: number;
  /**
   * A spell that can only be cast this many times per game, without charge
   * upgrades (design.md, The caster, Spells). Every game starts with all of
   * them; casting uses one, a cancelled cast doesn't. Left out: no limit.
   */
  charges?: number;
  /** What upgrade points can improve, with what that costs. */
  upgrades: Partial<Record<AbilityUpgradeId, AbilityUpgradeDefinition>>;
}

/**
 * Every ability can have its cooldown shortened by 1 turn per upgrade, down
 * to 1 turn: with a cooldown of 0 it could be used every turn, and would
 * replace the normal action.
 */
function cooldownUpgrade(cooldown: number): AbilityUpgradeDefinition {
  return { step: "−1", cost: powerCost(10, 2), maxUpgrades: cooldown - 1 };
}

export const ABILITIES: Record<AbilityId, AbilityDefinition> = {
  heavyStrike: {
    name: "Heavy strike",
    description: "Attacks the monster on an adjacent hex for double the character's attack damage.",
    cooldown: 4,
    maxPerPlan: 1,
    upgrades: { cooldown: cooldownUpgrade(4) },
  },
  charge: {
    name: "Charge",
    description: "Runs in a straight line towards a monster a few hexes away and attacks it.",
    cooldown: 4,
    maxPerPlan: 1,
    upgrades: {
      cooldown: cooldownUpgrade(4),
      range: CHARGE_RANGE_UPGRADE,
    },
  },
  cleave: {
    name: "Cleave",
    description: "Attacks every adjacent monster at once, each for the character's attack damage.",
    cooldown: 4,
    maxPerPlan: 1,
    upgrades: { cooldown: cooldownUpgrade(4) },
  },
  stun: {
    name: "Stun",
    description: "Stuns an adjacent monster: it skips its next turn. Does no damage.",
    cooldown: 4,
    maxPerPlan: 1,
    upgrades: { cooldown: cooldownUpgrade(4) },
  },
  block: {
    name: "Block",
    description:
      "Passive. Every attack on the character uses a charge and does less damage. " +
      "The charges are back to full at the start of each of its turns.",
    passive: true,
    cooldown: 0,
    maxPerPlan: 0,
    upgrades: {
      charges: { step: "+1", cost: powerCost(10, 1.5), maxUpgrades: 3 },
      blockedDamage: { step: "+1", cost: (n) => 20 + 10 * n ** 3, maxUpgrades: 2 },
    },
  },
  regen: {
    name: "Regen",
    description:
      "Passive. When the character is attacked, it heals at the start of each of its next turns, " +
      "never above its max hit points.",
    passive: true,
    cooldown: 0,
    maxPerPlan: 0,
    upgrades: {
      healing: { step: "+1", cost: powerCost(50, 3), maxUpgrades: 2 },
      duration: { step: "+1", cost: powerCost(10, 1.5), maxUpgrades: 5 },
    },
  },
  leap: {
    name: "Leap",
    description: "Jumps to a free hex a few hexes away that the character can see, over whatever is in between.",
    cooldown: 4,
    maxPerPlan: 1,
    upgrades: { cooldown: cooldownUpgrade(4), range: LEAP_RANGE_UPGRADE },
  },
  protect: {
    name: "Protect",
    description:
      "Protects an adjacent ally until the character's next turn: every attack on the ally hits the character " +
      "instead, while it stands next to the ally.",
    cooldown: 4,
    maxPerPlan: 1,
    upgrades: { cooldown: cooldownUpgrade(4) },
  },
  fireball: {
    name: "Fireball",
    description:
      "Hits every monster on a hex up to 4 hexes away, in line of sight, and on the 6 hexes around it, " +
      "for the caster's attack damage. Characters in the area take no damage.",
    cooldown: 0,
    maxPerPlan: 1,
    charges: 3,
    upgrades: { charges: { step: "+1", cost: powerCost(10, 1.5), maxUpgrades: 3, unit: "charge per game" } },
  },
  frostWave: {
    name: "Frost wave",
    description:
      "Hits every monster on a line of 3 hexes, starting next to the character, for its attack damage, " +
      "and freezes them: on their next turn they can't move, but still attack. Walls and closed doors stop it.",
    cooldown: 4,
    maxPerPlan: 1,
    charges: 2,
    upgrades: {
      cooldown: cooldownUpgrade(4),
      charges: { step: "+1", cost: powerCost(10, 1.5), maxUpgrades: 2, unit: "charge per game" },
      length: FROST_WAVE_LENGTH_UPGRADE,
    },
  },
  teleport: {
    name: "Teleport",
    description:
      "Moves the character to a free hex up to 5 hexes away, without walking there and without seeing it, " +
      "but not into a room behind a closed door.",
    cooldown: 4,
    maxPerPlan: 1,
    upgrades: { cooldown: cooldownUpgrade(4) },
  },
  meteor: {
    name: "Meteor",
    description:
      "Hits every monster within 2 hexes of a hex up to 6 hexes away: double the attack damage on the hex, " +
      "the attack damage next to it, half of it on the ring around that. Only walls and closed doors block the " +
      "line of sight to the hex; characters don't. Characters in the area take no damage.",
    cooldown: 0,
    maxPerPlan: 1,
    charges: 1,
    upgrades: { charges: { step: "+1", cost: powerCost(50, 2), maxUpgrades: 1, unit: "charge per game" } },
  },
  createWall: {
    name: "Create wall",
    description:
      "Puts up a wall on the free hexes of a line of 3, starting next to the character. It blocks movement and " +
      "line of sight like a real wall, and goes at the start of the character's third turn after it.",
    cooldown: 5,
    maxPerPlan: 1,
    // Down to 2, so two walls of one caster never stand at the same time (design.md, Create wall).
    upgrades: { cooldown: { step: "−1", cost: powerCost(10, 2), maxUpgrades: 3 } },
  },
  recall: {
    name: "Recall",
    description:
      "Gives back 1 used charge of each spell with charges. Only while a monster is awake: " +
      "not asleep behind a closed door, and not on guard.",
    cooldown: 5,
    maxPerPlan: 1,
    // Dear, so a short recall is something for a high-level caster (design.md, Recall).
    upgrades: { cooldown: { step: "−1", cost: powerCost(25, 2), maxUpgrades: 4 } },
  },
  healingTouch: {
    name: "Healing touch",
    description:
      "Heals an adjacent character, or the healer itself, for its healing power, never above the max hit points. " +
      "Not carried out when the character is at its max hit points.",
    cooldown: 2,
    maxPerPlan: 1,
    upgrades: { cooldown: cooldownUpgrade(2) },
  },
  renew: {
    name: "Renew",
    description:
      "An adjacent character, or the healer itself, heals 1 hit point at the start of each of its next turns, " +
      "never above its max: for the healer's healing power + 3 turns. Renewing again starts the count anew.",
    cooldown: 4,
    maxPerPlan: 1,
    upgrades: { cooldown: cooldownUpgrade(4) },
  },
  taunt: {
    name: "Taunt",
    description:
      "Taunts an adjacent monster: on its next turn, it attacks the character, or moves towards it. Does no damage.",
    cooldown: 4,
    maxPerPlan: 1,
    upgrades: { cooldown: cooldownUpgrade(4) },
  },
};

/** Block charges per turn, without upgrades (design.md, Block). */
export const BLOCK_CHARGES = 2;
/** Damage one charge blocks, without upgrades. */
export const BLOCKED_PER_CHARGE = 1;

/**
 * How many upgrades of an ability count: never more than the ability allows
 * now, in case a balance change lowered that after they were bought.
 */
function upgradesCounted(ability: AbilityId, upgrade: AbilityUpgradeId, counts: AbilityUpgradeCounts): number {
  return Math.min(counts[ability]?.[upgrade] ?? 0, ABILITIES[ability].upgrades[upgrade]?.maxUpgrades ?? 0);
}

/** The block charges a character has at the start of each of its turns, with its upgrades. */
export function blockCharges(counts: AbilityUpgradeCounts): number {
  return BLOCK_CHARGES + upgradesCounted("block", "charges", counts);
}

/** The damage one block charge takes off an attack, with the character's upgrades. */
export function blockedPerCharge(counts: AbilityUpgradeCounts): number {
  return BLOCKED_PER_CHARGE + upgradesCounted("block", "blockedDamage", counts);
}

/** The charges per game of a spell with charges, with the character's charge upgrades (design.md, Spells). */
export function abilityCharges(ability: AbilityId, counts: AbilityUpgradeCounts): number {
  return (ABILITIES[ability].charges ?? 0) + upgradesCounted(ability, "charges", counts);
}

/** The spells with charges a character has, each with all its charges, as a game starts with them. */
export function fullCharges(
  abilities: readonly AbilityId[],
  counts: AbilityUpgradeCounts,
): Partial<Record<AbilityId, number>> {
  const charges: Partial<Record<AbilityId, number>> = {};
  for (const ability of abilities) {
    if (ABILITIES[ability].charges !== undefined) charges[ability] = abilityCharges(ability, counts);
  }
  return charges;
}

/** The charges a character has left of a spell with charges. */
export function chargesLeft(character: CharacterState, ability: AbilityId): number {
  return character.spellCharges?.[ability] ?? 0;
}

/**
 * The spells with charges the character has used charges of: what a recall
 * gives one charge back of (design.md, Recall).
 */
export function usedCharges(character: CharacterState): AbilityId[] {
  return character.abilities.filter(
    (a) => ABILITIES[a].charges !== undefined && chargesLeft(character, a) < abilityCharges(a, character.abilityUpgrades),
  );
}

/**
 * Whether a monster is awake: alive, not asleep behind a closed door and
 * not on guard. A recall only works then (design.md, Recall), so it can't
 * fill up the charges in a cleared room before the next door.
 */
export function anyMonsterAwake(state: GameState): boolean {
  return state.monsters.some((m) => m.hp > 0 && !m.asleep);
}

/** The abilities that hit every monster in an area at once (design.md, Cleave and Spells). */
export const AREA_ABILITIES: readonly AbilityId[] = ["cleave", "fireball", "frostWave", "meteor"];

/** A created wall is a line of this many hexes (design.md, Create wall). */
export const CREATED_WALL_LENGTH = 3;
/** It lasts this many of its creator's turns: it goes at the start of the third. */
export const CREATED_WALL_TURNS = 3;

/** Hit points renew heals at the start of each of the target's turns (design.md, Renew). */
export const RENEW_HEALING = 1;
/** Renew lasts the healer's healing power plus this many turns. */
export const RENEW_EXTRA_TURNS = 3;

/** For how many of its target's turns a renew cast with this healing power heals (design.md, Renew). */
export function renewTurns(healingPower: number): number {
  return healingPower + RENEW_EXTRA_TURNS;
}

/** Hit points regen heals per turn, and for how many turns, without upgrades (design.md, Regen). */
export const REGEN_HEALING = 1;
export const REGEN_TURNS = 5;

/** The hit points regen heals at the start of each turn, with the character's upgrades. */
export function regenHealing(counts: AbilityUpgradeCounts): number {
  return REGEN_HEALING + upgradesCounted("regen", "healing", counts);
}

/** For how many of its turns regen heals after an attack, with the character's upgrades. */
export function regenTurns(counts: AbilityUpgradeCounts): number {
  return REGEN_TURNS + upgradesCounted("regen", "duration", counts);
}

/**
 * What block does to an attack of `damage` on the character (design.md,
 * Block): with a charge left, the attack uses one and does less damage,
 * never less than 0. An attack that would do no damage uses no charge.
 */
export function blockAttack(character: CharacterState, damage: number): { damage: number; blocked: number } {
  if (!character.abilities.includes("block") || (character.blockCharges ?? 0) === 0 || damage <= 0) {
    return { damage, blocked: 0 };
  }
  const blocked = Math.min(damage, blockedPerCharge(character.abilityUpgrades));
  return { damage: damage - blocked, blocked };
}

/**
 * How often a character upgraded each ability, per upgrade (design.md,
 * Ability upgrades): `{ charge: { range: 1 } }` is one range upgrade of
 * charge. A missing entry means none. Worked out from the stored upgrades
 * (see `abilityUpgradeCounts` in upgrades.ts).
 */
export type AbilityUpgradeCounts = Partial<Record<AbilityId, Partial<Record<AbilityUpgradeId, number>>>>;

/**
 * The ability's cooldown with the character's cooldown upgrades. Never more
 * upgrades than the ability allows now, in case a balance change lowered
 * that after they were bought.
 */
export function abilityCooldown(ability: AbilityId, counts: AbilityUpgradeCounts): number {
  return ABILITIES[ability].cooldown - upgradesCounted(ability, "cooldown", counts);
}

/** What heavy strike multiplies the character's attack damage by. */
export const HEAVY_STRIKE_DAMAGE_MULTIPLIER = 2;

/** The abilities a character of this class and rank has (see `CLASSES` in classes.ts). */
export function abilitiesOf(classId: ClassId, rank: number): AbilityId[] {
  return CLASSES[classId].abilities.filter((a) => rank >= a.fromRank).map((a) => a.ability);
}

/** One row of an ability on the character page; `upgrade` when upgrade points can improve it. */
export interface AbilityStat {
  name: string;
  value: string;
  upgrade?: AbilityUpgradeId;
}

/**
 * What an ability does for a character with these stats and ability
 * upgrades, as name and value rows for the character page (issue #125). The
 * damage follows the character's attack damage upgrades, like in a game.
 */
export function abilityStats(ability: AbilityId, stats: Stats, counts: AbilityUpgradeCounts = {}): AbilityStat[] {
  const rows: AbilityStat[] = [];
  if (ability === "heavyStrike") {
    rows.push({ name: "Damage", value: String(stats.attackDamage * HEAVY_STRIKE_DAMAGE_MULTIPLIER) });
  } else if (ability === "cleave") {
    rows.push({ name: "Damage", value: `${stats.attackDamage} to each adjacent monster` });
  } else if (ability === "stun") {
    rows.push({ name: "Effect", value: "the monster skips its next turn" });
  } else if (ability === "leap") {
    rows.push({ name: "Range", value: `1 to ${leapMaxDistance(counts)} hexes, in line of sight`, upgrade: "range" });
  } else if (ability === "protect") {
    rows.push({ name: "Effect", value: "attacks on the ally hit the character instead, until its next turn" });
  } else if (ability === "taunt") {
    rows.push({ name: "Effect", value: "the monster goes after the character on its next turn" });
  } else if (ability === "regen") {
    const healing = regenHealing(counts);
    rows.push(
      { name: "Healing", value: `${healing} hit ${healing === 1 ? "point" : "points"} per turn`, upgrade: "healing" },
      { name: "Duration", value: `${regenTurns(counts)} turns`, upgrade: "duration" },
    );
  } else if (ability === "block") {
    rows.push(
      { name: "Charges", value: `${blockCharges(counts)} per turn`, upgrade: "charges" },
      { name: "Damage blocked", value: `${blockedPerCharge(counts)} per charge`, upgrade: "blockedDamage" },
    );
  } else if (ability === "fireball") {
    rows.push(
      { name: "Damage", value: `${stats.attackDamage} to every monster on the hex and the 6 around it` },
      { name: "Range", value: `0 to ${FIREBALL_MAX_DISTANCE} hexes, in line of sight` },
    );
  } else if (ability === "meteor") {
    const d = stats.attackDamage;
    rows.push(
      { name: "Damage", value: `${d * 2} on the hex, ${d} next to it, ${Math.floor(d / 2)} on the ring around that` },
      { name: "Range", value: `0 to ${METEOR_MAX_DISTANCE} hexes; only walls and closed doors block the line of sight` },
    );
  } else if (ability === "frostWave") {
    rows.push(
      { name: "Damage", value: `${stats.attackDamage} to every monster on the line, which is frozen` },
      { name: "Length", value: `${frostWaveLength(counts)} hexes`, upgrade: "length" },
    );
  } else if (ability === "teleport") {
    rows.push({ name: "Range", value: `1 to ${TELEPORT_MAX_DISTANCE} hexes, no line of sight needed` });
  } else if (ability === "createWall") {
    rows.push(
      { name: "Length", value: `${CREATED_WALL_LENGTH} hexes, with a gap where someone stands` },
      { name: "Lasts", value: `${CREATED_WALL_TURNS} of the character's turns` },
    );
  } else if (ability === "recall") {
    rows.push({ name: "Effect", value: "1 used charge back of each spell with charges, while a monster is awake" });
  } else if (ability === "healingTouch") {
    rows.push({ name: "Healing", value: `${stats.healingPower ?? 0} hit points, never above the max` });
  } else if (ability === "renew") {
    rows.push(
      { name: "Healing", value: `${RENEW_HEALING} hit point at the start of each of the character's turns` },
      { name: "Duration", value: `${renewTurns(stats.healingPower ?? 0)} turns (healing power + ${RENEW_EXTRA_TURNS})` },
    );
  } else if (ability === "charge") {
    rows.push(
      { name: "Damage", value: String(stats.attackDamage) },
      { name: "Range", value: `${CHARGE_MIN_DISTANCE} to ${chargeMaxDistance(counts)} hexes`, upgrade: "range" },
    );
  }
  const charges = ABILITIES[ability].charges;
  if (charges !== undefined) rows.push({ name: "Charges", value: `${abilityCharges(ability, counts)} per game`, upgrade: "charges" });
  // A passive ability has no cooldown, and some spells have none either.
  if (ABILITIES[ability].passive || ABILITIES[ability].cooldown === 0) return rows;
  const cooldown = abilityCooldown(ability, counts);
  rows.push({ name: "Cooldown", value: `${cooldown} ${cooldown === 1 ? "turn" : "turns"}`, upgrade: "cooldown" });
  return rows;
}

/** The ability a planned action uses, if any. */
export function abilityOfAction(action: PlannedAction): AbilityId | undefined {
  const { type } = action;
  return type === "heavyStrike" ||
    type === "charge" ||
    type === "cleave" ||
    type === "stun" ||
    type === "taunt" ||
    type === "protect" ||
    type === "leap" ||
    type === "fireball" ||
    type === "recall" ||
    type === "frostWave" ||
    type === "teleport" ||
    type === "createWall" ||
    type === "meteor" ||
    type === "healingTouch" ||
    type === "renew"
    ? type
    : undefined;
}

/**
 * Why the character can't add one more use of an ability to its plan for
 * its next turn, or `undefined` when it can: it doesn't have the ability,
 * the ability is on cooldown on that turn, or the plan already holds as many
 * as one plan can. Shared, so the client's action menu and the server's
 * check agree.
 */
export function abilityProblem(character: CharacterState, ability: AbilityId, plan: Plan): string | undefined {
  const { maxPerPlan, passive } = ABILITIES[ability];
  if (!character.abilities.includes(ability)) return "Needs a higher rank";
  if (passive) return "Works by itself";
  // A spell with charges needs one left (design.md, Spells).
  if (ABILITIES[ability].charges !== undefined && chargesLeft(character, ability) === 0) return "No charges left";
  // On cooldown for this many more turns: it is ready on the turn after them.
  const turns = character.cooldowns[ability] ?? 0;
  if (turns > 0) return `Ready in ${turns + 1} turns`;
  if (plan.filter((a) => abilityOfAction(a) === ability).length >= maxPerPlan) return "Already planned";
  return undefined;
}

/**
 * Why a plan can't be carried out on the character's next turn because of
 * its abilities, or `undefined` when it can. The server refuses such a plan:
 * a client can send any plan it likes (design.md, Heavy strike).
 *
 * A charge also needs its target hex to be in a straight line 2 hexes or
 * more away, up to the character's longest charge (design.md, Charge), seen
 * from where the actions before it take the character. Whether the path is
 * free and a monster stands on the hex isn't checked here: either may change
 * before the turn fires, and then the rules cancel the charge. A charge and
 * a cleave both need the character to be on the map by then. A cleave needs
 * no monster next to the character yet: one may come close before the turn
 * fires (design.md, Cleave). A leap needs its hex 1 hex or more away, up to
 * the character's longest leap; whether it is free and in sight is checked
 * when the turn fires (design.md, Leap). A fireball needs its hex 0 to 4 hexes
 * away; the line of sight and the monsters in the area are checked when it
 * is carried out (design.md, Fireball). So does a meteor, up to 6 hexes away
 * (design.md, Meteor). A recall needs a monster awake now;
 * whether one still is, and whether a charge was used, is checked again
 * when it is carried out (design.md, Recall). A frost wave needs its hex
 * next to the character: that hex picks the direction (design.md, Frost wave),
 * and so does create wall (design.md, Create wall).
 * A teleport needs its hex 1 to 5 hexes away and not behind a closed door,
 * with the doors the plan opens before it open; whether the hex is free is
 * checked when it is carried out (design.md, Teleport). A heal on a
 * character needs it to be a living character on the map, next to where the
 * plan places the healer, or the healer itself; whether it still is, is
 * checked when it is carried out (design.md, The healer).
 */
export function planAbilityProblem(state: GameState, characterId: CharacterId, plan: Plan): string | undefined {
  const character = state.characters.find((c) => c.id === characterId);
  if (!character) return "That character isn't in this game.";
  for (let index = 0; index < plan.length; index++) {
    const action = plan[index]!;
    const ability = abilityOfAction(action);
    if (ability === undefined) continue;
    const before = plan.slice(0, index);
    let problem = abilityProblem(character, ability, before);
    if (
      problem === undefined &&
      (action.type === "charge" ||
        action.type === "cleave" ||
        action.type === "leap" ||
        action.type === "fireball" ||
        action.type === "recall" ||
        action.type === "frostWave" ||
        action.type === "teleport" ||
        action.type === "createWall" ||
        action.type === "meteor" ||
        action.type === "healingTouch" ||
        action.type === "renew")
    ) {
      const planned = stateAfterPlan(state, characterId, before);
      const position = planned.characters.find((c) => c.id === characterId)!.position;
      if (position === null) problem = "The character isn't on the map yet";
      else if (action.type === "recall") {
        if (!anyMonsterAwake(state)) problem = "No monsters awake";
      }
      else if (action.type === "charge") {
        const maxDistance = chargeMaxDistance(character.abilityUpgrades);
        if (!chargePath(position, action.target, maxDistance)) {
          problem = `The hex isn't in a straight line ${CHARGE_MIN_DISTANCE} to ${maxDistance} hexes away`;
        }
      } else if (action.type === "leap") {
        const maxDistance = leapMaxDistance(character.abilityUpgrades);
        if (!inLeapRange(position, action.target, maxDistance)) problem = `The hex isn't 1 to ${maxDistance} hexes away`;
      } else if (action.type === "teleport") {
        if (!inTeleportRange(position, action.target)) problem = `The hex isn't 1 to ${TELEPORT_MAX_DISTANCE} hexes away`;
        else if (!inSameRoom(planned, position, action.target)) problem = "The hex is behind a closed door";
      } else if (action.type === "frostWave" || action.type === "createWall") {
        if (!areNeighbours(position, action.target)) problem = "The hex isn't next to the character";
      } else if (action.type === "fireball") {
        if (!inFireballRange(position, action.target)) problem = `The hex is more than ${FIREBALL_MAX_DISTANCE} hexes away`;
      } else if (action.type === "meteor") {
        if (!inMeteorRange(position, action.target)) problem = `The hex is more than ${METEOR_MAX_DISTANCE} hexes away`;
      } else if (action.type === "healingTouch" || action.type === "renew") {
        // Who stands where now: the heal follows the target if it moves (design.md, The healer).
        const target = healTarget(state, characterId, position, action.target);
        if (target === "no ally") problem = "The target isn't a living character on the map";
        else if (target === "not a neighbour") problem = "The target isn't next to the character";
      }
    }
    if (problem !== undefined) return `${ABILITIES[ability].name} can't be planned: ${problem.toLowerCase()}.`;
  }
  return undefined;
}

/**
 * Where an ability stands for the details card (design.md, The details
 * card): `"planned"` when the plan already holds it, the number of turns
 * until it is ready while it is on cooldown (counted as in the action menu's
 * "Ready in 2 turns"), or `"ready"` when it can be planned.
 */
export type AbilityStatus = "ready" | "planned" | number;

/**
 * Where a passive ability stands for the details card and the track, like
 * "2/2" for the block charges left, or `undefined` for one that has nothing
 * to show, like regen while it isn't running.
 */
export function passiveStatus(character: CharacterState, ability: AbilityId): string | undefined {
  if (ability === "block") return `${character.blockCharges ?? 0}/${blockCharges(character.abilityUpgrades)}`;
  if (ability === "regen") return (character.regenTurns ?? 0) > 0 ? `${character.regenTurns} turns left` : undefined;
  return undefined;
}

export function abilityStatus(character: CharacterState, ability: AbilityId, plan: Plan): AbilityStatus {
  if (plan.some((a) => abilityOfAction(a) === ability)) return "planned";
  const turns = character.cooldowns[ability] ?? 0;
  return turns > 0 ? turns + 1 : "ready";
}

/**
 * The abilities line of the details card, like "Heavy strike ✓ · Charge 2 ·
 * Cleave planned", "Block 2/2" or "Fireball 2/3 ✓", or `undefined` for a
 * character without abilities.
 */
export function abilitiesLine(character: CharacterState, plan: Plan): string | undefined {
  if (character.abilities.length === 0) return undefined;
  return character.abilities
    .map((ability) => {
      if (ABILITIES[ability].passive) {
        const passive = passiveStatus(character, ability);
        return passive === undefined ? ABILITIES[ability].name : `${ABILITIES[ability].name} ${passive}`;
      }
      const status = abilityStatus(character, ability, plan);
      const shown = status === "ready" ? "✓" : String(status);
      // A spell with charges shows the charges left, like "Fireball 2/3 ✓" (design.md, Spells).
      if (ABILITIES[ability].charges === undefined) return `${ABILITIES[ability].name} ${shown}`;
      const left = chargesLeft(character, ability);
      const charges = `${left}/${abilityCharges(ability, character.abilityUpgrades)}`;
      return left === 0 && status !== "planned"
        ? `${ABILITIES[ability].name} ${charges}`
        : `${ABILITIES[ability].name} ${charges} ${shown}`;
    })
    .join(" · ");
}
