// How one-time rewards are described to the player (design.md, Rewards).

import type { OneTimeReward } from "../shared/rules/dungeon-map.ts";

export function describeOneTimeReward(reward: OneTimeReward): string {
  switch (reward.type) {
    case "newCharacter":
      return "a new character";
  }
}

/** All of a dungeon's one-time rewards in one phrase, like "a new character". */
export function describeOneTimeRewards(rewards: readonly OneTimeReward[]): string {
  return rewards.length === 0 ? "nothing" : rewards.map(describeOneTimeReward).join(", ");
}
