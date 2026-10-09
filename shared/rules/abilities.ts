// Abilities, defined as data (design.md, Abilities): actions that a higher
// rank unlocks. Adding an ability should mostly mean adding an entry here,
// plus what it does in turn.ts.

import type { ClassId } from "./advancement.ts";
import { CHARGE_MAX_DISTANCE, CHARGE_MIN_DISTANCE, chargeProblem, type ChargeProblem } from "./charge.ts";
import type { CharacterId, CharacterState, GameState } from "./game-state.ts";
import { stateAfterPlan } from "./planning.ts";
import type { Stats } from "./stats.ts";
import type { Plan, PlannedAction } from "./turn.ts";

export const ABILITY_IDS = ["heavyStrike", "charge"] as const;
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
  charge: {
    name: "Charge",
    description: `Runs in a straight line to a monster ${CHARGE_MIN_DISTANCE} to ${CHARGE_MAX_DISTANCE} hexes away and attacks it.`,
    cooldown: 4,
    maxPerPlan: 1,
  },
};

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

/**
 * What an ability does for a character with these stats, as name and value
 * rows for the character page (issue #125). The damage follows the
 * character's attack damage upgrades, like in a game.
 */
export function abilityStats(ability: AbilityId, stats: Stats): { name: string; value: string }[] {
  const { cooldown, maxPerPlan } = ABILITIES[ability];
  const rows: { name: string; value: string }[] = [];
  if (ability === "heavyStrike") {
    rows.push({ name: "Damage", value: String(stats.attackDamage * HEAVY_STRIKE_DAMAGE_MULTIPLIER) });
  } else if (ability === "charge") {
    rows.push(
      { name: "Damage", value: String(stats.attackDamage) },
      { name: "Range", value: `${CHARGE_MIN_DISTANCE} to ${CHARGE_MAX_DISTANCE} hexes` },
    );
  }
  rows.push(
    { name: "Cooldown", value: `${cooldown} ${cooldown === 1 ? "turn" : "turns"}` },
    { name: "Per plan", value: `at most ${maxPerPlan}` },
  );
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
const CHARGE_PROBLEMS: Record<ChargeProblem, string> = {
  "target gone": "That monster isn't there",
  "not in line": `The monster isn't in a straight line ${CHARGE_MIN_DISTANCE} to ${CHARGE_MAX_DISTANCE} hexes away`,
  "path blocked": "Something is in the way",
};

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
        const chargeIssue = chargeProblem(planned, position, action.monsterId);
        if (chargeIssue !== undefined) problem = CHARGE_PROBLEMS[chargeIssue];
      }
    }
    if (problem !== undefined) return `${ABILITIES[ability].name} can't be planned: ${problem.toLowerCase()}.`;
  }
  return undefined;
}
