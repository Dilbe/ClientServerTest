// What the game guide shows (design.md, The game guide), as plain data: the
// sections with their paragraphs, tables and cards. guide.ts turns this into
// HTML. Kept apart from the DOM so the tests can run it in Node.
//
// Everything comes from the same shared rule data the server uses, so the
// guide can never disagree with the game: changing a monster's hit points
// changes the guide too.

import {
  ABILITIES,
  ABILITY_IDS,
  abilityStats,
  type AbilityId,
  type AbilityUpgradeId,
} from "../shared/rules/abilities.ts";
import {
  ADVENTURER_BASE_PRICES,
  ADVENTURER_PRICE_DROP_PER_DAY,
  adventurerPrice,
  DAY_MS,
  MAX_ADVENTURER_RANK,
  maxLevel,
  maxRank,
  maxXp,
  MIN_RANK,
  minRank,
  nextAdventurerPrice,
  upgradePointsEarned,
  xpForLevel,
} from "../shared/rules/advancement.ts";
import {
  ADVANCED_CLASS_IDS,
  baseStats,
  CLASS_IDS,
  CLASS_NAMES,
  CLASSES,
  classRange,
  classStat,
  perUpgrade,
  rangeText,
  statsOf,
  type ClassId,
} from "../shared/rules/classes.ts";
import { DIFFICULTIES, DIFFICULTY_IDS } from "../shared/rules/difficulties.ts";
import { dungeonFullXp, KILLS_UNTIL_NO_XP } from "../shared/rules/diminishing-returns.ts";
import { DUNGEON_IDS, DUNGEONS, winRewardText, type Dungeon, type OneTimeReward } from "../shared/rules/dungeon-map.ts";
import { REST_MINUTES } from "../shared/rules/rest.ts";
import {
  BUILDING_IDS,
  BUILDINGS,
  CLASS_BONUSES,
  costText,
  earnedPerHour,
  HOUR_MS,
  marketAmount,
  marketJobMs,
  marketSilver,
  TRADING_POST_FLOOR_TENTHS_PER_RANK,
  TRADING_POST_JOB_MS_PER_LEVEL,
  RECRUITING_JOB_MS,
  RECRUITING_MIN_RANK,
  TRADING_POST_TENTHS_PER_LEVEL,
  maxBuildingLevel,
  TRAINING_JOB_MS,
  TRAINING_XP_PER_HOUR,
  upgradeCost as buildingUpgradeCost,
  type BuildingId,
} from "../shared/rules/village.ts";
import {
  MONSTER_TYPE_IDS,
  MONSTER_TYPES,
  STATS,
  TARGET_RULES,
  UPGRADABLE_STAT_IDS,
  type MonsterType,
  type MonsterTypeId,
  type StatId,
  type TargetRuleId,
} from "../shared/rules/stats.ts";
import { abilityUpgradeCost, upgradeCost } from "../shared/rules/upgrades.ts";

/** A table: one heading per column, and rows of the same length. */
export interface GuideTable {
  kind: "table";
  headings: string[];
  rows: string[][];
}

/**
 * One thing with its facts as name and value pairs, such as a monster type.
 * A list of values is a numbered list: rules applied in order.
 */
export interface GuideCard {
  /** For a link to it: `#/guide` stays the address, so this is only an element id. */
  id: string;
  title: string;
  text?: string;
  facts: GuideFact[];
}

export type GuideFact = [name: string, value: string | string[]];

export type GuideBlock = { kind: "paragraph"; text: string } | GuideTable | { kind: "cards"; cards: GuideCard[] };

export interface GuideSection {
  id: string;
  title: string;
  blocks: GuideBlock[];
}

/** How many upgrade costs the stats table lists; the rule after them says how it goes on. */
const UPGRADE_COSTS_SHOWN = 5;

const paragraph = (text: string): GuideBlock => ({ kind: "paragraph", text });

