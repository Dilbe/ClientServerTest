// The character page: one card per character, buying adventurers of each rank,
// renaming characters, upgrading stats, resetting upgrades and ranking up.
//
// The server sends only the facts it stores (class, rank, XP, upgrades). The
// level, the stats, the upgrade costs and the points left are worked out here
// with the same shared rules the server uses, so both always agree.

import {
  CHARACTER_NAME_RULES,
  characterName,
  nameOfCharacter,
  type CharactersPage,
  type CharacterSummary,
} from "../shared/characters.ts";
import {
  canRankUp,
  CLASS_NAMES,
  levelFromXp,
  MAX_RANK,
  maxLevel,
  upgradePointsEarned,
  xpForLevel,
} from "../shared/rules/advancement.ts";
import { ABILITIES, abilitiesOf, abilityStats } from "../shared/rules/abilities.ts";
import { STATS, UPGRADABLE_STAT_IDS, type UpgradableStatId } from "../shared/rules/stats.ts";
import {
  MIN_LEVEL_TO_RESET,
  nextUpgradeCost,
  pointsLeft,
  statsWithUpgrades,
  xpAfterReset,
} from "../shared/rules/upgrades.ts";
import { api, type Result } from "./api.ts";

function element<T extends HTMLElement = HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`missing element ${selector}`);
  return found;
}

const buyButtons = element("#buy-buttons");
const errorElement = element("#characters-error");

/** The page as the server last sent it, to draw the cards again without asking it. */
let currentPage: CharactersPage | undefined;
/**
 * The number of the character chosen first for a rank-up, while the player
 * chooses the second one. Only in the page: nothing is sent until both are
 * chosen and the player has confirmed.
 */
let rankUpFirst: number | null = null;

/** Called with the new silver total after it changed, so the rest of the screen can show it too. */
let silverChanged: (silver: number) => void = () => {};

/** Fetches the characters and draws the page. */
export async function showCharacters(onSilverChanged: (silver: number) => void): Promise<void> {
  silverChanged = onSilverChanged;
  errorElement.textContent = "";
  const result = await api.characters();
  if (!result.ok) {
    errorElement.textContent = result.error;
    return;
  }
  render(result.data);
}

async function buy(button: HTMLButtonElement, rank: number): Promise<void> {
  button.disabled = true; // no double purchase from a double tap
  // The server refuses when there isn't enough silver or the player is in a
  // game; showResult then shows why.
  await showResult(await api.buyAdventurer({ rank }));
}

function render(page: CharactersPage): void {
  silverChanged(page.silver);
  element("#characters-silver").textContent = String(page.silver);

  // One button per rank, with what the next one of that rank costs. Only
  // what the page shows: the server checks all of this again.
  buyButtons.replaceChildren(
    ...page.adventurerPrices.map(({ rank, price }) => {
      const button = textElement("button", `Rank ${rank} (${price} silver)`);
      button.type = "button";
      button.setAttribute("aria-label", `Buy a rank ${rank} adventurer for ${price} silver`);
      button.disabled = page.inGame || page.silver < price;
      button.addEventListener("click", () => buy(button, rank));
      return button;
    }),
  );
  const cheapest = Math.min(...page.adventurerPrices.map((p) => p.price));
  element("#buy-note").textContent = page.inGame
    ? "You can't buy characters while you are in a game. Leave the game first."
    : page.silver >= cheapest
      ? "A new level 1 adventurer of that rank. Each one you buy of a rank makes the next one of that rank cost more."
      : "Not enough silver yet. Silver comes from winning dungeons.";

  currentPage = page;
  // What the server sent is the new truth: a choice made on the old page is gone.
  rankUpFirst = null;
  drawCards();
}

function drawCards(): void {
  const page = currentPage;
  if (!page) return;
  element("#character-list").replaceChildren(...sortedForPage(page.characters).map((c) => card(c, page)));
}

/**
 * Highest rank first, then highest level (design.md, The character page).
 * The server sends them by number, and sort() keeps that order for ties
 * because it is stable, like OrderBy in LINQ. A copy, so the page as the
 * server sent it stays as it was.
 */
function sortedForPage(characters: CharacterSummary[]): CharacterSummary[] {
  return [...characters].sort(
    (a, b) => b.rank - a.rank || levelFromXp(b.xp, b.rank) - levelFromXp(a.xp, a.rank),
  );
}

