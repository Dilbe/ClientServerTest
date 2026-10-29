// Stats and monster types, defined as data (design.md, Built to grow):
// adding a stat or a monster type should mostly mean adding an entry here.

export const STAT_IDS = ["actions", "movement", "attackDamage", "hitPoints", "healingPower", "range"] as const;
export type StatId = (typeof STAT_IDS)[number];

/**
 * The stats every character and monster has. The others are stats of one
 * class (design.md, The healer: healing power): a character of another
 * class, and a monster, doesn't have them at all.
 *
 * Range is a bit different: every character has a range (design.md, Ranged
 * attacks for characters), but for every class but the ranger it is 1 to 1
 * and can't be upgraded, so only the ranger has it as a stat. The stat is
 * the longest distance; the shortest is part of the class (see
 * `attackRange` in classes.ts). A monster's range is part of its type.
 */
export const COMMON_STAT_IDS = ["actions", "movement", "attackDamage", "hitPoints"] as const satisfies readonly StatId[];
export type CommonStatId = (typeof COMMON_STAT_IDS)[number];
/** A stat that only some classes have. */
export type ClassOnlyStatId = Exclude<StatId, CommonStatId>;

/**
 * The stats a player can spend upgrade points on (design.md, Upgrade points).
 * Movement isn't one: it can't be upgraded, for any class. It stays a stat,
 * with its upgrade costs per class, so it can be added here again later.
 * A stat of one class can only be upgraded by a character of that class.
 * Some stats can only be upgraded a few times (the ranger's range).
 */
export const UPGRADABLE_STAT_IDS = ["actions", "attackDamage", "hitPoints", "healingPower", "range"] as const satisfies readonly StatId[];
export type UpgradableStatId = (typeof UPGRADABLE_STAT_IDS)[number];

/**
 * A value for every common stat, and for the stats of one class only when
 * the character has them. Used for characters and monster types alike.
 */
export type Stats = Record<CommonStatId, number> & Partial<Record<ClassOnlyStatId, number>>;

export interface StatDefinition {
  name: string;
  description: string;
}

/**
 * What every stat is. What a character starts with and what upgrading costs
 * differ per class: see `CLASSES` in classes.ts.
 */
export const STATS: Record<StatId, StatDefinition> = {
  actions: { name: "Actions", description: "Actions done per turn." },
  movement: { name: "Movement", description: "Hexes moved per move action." },
  attackDamage: { name: "Attack damage", description: "Damage done to an enemy per attack." },
  hitPoints: { name: "Hit points", description: "Damage that can be taken before dying." },
  healingPower: { name: "Healing power", description: "Hit points a heal restores. Only the healer has it." },
  range: {
    name: "Range",
    description: "How far away its attacks hit, in hexes: 1 to 1 (next to it) for every class but the ranger.",
  },
};

export const MONSTER_TYPE_IDS = ["basic", "rat", "guard", "archer", "brute", "tessa", "barbara", "mark", "wolf", "sentry", "crossbowman", "ogre", "lotte", "lottesBarbara", "lottesMark"] as const;
export type MonsterTypeId = (typeof MONSTER_TYPE_IDS)[number];

/**
 * The rules a monster can use to choose its target (design.md, Monsters).
 * A monster type lists the ones it uses, in order; they are applied one by
 * one until only one player is left. The descriptions are what the game
 * shows the player.
 */
export const TARGET_RULE_IDS = ["closest", "fewestHitPoints", "nextOnTrack"] as const;
export type TargetRuleId = (typeof TARGET_RULE_IDS)[number];

export const TARGET_RULES: Record<TargetRuleId, { description: string }> = {
  closest: {
    description:
      "The player it can reach in the fewest turns. If it can't reach anyone: the closest player in a straight line.",
  },
  fewestHitPoints: { description: "The player with the fewest hit points." },
  nextOnTrack: { description: "The first player after the monster on the initiative track." },
};

