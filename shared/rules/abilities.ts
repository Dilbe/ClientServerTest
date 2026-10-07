// Abilities, defined as data (design.md, Abilities): actions that a higher
// rank unlocks. Adding an ability should mostly mean adding an entry here,
// plus what it does in turn.ts.

import type { ClassId } from "./advancement.ts";
import type { CharacterState } from "./game-state.ts";
import type { Plan, PlannedAction } from "./turn.ts";

export const ABILITY_IDS = ["heavyStrike"] as const;
export type AbilityId = (typeof ABILITY_IDS)[number];

export interface AbilityDefinition {
  name: string;
  description: string;
  /**
   * After using it, the character can't use it on this many of its own next
   * turns. Turns in which it is dead or not on the map count too.
   */
  cooldown: number;
  /** At most this many in one plan, whatever the actions stat. */
  maxPerPlan: number;
}

export const ABILITIES: Record<AbilityId, AbilityDefinition> = {
  heavyStrike: {
    name: "Heavy strike",
    description: "Attacks an adjacent monster for double the character's attack damage.",
    cooldown: 4,
    maxPerPlan: 1,
  },
};

/** What heavy strike multiplies the character's attack damage by. */
export const HEAVY_STRIKE_DAMAGE_MULTIPLIER = 2;

/** Which rank of each class unlocks which ability. */
export const CLASS_ABILITIES: Record<ClassId, readonly { ability: AbilityId; fromRank: number }[]> = {
  adventurer: [{ ability: "heavyStrike", fromRank: 2 }],
};

/** The abilities a character of this class and rank has. */
export function abilitiesOf(classId: ClassId, rank: number): AbilityId[] {
  return CLASS_ABILITIES[classId].filter((a) => rank >= a.fromRank).map((a) => a.ability);
}

/** The ability a planned action uses, if any. */
export function abilityOfAction(action: PlannedAction): AbilityId | undefined {
  return action.type === "heavyStrike" ? action.type : undefined;
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

/**
 * Why a plan can't be carried out on the character's next turn because of
 * its abilities, or `undefined` when it can. The server refuses such a plan:
 * a client can send any plan it likes (design.md, Heavy strike).
 */
export function planAbilityProblem(character: CharacterState, plan: Plan): string | undefined {
  for (let index = 0; index < plan.length; index++) {
    const ability = abilityOfAction(plan[index]!);
    if (ability === undefined) continue;
    const problem = abilityProblem(character, ability, plan.slice(0, index));
    if (problem !== undefined) return `${ABILITIES[ability].name} can't be planned: ${problem.toLowerCase()}.`;
  }
  return undefined;
}