function card(character: CharacterSummary, page: CharactersPage): HTMLLIElement {
  const { inGame } = page;
  const level = levelFromXp(character.xp, character.rank);
  const atMax = level >= maxLevel(character.rank);
  const item = document.createElement("li");
  item.append(
    nameRow(character, inGame),
    textElement("p", `${CLASS_NAMES[character.class]} · rank ${character.rank} · level ${level}${atMax ? " (max)" : ""}`),
    textElement("p", xpText(character.xp, level, character.rank)),
  );
  // How to go on from the max level (issue #130). Rank 5 is the highest
  // rank, so it gets no rank-up hint.
  if (atMax && character.rank < MAX_RANK) {
    const hint = textElement(
      "p",
      `This character can't gain more XP. To rank it up, combine it with another rank ${character.rank} ` +
        `${CLASS_NAMES[character.class].toLowerCase()} that is also at max level.`,
    );
    hint.className = "hint";
    item.append(hint);
  }

  const left = pointsLeft(level, character.upgrades);
  item.append(
    textElement("p", `Upgrade points: ${left} left of ${upgradePointsEarned(level)} earned`),
    statList(character, left, inGame),
  );
  const abilities = abilityList(character);
  if (abilities) item.append(abilities);
  if (inGame) return item;
  // Resetting and ranking up, in one row that wraps on a narrow screen.
  const actions = document.createElement("div");
  actions.className = "card-actions";
  if (level >= MIN_LEVEL_TO_RESET) actions.append(resetButton(character, level));
  actions.append(...rankUpControls(character, page.characters));
  if (actions.childElementCount > 0) item.append(actions);
  return item;
}

/** Whether two characters can rank up together: what the server checks too. */
function canRankUpTogether(a: CharacterSummary, b: CharacterSummary): boolean {
  return (
    a.number !== b.number &&
    a.class === b.class &&
    a.rank === b.rank &&
    canRankUp(a.xp, a.rank) &&
    canRankUp(b.xp, b.rank)
  );
}

/**
 * Ranking up in two steps: "Rank up" on one character, then "Rank up with
 * ..." on a second one, which asks for confirmation. Only characters that
 * have a partner show the first button.
 */
function rankUpControls(character: CharacterSummary, all: CharacterSummary[]): HTMLElement[] {
  const first = all.find((c) => c.number === rankUpFirst);
  if (!first) {
    if (!all.some((other) => canRankUpTogether(character, other))) return [];
    const button = textElement("button", "Rank up");
    button.type = "button";
    button.className = "secondary";
    button.setAttribute("aria-label", `Rank up ${nameOfCharacter(character)} together with another character`);
    button.addEventListener("click", () => {
      rankUpFirst = character.number;
      drawCards();
    });
    return [button];
  }

  if (first.number === character.number) {
    const note = textElement(
      "p",
      `Choose a second rank ${character.rank} ${CLASS_NAMES[character.class].toLowerCase()} at max level.`,
    );
    note.className = "hint";
    const cancel = textElement("button", "Cancel rank-up");
    cancel.type = "button";
    cancel.className = "secondary";
    cancel.addEventListener("click", () => {
      rankUpFirst = null;
      drawCards();
    });
    return [note, cancel];
  }

  if (!canRankUpTogether(first, character)) return [];
  const button = textElement("button", `Rank up with ${nameOfCharacter(first)}`);
  button.type = "button";
  button.addEventListener("click", async () => {
    // Both characters are gone for good, so the player confirms first.
    const question =
      `Rank up ${nameOfCharacter(first)} and ${nameOfCharacter(character)}?\n\n` +
      `Both are used up, with their upgrades. You get one rank ${first.rank + 1} ` +
      `${CLASS_NAMES[first.class].toLowerCase()} at level 1 in their place. This can't be undone.`;
    if (!confirm(question)) return;
    button.disabled = true;
    await showResult(await api.rankUp({ first: first.number, second: character.number }));
  });
  return [button];
}

/**
 * The stats that can be upgraded, each with a button that upgrades it and
 * shows what that costs. Movement isn't shown: it can't be upgraded yet.
 */
function statList(character: CharacterSummary, left: number, inGame: boolean): HTMLDListElement {
  const stats = statsWithUpgrades(character.upgrades);
  const list = document.createElement("dl");
  for (const stat of UPGRADABLE_STAT_IDS) {
    const cost = nextUpgradeCost(character.upgrades, stat);
    const button = textElement("button", `+1 (${cost} ${cost === 1 ? "point" : "points"})`);
    button.type = "button";
    button.className = "secondary";
    button.setAttribute("aria-label", `Upgrade ${STATS[stat].name} for ${cost} upgrade points`);
    // Only what the page shows: the server checks the points again.
    button.disabled = inGame || cost > left;
    button.addEventListener("click", () => upgrade(button, character.number, stat));
    const upgradeCell = document.createElement("dd");
    upgradeCell.append(button);
    list.append(textElement("dt", STATS[stat].name), textElement("dd", String(stats[stat])), upgradeCell);
  }
  return list;
}

/**
 * The abilities the character's rank gives it, each with what it does and
 * its stats (issue #125). Worked out here from the class and rank, with the
 * same shared rule the server uses when a game starts. Nothing for a
 * character without abilities, such as a rank 1 adventurer.
 */
function abilityList(character: CharacterSummary): HTMLElement | undefined {
  const abilities = abilitiesOf(character.class, character.rank);
  if (abilities.length === 0) return undefined;
  const stats = statsWithUpgrades(character.upgrades);
  const section = document.createElement("section");
  section.className = "abilities";
  section.append(textElement("h4", "Abilities"));
  for (const ability of abilities) {
    const list = document.createElement("dl");
    for (const { name, value } of abilityStats(ability, stats)) {
      list.append(textElement("dt", name), textElement("dd", value));
    }
    const description = textElement("p", ABILITIES[ability].description);
    description.className = "hint";
    section.append(textElement("h5", ABILITIES[ability].name), description, list);
  }
  return section;
}