export interface MonsterType {
  id: MonsterTypeId;
  name: string;
  /**
   * A short mark for the map and the initiative track, in front of the
   * monster's number: "R3" is monster 3, a rat. A different label for every
   * type, so types never share one: one letter where it can, two where the
   * letter is taken ("Ba" for Barbara, as B is the brute's).
   */
  label: string;
  /**
   * A named monster is a character, not a kind of monster (design.md,
   * Monster types): the log, the preview and the monster info call it by
   * its name alone ("Tessa"), without its number. The map and the initiative
   * track still show the label with the number ("T3").
   */
  named?: boolean;
  stats: Stats;
  /** Gained by every character in the game when a monster of this type dies (design.md, Rewards). */
  xp: number;
  /**
   * How far it attacks, in hexes in a straight line: 1 is only next to it.
   * Further away it also needs line of sight (design.md, Ranged attacks).
   */
  range: number;
  /** Applied in order until one player is left. */
  targetRules: readonly TargetRuleId[];
  /**
   * Ranged targeting (design.md, Ranged attacks). With these rules, the
   * monster first looks at the players it can attack right now: within its
   * range and in line of sight. If there are any, it attacks one of them,
   * chosen with these rules in order, without moving. Only if there are none
   * does it use `targetRules` to choose whom to move towards. Without them,
   * it always uses `targetRules`.
   */
  rangedTargetRules?: readonly TargetRuleId[];
  /**
   * A monster with an alert range starts on guard: it skips its turns until
   * a character is within this many hexes in a straight line, or until it
   * is attacked (design.md, Guards and alert range). Doors don't wake it.
   * Without one, the monster is awake from the start, unless it is in a room
   * behind a closed door.
   */
  alertRange?: number;
}

