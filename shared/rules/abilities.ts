// Abilities, defined as data (design.md, Abilities): actions that a higher
// rank unlocks. Adding an ability should mostly mean adding an entry here,
// plus what it does in turn.ts.

import { CLASSES, type ClassId } from "./classes.ts";
import { powerCost, type CostFormula } from "./costs.ts";
import { inLeapRange, LEAP_RANGE_UPGRADE, leapMaxDistance } from "./leap.ts";
import { CHARGE_MIN_DISTANCE, CHARGE_RANGE_UPGRADE, chargeMaxDistance, chargePath } from "./charge.ts";
import type { CharacterId, CharacterState, GameState } from "./game-state.ts";
import { stateAfterPlan } from "./planning.ts";
import type { Stats } from "./stats.ts";
import type { Plan, PlannedAction } from "./turn.ts";

export const ABILITY_IDS = ["heavyStrike", "charge", "cleave", "stun", "block", "taunt", "regen", "protect", "leap"] as const;
export type AbilityId = (typeof ABILITY_IDS)[number];

/**
 * What an ability upgrade improves (design.md, Ability upgrades): a shorter
 * cooldown, (for charge and leap) a longer range, (for block) more charges or more
 * damage blocked per charge, or (for regen) more healing or more turns.
 */
export const ABILITY_UPGRADE_IDS = ["cooldown", "range", "charges", "blockedDamage", "healing", "duration"] as const;
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
  } else if (ability === "charge") {
    rows.push(
      { name: "Damage", value: String(stats.attackDamage) },
      { name: "Range", value: `${CHARGE_MIN_DISTANCE} to ${chargeMaxDistance(counts)} hexes`, upgrade: "range" },
    );
  }
  // A passive ability has no cooldown.
  if (ABILITIES[ability].passive) return rows;
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
    type === "leap"
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
 * when the turn fires (design.md, Leap).
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
    if (problem === undefined && (action.type === "charge" || action.type === "cleave" || action.type === "leap")) {
      const planned = stateAfterPlan(state, characterId, before);
      const position = planned.characters.find((c) => c.id === characterId)!.position;
      if (position === null) problem = "The character isn't on the map yet";
      else if (action.type === "charge") {
        const maxDistance = chargeMaxDistance(character.abilityUpgrades);
        if (!chargePath(position, action.target, maxDistance)) {
          problem = `The hex isn't in a straight line ${CHARGE_MIN_DISTANCE} to ${maxDistance} hexes away`;
        }
      } else if (action.type === "leap") {
        const maxDistance = leapMaxDistance(character.abilityUpgrades);
        if (!inLeapRange(position, action.target, maxDistance)) problem = `The hex isn't 1 to ${maxDistance} hexes away`;
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
 * Cleave planned" or "Block 2/2", or `undefined` for a character without
 * abilities.
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
      return `${ABILITIES[ability].name} ${status === "ready" ? "✓" : status}`;
    })
    .join(" · ");
}
