// The turn durations a game can be created with (design.md, Turns). The
// turn duration is the length of the cycle: every character acts once per
// cycle, so it is how long a player has between two turns of a character.
//
// Like the dungeons, the choices are data: the client shows them in the
// "Create a game" list, and the server checks the chosen id against them.

export const TURN_DURATION_IDS = ["quick", "normal", "slow", "crawl"] as const;
export type TurnDurationId = (typeof TURN_DURATION_IDS)[number];

export interface TurnDuration {
  name: string;
  seconds: number;
}

export const TURN_DURATIONS: Record<TurnDurationId, TurnDuration> = {
  quick: { name: "Quick", seconds: 10 },
  normal: { name: "Normal", seconds: 30 },
  slow: { name: "Slow", seconds: 60 },
  crawl: { name: "Crawl", seconds: 300 },
};

/** Preselected when creating a game. */
export const DEFAULT_TURN_DURATION: TurnDurationId = "normal";

/** The cycle length of a turn duration, in milliseconds. */
export function cycleMsOf(id: TurnDurationId): number {
  return TURN_DURATIONS[id].seconds * 1000;
}

/** "Normal (30 seconds)", "Slow (60 seconds)", "Crawl (5 minutes)". */
export function describeTurnDuration(id: TurnDurationId): string {
  const { name, seconds } = TURN_DURATIONS[id];
  const length = seconds > 60 && seconds % 60 === 0 ? plural(seconds / 60, "minute") : plural(seconds, "second");
  return `${name} (${length})`;
}

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}