export const MONSTER_TYPES: Record<MonsterTypeId, MonsterType> = {
  basic: {
    id: "basic",
    name: "Monster",
    label: "M",
    stats: { actions: 1, movement: 1, attackDamage: 1, hitPoints: 3 },
    xp: 10,
    range: 1,
    targetRules: ["closest", "fewestHitPoints", "nextOnTrack"],
  },
  /** Fast and weak: the first monster type with 2 actions (issue #83). */
  rat: {
    id: "rat",
    name: "Rat",
    label: "R",
    stats: { actions: 2, movement: 1, attackDamage: 1, hitPoints: 3 },
    xp: 4,
    range: 1,
    targetRules: ["closest", "fewestHitPoints", "nextOnTrack"],
  },
  /** Strong and patient: waits at its post until a character comes close (issue #84). */
  guard: {
    id: "guard",
    name: "Guard",
    label: "G",
    stats: { actions: 1, movement: 1, attackDamage: 2, hitPoints: 15 },
    xp: 16,
    range: 1,
    targetRules: ["closest", "fewestHitPoints", "nextOnTrack"],
    alertRange: 3,
  },
  /** Weak, but shoots from a distance at whoever it can see (issue #85). */
  archer: {
    id: "archer",
    name: "Archer",
    label: "A",
    stats: { actions: 1, movement: 1, attackDamage: 1, hitPoints: 5 },
    xp: 12,
    range: 3,
    targetRules: ["closest", "fewestHitPoints", "nextOnTrack"],
    rangedTargetRules: ["fewestHitPoints", "nextOnTrack"],
  },
  /** Slow to kill and hits hard: keeps the players away from the archers (issue #85). */
  brute: {
    id: "brute",
    name: "Brute",
    label: "B",
    stats: { actions: 1, movement: 1, attackDamage: 3, hitPoints: 20 },
    xp: 20,
    range: 1,
    targetRules: ["closest", "fewestHitPoints", "nextOnTrack"],
  },
  /** The boss of Tessa's Lair: steps and hits in one turn, as hard as a brute (issue #116). */
  tessa: {
    id: "tessa",
    name: "Tessa",
    label: "T",
    named: true,
    stats: { actions: 2, movement: 1, attackDamage: 3, hitPoints: 40 },
    xp: 50,
    range: 1,
    targetRules: ["closest", "fewestHitPoints", "nextOnTrack"],
  },
  /** Tessa's minion: a tough fighter who gets in the players' way (issue #116). */
  barbara: {
    id: "barbara",
    name: "Barbara",
    label: "Ba",
    named: true,
    stats: { actions: 1, movement: 1, attackDamage: 2, hitPoints: 20 },
    xp: 24,
    range: 1,
    targetRules: ["closest", "fewestHitPoints", "nextOnTrack"],
  },
  /** Tessa's minion: stays back and shoots, like a stronger archer (issue #116). */
  mark: {
    id: "mark",
    name: "Mark",
    label: "Ma",
    named: true,
    stats: { actions: 1, movement: 1, attackDamage: 2, hitPoints: 8 },
    xp: 24,
    range: 3,
    targetRules: ["closest", "fewestHitPoints", "nextOnTrack"],
    rangedTargetRules: ["fewestHitPoints", "nextOnTrack"],
  },
  /** A stronger rat: still 2 actions, but hits for 2 and takes twice as long to kill (issue #180). */
  wolf: {
    id: "wolf",
    name: "Wolf",
    label: "W",
    stats: { actions: 2, movement: 1, attackDamage: 2, hitPoints: 6 },
    xp: 10,
    range: 1,
    targetRules: ["closest", "fewestHitPoints", "nextOnTrack"],
  },
  /** A stronger guard: waits at its post in the same way, but hits harder and lasts longer (issue #181). */
  sentry: {
    id: "sentry",
    name: "Sentry",
    label: "S",
    stats: { actions: 1, movement: 1, attackDamage: 3, hitPoints: 25 },
    xp: 26,
    range: 1,
    targetRules: ["closest", "fewestHitPoints", "nextOnTrack"],
    alertRange: 3,
  },
  /** A stronger archer that shoots from 4 hexes away instead of 3 (issue #181). */
  crossbowman: {
    id: "crossbowman",
    name: "Crossbowman",
    label: "C",
    stats: { actions: 1, movement: 1, attackDamage: 2, hitPoints: 8 },
    xp: 16,
    range: 4,
    targetRules: ["closest", "fewestHitPoints", "nextOnTrack"],
    rangedTargetRules: ["fewestHitPoints", "nextOnTrack"],
  },
  /** A stronger brute: the hardest-hitting regular monster (issue #181). */
  ogre: {
    id: "ogre",
    name: "Ogre",
    label: "O",
    stats: { actions: 1, movement: 1, attackDamage: 4, hitPoints: 30 },
    xp: 30,
    range: 1,
    targetRules: ["closest", "fewestHitPoints", "nextOnTrack"],
  },
  /** The boss of Lotte's Hall: plays like Tessa, but hits harder and has twice her hit points (issue #184). */
  lotte: {
    id: "lotte",
    name: "Lotte",
    label: "L",
    named: true,
    stats: { actions: 2, movement: 1, attackDamage: 4, hitPoints: 80 },
    xp: 100,
    range: 1,
    targetRules: ["closest", "fewestHitPoints", "nextOnTrack"],
  },
  /**
   * Lotte's guard: the same Barbara as in Tessa's Lair, a little stronger
   * (issue #184). Other stats make it another type, with its own label, but
   * the same name.
   */
  lottesBarbara: {
    id: "lottesBarbara",
    name: "Barbara",
    label: "Bb",
    named: true,
    stats: { actions: 1, movement: 1, attackDamage: 3, hitPoints: 25 },
    xp: 30,
    range: 1,
    targetRules: ["closest", "fewestHitPoints", "nextOnTrack"],
  },
  /** Lotte's guard: the same Mark as in Tessa's Lair, a little stronger (issue #184). */
  lottesMark: {
    id: "lottesMark",
    name: "Mark",
    label: "Mk",
    named: true,
    stats: { actions: 1, movement: 1, attackDamage: 3, hitPoints: 10 },
    xp: 30,
    range: 3,
    targetRules: ["closest", "fewestHitPoints", "nextOnTrack"],
    rangedTargetRules: ["fewestHitPoints", "nextOnTrack"],
  },
};
