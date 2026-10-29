import { test } from "node:test";
import assert from "node:assert/strict";
import { ABILITIES, ABILITY_IDS } from "../shared/rules/abilities.ts";
import { MAX_RANK, maxLevel } from "../shared/rules/advancement.ts";
import { CLASS_IDS, CLASS_NAMES } from "../shared/rules/classes.ts";
import { DIFFICULTIES, DIFFICULTY_IDS } from "../shared/rules/difficulties.ts";
import { DUNGEON_IDS, DUNGEONS } from "../shared/rules/dungeon-map.ts";
import { MONSTER_TYPE_IDS, MONSTER_TYPES, STAT_IDS, STATS } from "../shared/rules/stats.ts";
import { guideSections, type GuideCard, type GuideSection, type GuideTable } from "./guide-content.ts";

const sections = guideSections();

function section(id: string): GuideSection {
  const found = sections.find((s) => s.id === id);
  assert.ok(found, `no section ${id}`);
  return found;
}

function tables(id: string): GuideTable[] {
  return section(id).blocks.filter((b): b is GuideTable => b.kind === "table");
}

function cards(id: string): GuideCard[] {
  return section(id).blocks.flatMap((b) => (b.kind === "cards" ? b.cards : []));
}

function fact(card: GuideCard, name: string): string | string[] {
  const found = card.facts.find(([n]) => n === name);
  assert.ok(found, `${card.title} has no ${name}`);
  return found[1];
}

/** All the text of the guide, to check that something appears somewhere. */
const allText = JSON.stringify(sections);

test("every stat, class, ability, monster type, difficulty and dungeon in the data is in the guide", () => {
  // Adding an entry to the data must never leave it out of the guide.
  // Every stat is in the table of at least one class: healing power only in the healer's.
  const stats = new Set(tables("stats").flatMap((table) => table.rows.map((row) => row[0])));
  assert.deepEqual([...stats].sort(), STAT_IDS.map((id) => STATS[id].name).sort());
  for (const id of CLASS_IDS) assert.ok(allText.includes(CLASS_NAMES[id]));
  assert.deepEqual(cards("abilities").map((c) => c.title), ABILITY_IDS.map((id) => ABILITIES[id].name));
  assert.deepEqual(
    cards("monsters").map((c) => c.id),
    MONSTER_TYPE_IDS.map((id) => `monster-${id}`),
  );
  assert.deepEqual(tables("difficulties")[0]!.rows.map((row) => row[0]), DIFFICULTY_IDS.map((id) => DIFFICULTIES[id].name));
  assert.deepEqual(cards("dungeons").map((c) => c.title), DUNGEON_IDS.map((id, i) => `${i + 1}. ${DUNGEONS[id].name}`));
});

test("every table row has a cell for every heading", () => {
  for (const s of sections) {
    for (const table of tables(s.id)) {
      for (const row of table.rows) assert.equal(row.length, table.headings.length, `${s.title}: ${row.join(" | ")}`);
    }
  }
});

test("the stats table lists the start value and the first upgrade costs", () => {
  const [actions, movement] = tables("stats")[0]!.rows;
  // 20 × n², the first five upgrades.
  assert.deepEqual(actions, ["Actions", "Actions done per turn.", "1", "20, 80, 180, 320, 500, …"]);
  assert.equal(movement![3], "Can't be upgraded yet");
  // The tank has stats of its own, with 2 hit points per upgrade.
  const tank = tables("stats")[1]!.rows;
  assert.deepEqual(tank.at(-1), ["Hit points", "Damage that can be taken before dying.", "20", "1, 1, 2, 2, 3, … (+2 each)"]);
  assert.equal(tank[0]![3], "80, 180, 320, 500, 720, …");
  // So has the caster, with a note on its melee damage after its table.
  const caster = tables("stats")[4]!.rows;
  assert.deepEqual(caster.map((row) => row[2]), ["1", "1", "2", "6"]);
  assert.equal(caster[2]![3], "4, 12, 21, 32, 45, …");
  assert.ok(allText.includes("A caster's melee attacks do half its attack damage, rounded down"));
});

test("the healer's stats table has healing power and its own costs; the others don't have healing power", () => {
  const healerIndex = tables("stats").findIndex((t) => t.rows.some((row) => row[0] === "Healing power"));
  const healer = tables("stats")[healerIndex]!.rows;
  assert.deepEqual(healer.map((row) => [row[0], row[2]]), [
    ["Actions", "1"],
    ["Movement", "2"],
    ["Attack damage", "1"],
    ["Hit points", "8"],
    ["Healing power", "3"],
  ]);
  assert.equal(healer[4]![3], "5, 16, 29, 46, 66, …");
  assert.equal(healer[2]![3], "8, 25, 47, 74, 106, …");
  assert.equal(tables("stats").filter((t) => t.rows.some((row) => row[0] === "Healing power")).length, 1);
});

