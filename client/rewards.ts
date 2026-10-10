// How one-time rewards are described to the player (design.md, Rewards).

import { CLASS_NAMES } from "../shared/rules/advancement.ts";
import type { OneTimeReward } from "../shared/rules/dungeon-map.ts";

/** One reward, like "a new level 1, rank 2 Adventurer". */
export function describeOneTimeReward(reward: OneTimeReward): string {
  switch (reward.type) {
    case "newCharacter":
      return `a new level ${reward.level}, rank ${reward.rank} ${CLASS_NAMES[reward.class]}`;
  }
}

/** All of a dungeon's one-time rewards in one phrase, like "a new level 1, rank 2 Adventurer". */
export function describeOneTimeRewards(rewards: readonly OneTimeReward[]): string {
  return rewards.length === 0 ? "nothing" : rewards.map(describeOneTimeReward).join(", ");
}
