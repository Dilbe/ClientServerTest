// How one-time rewards are described to the player (design.md, Rewards).

import { CLASS_NAMES } from "../shared/rules/classes.ts";
import type { OneTimeReward } from "../shared/rules/dungeon-map.ts";

/** One reward, like "a new level 1, rank 2 Adventurer". */
export function describeOneTimeReward(reward: OneTimeReward): string {
  switch (reward.type) {
    case "newCharacter":
      return `a new level ${reward.level}, rank ${reward.rank} ${CLASS_NAMES[reward.class]}`;
    case "village":
      return "the village";
  }
}

/** One reward as the lobby lists it, short: "level 1 rank 2 Adventurer", "the village". */
export function oneTimeRewardName(reward: OneTimeReward): string {
  switch (reward.type) {
    case "newCharacter":
      return `level ${reward.level} rank ${reward.rank} ${CLASS_NAMES[reward.class]}`;
    case "village":
      return "the village";
  }
}
