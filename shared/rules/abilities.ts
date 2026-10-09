// Abilities, defined as data (design.md, Abilities): actions that a higher
// rank unlocks. Adding an ability should mostly mean adding an entry here,
// plus what it does in turn.ts.

import type { ClassId } from "./advancement.ts";
import {
  CHARGE_MIN_DISTANCE,
  CHARGE_RANGE_UPGRADE,
  chargeMaxDistance,
  chargeProblem,
  type ChargeProblem,
} from "./charge.ts";
import type { CharacterId, CharacterState, GameState } from "./game-state.ts";
import { stateAfterPlan } from "./planning.ts";
import type { Stats } from "./stats.ts";
import type { Plan, PlannedAction } from "./turn.ts";

export const ABILITY_IDS = ["heavyStrike", "charge"] as const;
export type AbilityId = (typeof ABILITY_IDS)[number];

/**
 * What an ability upgrade improves (design.md, Ability upgrades): a shorter
 * cooldown, or (for charge) a longer range.
 */
export const ABILITY_UPGRADE_IDS = ["cooldown", "range"] as const;
export type AbilityUpgradeId = (typeof ABILITY_UPGRADE_IDS)[number];

export interface AbilityUpgradeDefinition {
  /** What the button shows next to the cost, like "−1" for a turn off the cooldown. */
  step: string;
  /**
   * What it costs, in upgrade points: the n-th upgrade costs
   * firstUpgradeCost × n^upgradeCostExponent, rounded up, as for stats.
   */
  firstUpgradeCost: number;
  upgradeCostExponent: number;
  /** It can't be upgraded more often than this. */
  maxUpgrades: number;
}

export interface AbilityDefinition {
  name: string;
  description: string;
  /**
   * After using it, the character can't use it on this many of its own next
   * turns. Turns in which it is dead or not on the map count too. Cooldown
   * upgrades make it shorter (see `abilityCooldown`).
   */
  cooldown: number;
  /** At most this many in one plan, whatever the actions stat. */
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
  return { step: "−1", firstUpgradeCost: 10, upgradeCostExponent: 2, maxUpgrades: cooldown - 1 };
}

export const ABILITIES: Record<AbilityId, AbilityDefinition> = {
  heavyStrike: {
    name: "Heavy strike",
    description: "Attacks an adjacent monster for double the character's attack damage.",
    cooldown: 4,
    maxPerPlan: 1,
    upgrades: { cooldown: cooldownUpgrade(4) },
  },
  charge: {
    name: "Charge",
    description: "Runs in a straight line to a monster a few hexes away and attacks it.",
    cooldown: 4,
    maxPerPlan: 1,
    upgrades: {
      cooldown: cooldownUpgrade(4),
      range: CHARGE_RANGE_UPGRADE,
    },
  },
};

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
  const { cooldown, upgrades } = ABILITIES[ability];
  return cooldown - Math.min(counts[ability]?.cooldown ?? 0, upgrades.cooldown?.maxUpgrades ?? 0);
}

/** What heavy strike multiplies the character's attack damage by. */
export const HEAVY_STRIKE_DAMAGE_MULTIPLIER = 2;

/** Which rank of each class unlocks which ability. */
export const CLASS_ABILITIES: Record<ClassId, readonly { ability: AbilityId; fromRank: number }[]> = {
  adventurer: [
    { ability: "heavyStrike", fromRank: 2 },
    { ability: "charge", fromRank: 3 },
  ],
};

/** The abilities a character of this class and rank has. */
export function abilitiesOf(classId: ClassId, rank: number): AbilityId[] {
  return CLASS_ABILITIES[classId].filter((a) => rank >= a.fromRank).map((a) => a.ability);
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
  } else if (ability === "charge") {
    rows.push(
      { name: "Damage", value: String(stats.attackDamage) },
      { name: "Range", value: `${CHARGE_MIN_DISTANCE} to ${chargeMaxDistance(counts)} hexes`, upgrade: "range" },
    );
  }
  const cooldown = abilityCooldown(ability, counts);
  rows.push({ name: "Cooldown", value: `${cooldown} ${cooldown === 1 ? "turn" : "turns"}`, upgrade: "cooldown" });
  return rows;
}

/** The ability a planned action uses, if any. */
export function abilityOfAction(action: PlannedAction): AbilityId | undefined {
  return action.type === "heavyStrike" || action.type === "charge" ? action.type : undefined;
}

/**
 * Why the character can't add one more use of an ability to its plan for
 * its next turn, or `undefined` when it can: it doesn't have the ability,
 * the ability is on cooldown on that turn, or the plan already holds as many
 * as one plan can. Shared, so the client's button and the server's check
 * agree.
 */
export function abilityProblem(character: CharacterState, ability: AbilityId, plan: Plan): string | undefined {
  const { maxPerPlan } = ABILITIES[ability];
  if (!character.abilities.includes(ability)) return "Needs a higher rank";
  // On cooldown for this many more turns: it is ready on the turn after them.
  const turns = character.cooldowns[ability] ?? 0;
  if (turns > 0) return `Ready in ${turns + 1} turns`;
  if (plan.filter((a) => abilityOfAction(a) === ability).length >= maxPerPlan) return "Already planned";
  return undefined;
}

/** What a `ChargeProblem` means, to tell the player why a charge can't be planned. */
function chargeProblemText(problem: ChargeProblem, maxDistance: number): string {
  switch (problem) {
    case "target gone":
      return "That monster isn't there";
    case "not in line":
      return `The monster isn't in a straight line ${CHARGE_MIN_DISTANCE} to ${maxDistance} hexes away`;
    case "path blocked":
      return "Something is in the way";
  }
}

/**
 * Why a plan can't be carried out on the character's next turn because of
 * its abilities, or `undefined` when it can. The server refuses such a plan:
 * a client can send any plan it likes (design.md, Heavy strike).
 *
 * A charge also needs its monster to be in a straight line with a free path
 * (design.md, Charge), seen from where the actions before it take the
 * character, in `state` as it is now. When the turn fires, the situation may
 * have changed; then the rules cancel the charge.
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
    if (problem === undefined && action.type === "charge") {
      const planned = stateAfterPlan(state, characterId, before);
      const position = planned.characters.find((c) => c.id === characterId)!.position;
      if (position === null) problem = "The character isn't on the map yet";
      else {
        const maxDistance = chargeMaxDistance(character.abilityUpgrades);
        const chargeIssue = chargeProblem(planned, position, action.monsterId, maxDistance);
        if (chargeIssue !== undefined) problem = chargeProblemText(chargeIssue, maxDistance);
      }
    }
    if (problem !== undefined) return `${ABILITIES[ability].name} can't be planned: ${problem.toLowerCase()}.`;
  }
  return undefined;
}