test("the ranger's stats table has its range of 2 to 3, with both range upgrades; the others have no range row", () => {
  const withRange = tables("stats").filter((t) => t.rows.some((row) => row[0] === "Range"));
  assert.equal(withRange.length, 1);
  const ranger = withRange[0]!.rows;
  assert.deepEqual(ranger.map((row) => [row[0], row[2]]), [
    ["Actions", "1"],
    ["Movement", "1"],
    ["Attack damage", "1"],
    ["Hit points", "8"],
    ["Range", "2–3"],
  ]);
  assert.equal(ranger[2]![3], "6, 17, 32, 48, 68, …");
  assert.equal(ranger[4]![3], "15, 60 (at most 2)");
});

test("an ability's damage on its card is that of a new character of its class", () => {
  const card = (id: string) => cards("abilities").find((c) => c.id === `ability-${id}`)!;
  assert.equal(fact(card("heavyStrike"), "Damage"), "2");
  // A caster starts with attack damage 2.
  assert.match(String(fact(card("fireball"), "Damage")), /^2 to every monster/);
  assert.equal(fact(card("fireball"), "Upgrade: +1 charge per game"), "3 times, costs 10, 29, 52 points");
});

test("the ranks table shows the max level, the new abilities and the price of each rank", () => {
  const rows = tables("classes")[0]!.rows;
  assert.equal(rows.length, MAX_RANK);
  assert.deepEqual(rows[0], ["1", "10", "225", "–", "10", "5 min"]);
  assert.deepEqual(rows[1]!.slice(0, 5), ["2", "20", "950", "Heavy strike", "90"]);
  // An advanced class can't be bought, and its max level is 10 higher.
  const tank = tables("classes")[CLASS_IDS.indexOf("tank")]!.rows;
  assert.deepEqual(tank[0]!.slice(0, 2), ["1", "20"]);
  assert.equal(tank[0]![4], "–");
});

test("an ability card says which rank unlocks it and what its upgrades cost", () => {
  const charge = cards("abilities").find((c) => c.id === "ability-charge")!;
  assert.equal(fact(charge, "Unlocked by"), "Adventurer rank 3");
  assert.equal(fact(charge, "Range"), "2 to 4 hexes");
  assert.equal(fact(charge, "Cooldown"), "4 turns");
  assert.equal(fact(charge, "Upgrade: −1 turn of cooldown"), "3 times, costs 10, 40, 90 points");
  assert.equal(fact(charge, "Upgrade: +1 hex of range"), "2 times, costs 5, 15 points");
});

test("the levels table goes up to the highest max level", () => {
  const rows = tables("levels")[0]!.rows;
  // An advanced class reaches 10 levels higher than an adventurer.
  assert.equal(rows.length, maxLevel("tank", MAX_RANK));
  assert.deepEqual(rows[0], ["1", "0", "0", "", ""]);
  assert.deepEqual(rows[9], ["10", "225", "54", "1", ""]);
  assert.deepEqual(rows[19]!.slice(3), ["2", "1"]);
  assert.deepEqual(rows[59]!.slice(3), ["", "5"]);
});

test("a monster card shows its stats, how it targets and where it is found", () => {
  const monsters = cards("monsters");
  const rat = monsters.find((c) => c.id === "monster-rat")!;
  assert.equal(rat.title, "Rat (R)");
  assert.equal(fact(rat, "Actions"), String(MONSTER_TYPES.rat.stats.actions));
  assert.equal(fact(rat, "Alert range"), "None: awake from the start");
  assert.ok(fact(rat, "Targets")[0]!.startsWith("The player it can reach"));
  assert.ok(fact(rat, "Found in").includes(DUNGEONS.warren.name));

  const guard = monsters.find((c) => c.id === "monster-guard")!;
  assert.ok((fact(guard, "Alert range") as string).startsWith("3 hexes:"));

  const archer = monsters.find((c) => c.id === "monster-archer")!;
  assert.equal(fact(archer, "Range"), "3 hexes, in line of sight");
  assert.equal(fact(archer, "Shoots at, without moving")[0], "The player with the fewest hit points.");
  assert.ok(fact(archer, "If it can't, moves towards")[0]!.startsWith("The player it can reach"));

  // Tessa's and Lotte's Barbara share a name; the label tells them apart.
  const barbaras = monsters.filter((c) => c.title.startsWith("Barbara"));
  assert.equal(new Set(barbaras.map((c) => c.title)).size, barbaras.length);
});

test("a dungeon card lists its monsters and rewards", () => {
  const first = cards("dungeons")[0]!;
  assert.equal(fact(first, "Characters"), `at most ${DUNGEONS.first.maxCharacters}`);
  assert.equal(fact(first, "Monsters"), "2 × Monster (M)");
  assert.equal(fact(first, "XP for all monsters"), "20 on Normal, 60 on Hard, 100 on Heroic");
  assert.equal(fact(first, "First win on Normal"), "a rank 1 adventurer at level 1");
});
