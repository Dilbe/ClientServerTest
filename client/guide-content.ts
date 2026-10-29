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
  MAX_RANK,
  maxLevel,
  maxXp,
  MIN_RANK,
  upgradePointsEarned,
  xpForLevel,
} from "../shared/rules/advancement.ts";
import {
  ADVANCED_CLASS_IDS,
  baseStats,
  CLASS_IDS,
  CLASS_NAMES,
  CLASSES,
  perUpgrade,
  statsOf,
  type ClassId,
} from "../shared/rules/classes.ts";
import { DIFFICULTIES, DIFFICULTY_IDS } from "../shared/rules/difficulties.ts";
import { dungeonFullXp, KILLS_UNTIL_NO_XP } from "../shared/rules/diminishing-returns.ts";
import { DUNGEON_IDS, DUNGEONS, type Dungeon, type OneTimeReward } from "../shared/rules/dungeon-map.ts";
import { REST_MINUTES } from "../shared/rules/rest.ts";
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
  const costs = Array.from({ length: UPGRADE_COSTS_SHOWN }, (_, i) => upgradeCost(classId, stat, i + 1));
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
      String(base[id]),
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
  }
  return { id: "stats", title: "Stats", blocks };
}

// ---- Classes and ranks ----

function abilitiesFromRank(classId: ClassId, rank: number): string {
  const names = CLASSES[classId].abilities.filter((a) => a.fromRank === rank).map((a) => ABILITIES[a.ability].name);
  return names.length === 0 ? "–" : names.join(", ");
}

function classesSection(): GuideSection {
  const ranks = Array.from({ length: MAX_RANK - MIN_RANK + 1 }, (_, i) => MIN_RANK + i);
  const blocks: GuideBlock[] = [
    paragraph(
      `Classes: ${CLASS_IDS.map((id) => CLASS_NAMES[id]).join(", ")}. A character's rank sets its max level ` +
        "and which abilities it has. Two characters of the same class and rank, both at their max level, " +
        "make one character of the next rank.",
    ),
    paragraph(
      `The advanced classes (${ADVANCED_CLASS_IDS.map((id) => CLASS_NAMES[id].toLowerCase()).join(", ")}) ` +
        `are made from two rank ${MAX_RANK} adventurers at their max level: you pick the class, and get a rank 1 ` +
        "character of it at level 1. They can't be bought, and reach 10 levels higher than an adventurer of the " +
        "same rank.",
    ),
  ];
  for (const classId of CLASS_IDS) {
    blocks.push(paragraph(`${CLASS_NAMES[classId]}:`), {
      kind: "table",
      headings: ["Rank", "Max level", "XP for max level", "New ability", "Price (silver)", "Rest"],
      rows: ranks.map((rank) => [
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
      "The price is that of the first adventurer of a rank. Each one bought makes the next of that rank cost " +
        `one price more; the price then drops ${ADVENTURER_PRICE_DROP_PER_DAY * 100}% a day, ` +
        "but never below the price in the table.",
    ),
    paragraph(
      "After a dungeon, a character rests for the time in the table before it can play again. One that " +
        "died first heals for as long as its rest takes, then rests.",
    ),
  );
  return { id: "classes", title: "Classes and ranks", blocks };
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
  const highest = Math.max(...CLASS_IDS.map((id) => maxLevel(id, MAX_RANK)));
  const levels = Array.from({ length: highest }, (_, i) => i + 1);
  const ranks = Array.from({ length: MAX_RANK }, (_, i) => i + 1);
  /** The rank of the class whose max level this is, or "". */
  const rankWithMax = (classId: ClassId, level: number) => String(ranks.find((r) => maxLevel(classId, r) === level) ?? "");
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

function rangeText(type: MonsterType): string {
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
    ["Range", rangeText(type)],
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
          "chooses its target with its rules in order, until only one player is left. The label is what " +
          "the map and the initiative track show, in front of the monster's number.",
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
  return `a rank ${reward.rank} ${CLASS_NAMES[reward.class].toLowerCase()} at level ${reward.level}`;
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
      ["Silver for a win", String(dungeon.silverReward)],
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
          "one-time reward on top of the silver.",
      ),
      { kind: "cards", cards: DUNGEON_IDS.map((id, i) => dungeonCard(DUNGEONS[id], i)) },
    ],
  };
}

/** The whole guide, in the order the page shows it. */
export function guideSections(): GuideSection[] {
  return [
    statsSection(),
    classesSection(),
    abilitiesSection(),
    levelsSection(),
    monstersSection(),
    difficultiesSection(),
    dungeonsSection(),
  ];
}