async function upgrade(button: HTMLButtonElement, number: number, stat: UpgradableStatId): Promise<void> {
  button.disabled = true; // no double purchase from a double tap
  await showResult(await api.upgradeStat({ number, stat }));
}

/**
 * Resetting can't be undone and costs a level, so the player confirms it
 * first. The question says exactly what they will lose.
 */
function resetButton(character: CharacterSummary, level: number): HTMLButtonElement {
  const button = textElement("button", "Reset upgrades");
  button.type = "button";
  button.className = "secondary";
  button.addEventListener("click", async () => {
    const newLevel = level - 1;
    const question =
      `Reset all upgrades of ${nameOfCharacter(character)}?\n\n` +
      `It goes back to level ${newLevel} with ${xpAfterReset(level)} XP, loses all its upgrades, ` +
      `and gets ${upgradePointsEarned(newLevel)} upgrade points to spend again. This can't be undone.`;
    // confirm() shows the browser's own yes/no dialog and waits for the
    // answer, like MessageBox.Show in WinForms.
    if (!confirm(question)) return;
    button.disabled = true;
    await showResult(await api.resetUpgrades({ number: character.number }));
  });
  return button;
}

/**
 * Draws the page the server sent back. When it refused, shows why and
 * fetches the page again: what we showed was apparently out of date.
 */
async function showResult(result: Result<CharactersPage>): Promise<void> {
  errorElement.textContent = "";
  if (result.ok) {
    render(result.data);
    return;
  }
  const page = await api.characters();
  if (page.ok) render(page.data);
  errorElement.textContent = result.error;
}

/**
 * The character's name with an edit button. Editing swaps the row for a
 * small form; an empty name goes back to the default ("Adventurer 1").
 */
function nameRow(character: CharacterSummary, inGame: boolean): HTMLElement {
  const row = document.createElement("div");
  row.className = "name-row";
  // A heading, so screen readers can jump from card to card.
  const heading = textElement("h3", nameOfCharacter(character));
  row.append(heading);
  // Other players in the game see the name, so it can't change during one.
  if (inGame) return row;

  const edit = textElement("button", "Edit");
  edit.type = "button";
  edit.className = "secondary";
  edit.setAttribute("aria-label", `Rename ${nameOfCharacter(character)}`);
  edit.addEventListener("click", () => row.replaceWith(nameForm(character, row)));
  row.append(edit);
  return row;
}

function nameForm(character: CharacterSummary, row: HTMLElement): HTMLFormElement {
  const form = document.createElement("form");
  form.className = "name-form";
  form.noValidate = true;
  const input = document.createElement("input");
  input.name = "name";
  input.value = character.name ?? "";
  input.placeholder = nameOfCharacter({ ...character, name: null });
  input.maxLength = 20;
  input.spellcheck = false;
  input.setAttribute("aria-label", "Name");
  const save = textElement("button", "Save");
  save.type = "submit";
  const cancel = textElement("button", "Cancel");
  cancel.type = "button";
  cancel.className = "secondary";
  cancel.addEventListener("click", () => form.replaceWith(row));
  const hint = textElement("p", `${CHARACTER_NAME_RULES} Leave it empty for "${input.placeholder}".`);
  hint.className = "hint";
  const error = textElement("p", "");
  error.className = "error";
  error.setAttribute("role", "alert");
  form.append(input, save, cancel, hint, error);

  form.addEventListener("submit", async (event) => {
    event.preventDefault(); // we send it ourselves
    const typed = input.value.trim();
    // The same rule the server checks, so mistakes show at once.
    const name = typed === "" ? null : characterName.safeParse(typed);
    if (name !== null && !name.success) {
      error.textContent = name.error.issues[0]!.message;
      return;
    }
    save.disabled = true;
    const result = await api.renameCharacter({ number: character.number, name: name === null ? null : name.data });
    save.disabled = false;
    if (!result.ok) {
      error.textContent = result.error;
      return;
    }
    render(result.data);
  });
  // Opened with a tap on Edit: start typing right away.
  queueMicrotask(() => input.focus());
  return form;
}

/** The XP towards the next level, like "5 / 20 XP to level 3". */
function xpText(xp: number, level: number, rank: number): string {
  if (level >= maxLevel(rank)) return `Max level (${xp} XP)`;
  const progress = xp - xpForLevel(level);
  const needed = xpForLevel(level + 1) - xpForLevel(level);
  return `${progress} / ${needed} XP to level ${level + 1}`;
}

function textElement<K extends keyof HTMLElementTagNameMap>(tag: K, text: string): HTMLElementTagNameMap[K] {
  const found = document.createElement(tag);
  // textContent, never innerHTML (see main.ts).
  found.textContent = text;
  return found;
}