/** "1 turn", "2 turns". */
function count(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

// ---- Stats ----

function statUpgradeCosts(classId: ClassId, stat: StatId): string {
  if (!(UPGRADABLE_STAT_IDS as readonly StatId[]).includes(stat)) return "Can't be upgraded yet";
  // A stat with a limit shows every upgrade it has, like the ranger's range: "15, 60 (at most 2)".
  const limit = classStat(classId, stat).maxUpgrades;
  const costs = Array.from({ length: Math.min(limit ?? Infinity, UPGRADE_COSTS_SHOWN) }, (_, i) => upgradeCost(classId, stat, i + 1));
  if (limit !== undefined) return `${costs.join(", ")} (at most ${limit})`;
  const amount = perUpgrade(classId, stat);
  return `${costs.join(", ")}, …${amount === 1 ? "" : ` (+${amount} each)`}`;
}

/** The stats of a class, with what they start at and cost: only the ones it has (healing power only for a healer). */
function statsTable(classId: ClassId): GuideTable {
  const base = baseStats(classId);
  return {
    kind: "table",
    headings: ["Stat", "What it does", "Start", "Upgrade costs (points)"],
    rows: statsOf(classId).map((id) => [
      STATS[id].name,
      STATS[id].description,
      // The range shows both ends, like "2–3" (design.md, Ranged attacks for characters).
      id === "range" ? rangeText(classRange(classId, base)) : String(base[id]),
      statUpgradeCosts(classId, id),
    ]),
  };
}

function statsSection(): GuideSection {
  // A class with stats of its own gets a table of its own; the others use the adventurer's.
  const own = CLASS_IDS.filter((id) => id !== "adventurer" && CLASSES[id].stats !== CLASSES.adventurer.stats);
  const others = CLASS_IDS.filter((id) => id !== "adventurer" && !own.includes(id));
  const blocks: GuideBlock[] = [
    paragraph(
      "Every character of a class starts with the same stats. Each level gives upgrade points to spend on them " +
        "(see Levels and XP); every upgrade of a stat adds 1 to it, unless the table says otherwise, and " +
          "costs as much as or more than the one before.",
    ),
    paragraph(
      others.length === 0
        ? "Adventurer:"
        : `Adventurer, and for now also ${others.map((id) => CLASS_NAMES[id].toLowerCase()).join(", ")}:`,
    ),
    statsTable("adventurer"),
  ];
  for (const id of own) {
    blocks.push(paragraph(`${CLASS_NAMES[id]}:`), statsTable(id));
    if (CLASSES[id].halfMeleeDamage) {
      blocks.push(
        paragraph(
          `A ${CLASS_NAMES[id].toLowerCase()}'s melee attacks do half its attack damage, rounded down; ` +
            "its spells do the full attack damage.",
        ),
      );
    }
    const shortest = CLASSES[id].shortestRange;
    if (shortest !== undefined) {
      const range = rangeText(classRange(id, baseStats(id)));
      blocks.push(
        paragraph(
          `A ${CLASS_NAMES[id].toLowerCase()}'s attacks are shots: they hit the monster on a hex ${range} hexes away, ` +
            `in line of sight, but never one closer than ${shortest} hexes. Walls, pillars, closed doors and monsters ` +
            "block a shot; characters don't. Every other class attacks a monster next to it.",
        ),
      );
    }
  }
  return { id: "stats", title: "Stats", blocks };
}

// ---- Classes and ranks ----

function abilitiesFromRank(classId: ClassId, rank: number): string {
  const names = CLASSES[classId].abilities.filter((a) => a.fromRank === rank).map((a) => ABILITIES[a.ability].name);
  return names.length === 0 ? "–" : names.join(", ");
}

/** The ranks of a class, lowest first: 1 to 5 for an adventurer, 6 to 10 for an advanced class. */
function ranksOf(classId: ClassId): number[] {
  return Array.from({ length: maxRank(classId) - minRank(classId) + 1 }, (_, i) => minRank(classId) + i);
}

function classesSection(): GuideSection {
  const firstAdvanced = minRank(ADVANCED_CLASS_IDS[0]);
  const blocks: GuideBlock[] = [
    paragraph(
      `Classes: ${CLASS_IDS.map((id) => CLASS_NAMES[id]).join(", ")}. A character's rank sets its max level ` +
        "and which abilities it has. Two characters of the same class and rank, both at their max level, " +
        "make one character of the next rank.",
    ),
    paragraph(
      `The advanced classes (${ADVANCED_CLASS_IDS.map((id) => CLASS_NAMES[id].toLowerCase()).join(", ")}) ` +
        `are made from two rank ${MAX_ADVENTURER_RANK} adventurers at their max level: you pick the class, and get ` +
        `a rank ${firstAdvanced} character of it at level 1. Their ranks go from ${firstAdvanced} to ` +
        `${maxRank(ADVANCED_CLASS_IDS[0])}. They can't be bought.`,
    ),
  ];
  for (const classId of CLASS_IDS) {
    blocks.push(paragraph(`${CLASS_NAMES[classId]}:`), {
      kind: "table",
      headings: ["Rank", "Max level", "XP for max level", "New ability", "Price (silver)", "Rest"],
      rows: ranksOf(classId).map((rank) => [
        String(rank),
        String(maxLevel(classId, rank)),
        String(maxXp(classId, rank)),
        abilitiesFromRank(classId, rank),
        // Only adventurers can be bought (design.md, Advanced classes).
        classId === "adventurer" ? String(ADVENTURER_BASE_PRICES[rank]) : "–",
        `${REST_MINUTES[rank]} min`,
      ]),
    });
  }
  blocks.push(
    paragraph(
      "The price is that of the first adventurer of a rank; buying more makes it go up (see Buying characters).",
    ),
    paragraph(
      "After a dungeon, a character rests for the time in the table before it can play again. One that " +
        "died first heals for as long as its rest takes, then rests.",
    ),
  );
  return { id: "classes", title: "Classes and ranks", blocks };
}

// ---- Buying characters ----

/** The daily drops the example table shows: the 2nd purchase right away, 1 day later and 2 days later. */
const EXAMPLE_DAYS = [0, 1, 2];

/** What the 2nd adventurer of a rank costs, `days` full days after buying the 1st for its base price. */
function secondPrice(rank: number, days: number): number {
  const first = ADVENTURER_BASE_PRICES[rank]!;
  return adventurerPrice(rank, { nextPrice: nextAdventurerPrice(rank, first), boughtAt: 0 }, days * DAY_MS);
}

function buyingSection(): GuideSection {
  const ranks = ranksOf("adventurer");
  const drop = ADVENTURER_PRICE_DROP_PER_DAY * 100;
  // The worked example follows rank 2: buy one, wait 2 days, buy the next.
  const rank = 2;
  const base = ADVENTURER_BASE_PRICES[rank]!;
  const waited = secondPrice(rank, 2);
  const dayLabel = (days: number) => (days === 0 ? "2nd, bought right away" : `2nd, ${count(days, "day")} later`);
  return {
    id: "buying",
    title: "Buying characters",
    blocks: [
      paragraph(
        `You can buy an adventurer of any rank, ${MIN_RANK} to ${MAX_ADVENTURER_RANK}, for silver on the characters page. ` +
          "The advanced classes can't be bought. A bought adventurer starts at level 1 with 0 XP and no " +
          "upgrades, with the abilities of its rank.",
      ),
      paragraph(
        "The first adventurer of a rank costs its base price. Each one you buy makes the next of that rank " +
          "cost what you paid plus the base price. Each rank counts only its own purchases: buying a rank 1 " +
          "never changes the price of a rank 2. Starting characters, rewards, recruits and rank-ups never " +
          "change a price.",
      ),
      paragraph(
        `The price then drops ${drop}% for each full day (24 hours) since the last purchase of that rank, ` +
          "rounded to whole silver, but never below the base price. The drop is always worked out from the " +
          "price right after that purchase, so the rounding doesn't add up over the days.",
      ),
      paragraph("What the first and second adventurer of each rank cost, in silver:"),
      {
        kind: "table",
        headings: ["Rank", "Base price (1st)", ...EXAMPLE_DAYS.map(dayLabel)],
        rows: ranks.map((r) => [
          String(r),
          String(ADVENTURER_BASE_PRICES[r]),
          ...EXAMPLE_DAYS.map((days) => String(secondPrice(r, days))),
        ]),
      },
      paragraph(
        `Example, rank ${rank}: buy one for ${base}, and the next costs ${nextAdventurerPrice(rank, base)}. ` +
          `Wait 2 days and buy it for ${waited}; the next one then costs ${waited} + ${base} = ` +
          `${nextAdventurerPrice(rank, waited)}, and drops from there. Waiting pays off; buying a lot in a ` +
          "short time gets expensive.",
      ),
      paragraph(
        "A character that finishes its job in the village's trading post lowers these prices further, " +
          "even below the base price (see Village).",
      ),
    ],
  };
}

// ---- Abilities ----

function unlockedBy(ability: AbilityId): string {
  const by = CLASS_IDS.flatMap((classId) =>
    CLASSES[classId].abilities.filter((a) => a.ability === ability).map((a) => `${CLASS_NAMES[classId]} rank ${a.fromRank}`),
  );
  return by.length === 0 ? "No class yet" : by.join(", ");
}

/** What one step of each ability upgrade is, for "+1 hex of range". */
const UPGRADE_UNITS: Record<AbilityUpgradeId, string> = {
  cooldown: "turn of cooldown",
  range: "hex of range",
  charges: "charge per turn",
  blockedDamage: "damage blocked per charge",
  healing: "hit point healed per turn",
  duration: "turn of healing",
  length: "hex of length",
};

/** "−1 turn of cooldown: 10, 40, 90 points" for every upgrade the ability has. */
function abilityUpgrades(ability: AbilityId): [string, string][] {
  const facts: [string, string][] = [];
  for (const [upgrade, definition] of Object.entries(ABILITIES[ability].upgrades)) {
    if (!definition) continue;
    const id = upgrade as AbilityUpgradeId;
    const costs = Array.from({ length: definition.maxUpgrades }, (_, i) => abilityUpgradeCost(ability, id, i + 1));
    const what = definition.unit ?? UPGRADE_UNITS[id];
    facts.push([
      `Upgrade: ${definition.step} ${what}`,
      `${count(definition.maxUpgrades, "time")}, costs ${costs.join(", ")} points`,
    ]);
  }
  return facts;
}

/**
 * The stats of a new character of the first class that unlocks the ability,
 * for the damage on its card: a caster's spells start at 2, an adventurer's
 * abilities at 1.
 */
function statsFor(ability: AbilityId) {
  const classId = CLASS_IDS.find((id) => CLASSES[id].abilities.some((a) => a.ability === ability)) ?? "adventurer";
  return baseStats(classId);
}

function abilitiesSection(): GuideSection {
  return {
    id: "abilities",
    title: "Abilities",
    blocks: [
      paragraph(
        "Abilities are actions that a higher rank unlocks. They are planned from the action menu " +
          "(press and hold a hex, or right-click it). After using one, the character can't use it again " +
          "for its cooldown: that many of its own next turns. A passive ability works by itself: it takes " +
          "no action and has no cooldown.",
      ),
      {
        kind: "cards",
        cards: ABILITY_IDS.map((id) => ({
          id: `ability-${id}`,
          title: ABILITIES[id].name,
          text: ABILITIES[id].description,
          facts: [
            ["Unlocked by", unlockedBy(id)],
            ...abilityStats(id, statsFor(id)).map((row): [string, string] => [row.name, row.value]),
            ABILITIES[id].passive
              ? ["Per plan", "never: it works by itself"]
              : ["Per plan", `at most ${ABILITIES[id].maxPerPlan}`],
            ...abilityUpgrades(id),
          ],
        })),
      },
      paragraph(
        "Damage is shown for a new character of the class that unlocks the ability; it grows with attack damage.",
      ),
    ],
  };
}

// ---- Levels and XP ----

function levelsSection(): GuideSection {
  const highest = Math.max(...CLASS_IDS.map((id) => maxLevel(id, maxRank(id))));
  const levels = Array.from({ length: highest }, (_, i) => i + 1);
  /** The rank of the class whose max level this is, or "". */
  const rankWithMax = (classId: ClassId, level: number) =>
    String(ranksOf(classId).find((r) => maxLevel(classId, r) === level) ?? "");
  return {
    id: "levels",
    title: "Levels and XP",
    blocks: [
      paragraph(
        "Every character in the game gains XP when a monster dies. Reaching a level gives as many upgrade " +
          "points as the level. A character stops gaining XP at the max level of its rank. Each kill of the " +
          "same monster gives a character less XP the next time, " +
          `until it gives none after ${KILLS_UNTIL_NO_XP} kills.`,
      ),
      {
        kind: "table",
        headings: ["Level", "Total XP", "Upgrade points (total)", "Max level of adventurer rank", "Max level of advanced rank"],
        rows: levels.map((level) => [
          String(level),
          String(xpForLevel(level)),
          String(upgradePointsEarned(level)),
          rankWithMax("adventurer", level),
          rankWithMax(ADVANCED_CLASS_IDS[0], level),
        ]),
      },
    ],
  };
}

// ---- Monsters ----

function targetTexts(rules: readonly TargetRuleId[]): string[] {
  return rules.map((rule) => TARGET_RULES[rule].description);
}

function monsterRangeText(type: MonsterType): string {
  return type.range === 1 ? "1 (only next to it)" : `${type.range} hexes, in line of sight`;
}

/** The dungeons a monster type is in, in the order they are cleared. */
function dungeonsWith(typeId: MonsterTypeId): string {
  const names = DUNGEON_IDS.filter((id) => DUNGEONS[id].map.monsters.some((m) => m.type === typeId)).map(
    (id) => DUNGEONS[id].name,
  );
  return names.length === 0 ? "None" : names.join(", ");
}

function monsterCard(typeId: MonsterTypeId): GuideCard {
  const type = MONSTER_TYPES[typeId];
  const facts: GuideFact[] = [
    ["Hit points", String(type.stats.hitPoints)],
    ["Attack damage", String(type.stats.attackDamage)],
    ["Actions", String(type.stats.actions)],
    ["Movement", String(type.stats.movement)],
    ["Range", monsterRangeText(type)],
    ["XP", String(type.xp)],
    [
      "Alert range",
      type.alertRange === undefined
        ? "None: awake from the start"
        : `${count(type.alertRange, "hex", "hexes")}: on guard until a character comes this close or it is attacked`,
    ],
  ];
  if (type.rangedTargetRules) {
    facts.push(
      ["Shoots at, without moving", targetTexts(type.rangedTargetRules)],
      ["If it can't, moves towards", targetTexts(type.targetRules)],
    );
  } else {
    facts.push(["Targets", targetTexts(type.targetRules)]);
  }
  facts.push(["Found in", dungeonsWith(typeId)]);
  return {
    id: `monster-${typeId}`,
    // The label tells apart types with the same name, like Tessa's and Lotte's Barbara.
    title: `${type.name} (${type.label})`,
    facts,
  };
}

function monstersSection(): GuideSection {
  return {
    id: "monsters",
    title: "Monsters",
    blocks: [
      paragraph(
        "The stats are those on Normal; harder difficulties multiply them (see Difficulties). A monster " +
          "chooses its target with its rules in order, until only one player is left. The label in " +
          "brackets tells apart types with the same name.",
      ),
      { kind: "cards", cards: MONSTER_TYPE_IDS.map(monsterCard) },
    ],
  };
}

// ---- Difficulties ----

function difficultiesSection(): GuideSection {
  return {
    id: "difficulties",
    title: "Difficulties",
    blocks: [
      paragraph(
        "A harder difficulty uses the same dungeons and monsters, but multiplies the monsters' stats and " +
          "the XP they give. Range, alert range, movement and targeting stay the same. A difficulty is " +
          "unlocked by clearing every dungeon on the one before it.",
      ),
      {
        kind: "table",
        headings: ["Difficulty", "Monster actions", "Monster attack damage", "Monster hit points", "XP"],
        rows: DIFFICULTY_IDS.map((id) => {
          const d = DIFFICULTIES[id];
          return [d.name, `× ${d.monsterActions}`, `× ${d.monsterAttackDamage}`, `× ${d.monsterHitPoints}`, `× ${d.monsterXp}`];
        }),
      },
    ],
  };
}

// ---- Dungeons ----

/** "3 × Rat, 1 × Guard (G)", in the order they first appear on the map. */
function monsterList(dungeon: Dungeon): string {
  const counts = new Map<MonsterTypeId, number>();
  for (const { type } of dungeon.map.monsters) counts.set(type, (counts.get(type) ?? 0) + 1);
  return [...counts].map(([type, n]) => `${n} × ${MONSTER_TYPES[type].name} (${MONSTER_TYPES[type].label})`).join(", ");
}

function rewardText(reward: OneTimeReward): string {
  switch (reward.type) {
    case "newCharacter":
      return `a rank ${reward.rank} ${CLASS_NAMES[reward.class].toLowerCase()} at level ${reward.level}`;
    case "village":
      return "the village";
  }
}

function dungeonCard(dungeon: Dungeon, index: number): GuideCard {
  const map = dungeon.map;
  return {
    id: `dungeon-${dungeon.id}`,
    title: `${index + 1}. ${dungeon.name}`,
    facts: [
      ["Characters", `at most ${dungeon.maxCharacters}`],
      ["Start hexes", String(map.startHexes.length)],
      ["Doors", String(map.doors.length)],
      ["Monsters", monsterList(dungeon)],
      ...DIFFICULTY_IDS.map((id): [string, string] => [`Every win on ${DIFFICULTIES[id].name}`, winRewardText(dungeon.winRewards[id])]),
      ["XP for all monsters", DIFFICULTY_IDS.map((id) => `${dungeonFullXp(map, id)} on ${DIFFICULTIES[id].name}`).join(", ")],
      ...DIFFICULTY_IDS.map((id): [string, string] => {
        const rewards = dungeon.oneTimeRewards[id];
        return [
          `First win on ${DIFFICULTIES[id].name}`,
          rewards.length === 0 ? "Nothing extra" : rewards.map(rewardText).join(", "),
        ];
      }),
    ],
  };
}

function dungeonsSection(): GuideSection {
  return {
    id: "dungeons",
    title: "Dungeons",
    blocks: [
      paragraph(
        "The dungeons are cleared one by one, in this order, on each difficulty. A player can play every " +
          "dungeon they have cleared, plus the next one. The first win of a dungeon on a difficulty gives a " +
          "one-time reward on top of what every win gives.",
      ),
      { kind: "cards", cards: DUNGEON_IDS.map((id, i) => dungeonCard(DUNGEONS[id], i)) },
    ],
  };
}

// ---- The village ----

/** The dungeon and difficulty whose first win gives the village, like "Tessa's Lair on Normal". */
function villageUnlock(): string {
  for (const id of DUNGEON_IDS) {
    for (const difficulty of DIFFICULTY_IDS) {
      if (DUNGEONS[id].oneTimeRewards[difficulty].some((r) => r.type === "village")) {
        return `${DUNGEONS[id].name} on ${DIFFICULTIES[difficulty].name}`;
      }
    }
  }
  return "nothing yet";
}

/** What a building does, with the numbers. */
function buildingText(id: BuildingId): string {
  const { earns, speedsUp, cutsRest, sellsResources, lowersHeroPrices, recruits } = BUILDINGS[id];
  if (recruits) {
    return (
      `Only a character of rank ${RECRUITING_MIN_RANK} or higher can work here, so every advanced class can. ` +
      "When it finishes its job, you get a new level 1, rank 1 adventurer for " +
      `each rank it is above rank ${RECRUITING_MIN_RANK - 1}: a rank 3 adventurer recruits 1, a rank 7 tank 5. ` +
      "Taken out early, it recruits no one."
    );
  }
  if (lowersHeroPrices) {
    return (
      "When a character finishes its job in the trading post, the price of buying an adventurer of every rank " +
      `goes down by ${TRADING_POST_TENTHS_PER_LEVEL / 10}% per level of that character, rounded up to whole silver. ` +
      "The lower price stays until you buy one of that rank, and the daily drop goes on from it. " +
      `It can go below the first price, but never more than ${TRADING_POST_FLOOR_TENTHS_PER_RANK / 10}% per rank ` +
      "of that character. Taken out early, it lowers nothing."
    );
  }
  if (sellsResources) {
    return (
      `A character in the market sells ${marketAmount(1)} wood or stone per level, taken when it goes in, for ` +
      `${marketSilver({ class: "adventurer", rank: 1 }, 1)} silver per resource per rank. The silver comes only if it stays the full time; ` +
      "taken out early, it gives no silver, but you get the wood or stone back."
    );
  }
  if (cutsRest) {
    return (
      "A character in the pub cuts the rest of another character at once, by its level × rank minutes: only " +
      "resting, not healing, but of any rank. It can't be taken out early."
    );
  }
  if (speedsUp) {
    const what = speedsUp === "healing" ? "Healing (after dying in a dungeon)" : "Resting";
    return (
      `${what} goes faster for all your characters while a character is in here, also when it has started ` +
      "already: +100% per rank of that character."
    );
  }
  if (earns === "xp") {
    return (
      `Characters training here gain ${TRAINING_XP_PER_HOUR} XP for every full hour, up to their max level. ` +
      "The trainer gains no XP, but makes training faster for lower-ranked characters: +100% per rank of " +
      "difference. An advanced class trainer only trains adventurers and its own class."
    );
  }
  return `Earns ${earns}: ${earnedPerHour({ class: "adventurer", rank: 1 }, id)} per rank of the character for every full hour it works.`;
}

function jobLengthText(id: BuildingId): string {
  const { earns, cutsRest, sellsResources, lowersHeroPrices, recruits } = BUILDINGS[id];
  if (cutsRest) return "As long as the rest it cut";
  if (recruits) return `${RECRUITING_JOB_MS / (24 * HOUR_MS)} days ÷ the level of the character`;
  if (lowersHeroPrices) return `${TRADING_POST_JOB_MS_PER_LEVEL / 60_000} minutes per level of the character`;
  if (sellsResources) return `${marketJobMs({ class: "adventurer", rank: 1 }, 1) / 60_000} minutes × rank × level of the character`;
  const perLevel = "1 hour per level of the character";
  return earns === "xp"
    ? `${TRAINING_JOB_MS / HOUR_MS} hours, or until the max level; the trainer ${perLevel}`
    : perLevel;
}

function buildingCard(id: BuildingId): GuideCard {
  const building = BUILDINGS[id];
  return {
    id: `building-${id}`,
    title: building.name,
    text: buildingText(id),
    facts: [
      ["Job length", jobLengthText(id)],
      ["Build cost", building.buildCost ? costText(building.buildCost) : "You start with it"],
      ["Max level", String(maxBuildingLevel(id))],
      ...(building.trainerSlot ? [["Trainer slot", "1, on top of the training slots"] as GuideFact] : []),
    ],
  };
}

/** One row per class bonus in the village: the class, the building and how much. */
function classBonusRows(): string[][] {
  return CLASS_IDS.flatMap((classId) =>
    BUILDING_IDS.flatMap((building) => {
      const percent = CLASS_BONUSES[classId]?.[building];
      return percent ? [[CLASSES[classId].name, BUILDINGS[building].name, `+${percent}%`]] : [];
    }),
  );
}

function villageSection(): GuideSection {
  const levels = BUILDING_IDS.flatMap((id) =>
    Array.from({ length: maxBuildingLevel(id) }, (_, i) => {
      const level = i + 1;
      const cost = level === 1 ? BUILDINGS[id].buildCost : buildingUpgradeCost(id, i);
      return [BUILDINGS[id].name, String(level), cost ? costText(cost) : "–", String(BUILDINGS[id].slots(level))];
    }),
  );
  return {
    id: "village",
    title: "Village",
    blocks: [
      paragraph(
        `The first win of ${villageUnlock()} gives the village. Characters can work in its buildings ` +
          "between dungeons; a character at work can't go into a dungeon. When its job is done, it rests, " +
          "as after a dungeon (see Classes and ranks). Only full hours count: a character taken out early " +
          "keeps what it earned in the hours it finished.",
      ),
      { kind: "cards", cards: BUILDING_IDS.map(buildingCard) },
      paragraph(
        "What it costs to get each level of a building, by building it (level 1) or upgrading it, and how " +
          "many characters can work in it at that level:",
      ),
      { kind: "table", headings: ["Building", "Level", "Cost", "Slots"], rows: levels },
      paragraph(
        "Some classes get a bonus in one building: it makes what the character gives there " +
          "bigger, the wood or stone an hour, or the speed-up. In the training house only the trainer gets " +
          "it. The result is rounded up.",
      ),
      { kind: "table", headings: ["Class", "Building", "Bonus"], rows: classBonusRows() },
    ],
  };
}

/** The whole guide, in the order the page shows it. */
export function guideSections(): GuideSection[] {
  return [
    statsSection(),
    classesSection(),
    buyingSection(),
    abilitiesSection(),
    levelsSection(),
    monstersSection(),
    difficultiesSection(),
    dungeonsSection(),
    villageSection(),
  ];
}
