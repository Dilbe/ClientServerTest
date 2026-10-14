// The character page: one card per character, buying adventurers of each rank,
// renaming characters, upgrading stats and abilities, resetting upgrades and
// ranking up.
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
import {
  ABILITIES,
  abilitiesOf,
  abilityStats,
  type AbilityId,
  type AbilityUpgradeId,
} from "../shared/rules/abilities.ts";
import { STATS, UPGRADABLE_STAT_IDS, type UpgradableStatId } from "../shared/rules/stats.ts";
import {
  abilityUpgradeCounts,
  MIN_LEVEL_TO_RESET,
  nextAbilityUpgradeCost,
  nextUpgradeCost,
  pointsLeft,
  statsWithUpgrades,
  xpAfterReset,
} from "../shared/rules/upgrades.ts";
import { z } from "zod";
import { api, type Result } from "./api.ts";
import { characterFilter, shownText } from "./character-filter.ts";
import { isReady, localRest, restText, RestTimer } from "./rest.ts";

function element<T extends HTMLElement = HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`missing element ${selector}`);
  return found;
}

const buyButtons = element("#buy-buttons");
const errorElement = element("#characters-error");
/** The filters of this screen, with a setting of their own (see character-filter.ts). */
const filter = characterFilter("characters", element("#character-filter"), () => drawCards());

/** "Collapse all" or "Expand all" above the cards (issue #192). */
const collapseAllButton = element<HTMLButtonElement>("#collapse-all");

// Collapsed cards (issue #192): a collapsed card shows only the name, the
// class, rank and level, and the upgrade points. "Collapse all" and
// "Expand all" are remembered per device in `localStorage`, like the
// filters (see character-filter.ts for what that is and why it is checked).
// Opening or closing one card only lasts while the page is open.
const COLLAPSED_KEY = "characterCardsCollapsed";

/** Whether the cards are collapsed, as "Collapse all" or "Expand all" last set them. */
let allCollapsed = loadCollapsed();
/**
 * The numbers of the cards opened or closed on their own since then: these
 * are the other way round from `allCollapsed`.
 */
const toggled = new Set<number>();

function loadCollapsed(): boolean {
  try {
    const stored = z.boolean().safeParse(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "null"));
    return stored.success && stored.data;
  } catch {
    // Not valid JSON, or the browser doesn't allow storage (some private modes).
    return false;
  }
}

collapseAllButton.addEventListener("click", () => {
  allCollapsed = !allCollapsed;
  toggled.clear();
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify(allCollapsed));
  } catch {
    // Storage not allowed or full: the setting then lasts until the page is reloaded.
  }
  drawCards();
});

/** The page as the server last sent it, to draw the cards again without asking it. */
let currentPage: CharactersPage | undefined;
/** When the current page arrived, by `Date.now()`, for the rests on it (see rest.ts). */
let receivedAt = 0;
/** Redraws the cards when a character's rest changes. */
const restTimer = new RestTimer();
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
  // Only when the page opens: "In a game" is ticked when one of the
  // characters is in a game (design.md, Character filters). Redrawing after
  // an action keeps what the player chose.
  filter.resetInGameBox(result.data.characters);
  render(result.data);
}

async function buy(button: HTMLButtonElement, rank: number): Promise<void> {
  button.disabled = true; // no double purchase from a double tap
  // The server refuses when there isn't enough silver; showResult then shows why.
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
      button.disabled = page.silver < price;
      button.addEventListener("click", () => buy(button, rank));
      return button;
    }),
  );
  const cheapest = Math.min(...page.adventurerPrices.map((p) => p.price));
  element("#buy-note").textContent =
    page.silver >= cheapest
      ? "A new level 1 adventurer of that rank. Each one you buy of a rank makes the next one of that rank " +
        "cost more, but that price drops 10% a day until it is back at the first price."
      : "Not enough silver yet. Silver comes from winning dungeons.";

  currentPage = page;
  receivedAt = Date.now();
  // What the server sent is the new truth: a choice made on the old page is gone.
  rankUpFirst = null;
  drawCards();
}

function drawCards(): void {
  const page = currentPage;
  if (!page) return;
  const characters = sortedForPage(page.characters).map((c) => ({
    character: c,
    filtered: {
      atMaxLevel: levelFromXp(c.xp, c.rank) >= maxLevel(c.rank),
      ready: isReady(localRest(c, receivedAt)),
      inGame: c.inGame,
    },
  }));
  filter.sync(characters.map((c) => c.filtered));
  const shown = characters.filter((c) => filter.isShown(c.filtered)).map((c) => c.character);
  element("#character-filter-note").textContent = shownText(shown.length, page.characters.length);
  element("#character-list").replaceChildren(...shown.map((c) => card(c, page)));
  collapseAllButton.textContent = allCollapsed ? "Expand all" : "Collapse all";
  collapseAllButton.hidden = shown.length === 0;
  restTimer.set(
    page.characters.map((c) => localRest(c, receivedAt)),
    drawCards,
  );
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
  // In a running game it can only be upgraded (issue #153). The server
  // checks that again.
  const locked = character.inRunningGame;
  const level = levelFromXp(character.xp, character.rank);
  const atMax = level >= maxLevel(character.rank);
  const left = pointsLeft(level, character.upgrades);
  const pointsText = `Upgrade points: ${left} left of ${upgradePointsEarned(level)} earned`;
  const collapsed = allCollapsed !== toggled.has(character.number);
  const item = document.createElement("li");
  item.append(
    nameRow(character, locked, collapsed),
    textElement("p", `${CLASS_NAMES[character.class]} · rank ${character.rank} · level ${level}${atMax ? " (max)" : ""}`),
  );
  if (collapsed) {
    item.append(textElement("p", pointsText));
    return item;
  }
  item.append(textElement("p", xpText(character.xp, level, character.rank)));
  // Healing or resting after its last dungeon (design.md, Resting).
  const rest = restText(localRest(character, receivedAt));
  if (rest) {
    const line = textElement("p", rest);
    line.className = "rest";
    item.append(line);
  }
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

  if (locked) {
    const note = textElement(
      "p",
      "In a game: upgrades count there at once. Renaming, resetting and ranking up wait until the game ends.",
    );
    note.className = "hint";
    item.append(note);
  }
  item.append(textElement("p", pointsText), statList(character, left));
  const abilities = abilityList(character, left);
  if (abilities) item.append(abilities);
  if (locked) return item;
  // Resetting and ranking up, in one row that wraps on a narrow screen.
  const actions = document.createElement("div");
  actions.className = "card-actions";
  if (level >= MIN_LEVEL_TO_RESET) actions.append(resetButton(character, level));
  actions.append(...rankUpControls(character, page.characters));
  if (actions.childElementCount > 0) item.append(actions);
  return item;
}

/**
 * Whether two characters can rank up together: what the server checks too.
 * Neither may be in a running game (issue #153).
 */
function canRankUpTogether(a: CharacterSummary, b: CharacterSummary): boolean {
  return (
    a.number !== b.number &&
    !a.inRunningGame &&
    !b.inRunningGame &&
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
function statList(character: CharacterSummary, left: number): HTMLDListElement {
  const stats = statsWithUpgrades(character.upgrades);
  const list = document.createElement("dl");
  for (const stat of UPGRADABLE_STAT_IDS) {
    const cost = nextUpgradeCost(character.upgrades, stat);
    const button = textElement("button", `+1 (${cost} ${cost === 1 ? "point" : "points"})`);
    button.type = "button";
    button.className = "secondary";
    button.setAttribute("aria-label", `Upgrade ${STATS[stat].name} for ${cost} upgrade points`);
    // Only what the page shows: the server checks the points again.
    button.disabled = cost > left;
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
 *
 * A stat of an ability that can be upgraded, such as its cooldown, has an
 * upgrade button like the character's stats (design.md, Ability upgrades).
 */
function abilityList(character: CharacterSummary, left: number): HTMLElement | undefined {
  const abilities = abilitiesOf(character.class, character.rank);
  if (abilities.length === 0) return undefined;
  const stats = statsWithUpgrades(character.upgrades);
  const counts = abilityUpgradeCounts(character.upgrades);
  const section = document.createElement("section");
  section.className = "abilities";
  section.append(textElement("h4", "Abilities"));
  for (const ability of abilities) {
    const list = document.createElement("dl");
    for (const { name, value, upgrade } of abilityStats(ability, stats, counts)) {
      // An empty cell for a stat that can't be upgraded keeps the columns lined up.
      const upgradeCell = document.createElement("dd");
      if (upgrade) upgradeCell.append(abilityUpgradeButton(character, ability, upgrade, name, left));
      list.append(textElement("dt", name), textElement("dd", value), upgradeCell);
    }
    const description = textElement("p", ABILITIES[ability].description);
    description.className = "hint";
    section.append(textElement("h5", ABILITIES[ability].name), description, list);
  }
  return section;
}

/**
 * Upgrades one stat of an ability, showing what that does and costs, like
 * "−1 (10 points)" for the cooldown. At its limit it says "Max" instead.
 */
function abilityUpgradeButton(
  character: CharacterSummary,
  ability: AbilityId,
  upgrade: AbilityUpgradeId,
  statName: string,
  left: number,
): HTMLButtonElement {
  const cost = nextAbilityUpgradeCost(character.upgrades, ability, upgrade);
  const step = ABILITIES[ability].upgrades[upgrade]!.step;
  const button = textElement("button", cost === undefined ? "Max" : `${step} (${cost} ${cost === 1 ? "point" : "points"})`);
  button.type = "button";
  button.className = "secondary";
  const what = `${ABILITIES[ability].name} ${statName.toLowerCase()}`;
  button.setAttribute(
    "aria-label",
    cost === undefined ? `${what} is fully upgraded` : `Upgrade ${what} for ${cost} upgrade points`,
  );
  // Only what the page shows: the server checks the rank, the limit and the points again.
  button.disabled = cost === undefined || cost > left;
  button.addEventListener("click", async () => {
    button.disabled = true; // no double purchase from a double tap
    await showResult(await api.upgradeAbility({ number: character.number, ability, upgrade }));
  });
  return button;
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
 * The character's name with a button that collapses or expands the card
 * and, on an expanded card, an edit button. Editing swaps the row for a
 * small form; an empty name goes back to the default ("Adventurer 1").
 */
function nameRow(character: CharacterSummary, locked: boolean, collapsed: boolean): HTMLElement {
  const row = document.createElement("div");
  row.className = "name-row";
  // A heading, so screen readers can jump from card to card.
  const heading = textElement("h3", nameOfCharacter(character));
  const buttons = document.createElement("div");
  buttons.className = "name-buttons";
  row.append(heading, buttons);

  const toggle = textElement("button", collapsed ? "Expand" : "Collapse");
  toggle.type = "button";
  toggle.className = "secondary";
  toggle.setAttribute("aria-label", `${collapsed ? "Expand" : "Collapse"} ${nameOfCharacter(character)}`);
  // Tells screen readers whether the card is open, like a tree node's state.
  toggle.setAttribute("aria-expanded", String(!collapsed));
  toggle.dataset.toggle = String(character.number);
  toggle.addEventListener("click", () => {
    if (!toggled.delete(character.number)) toggled.add(character.number);
    drawCards();
    // The cards are drawn anew, so put the keyboard focus back on this button.
    document.querySelector<HTMLButtonElement>(`[data-toggle="${character.number}"]`)?.focus();
  });
  buttons.append(toggle);
  // Other players in the game see the name, so it can't change during one.
  if (locked || collapsed) return row;

  const edit = textElement("button", "Edit");
  edit.type = "button";
  edit.className = "secondary";
  edit.setAttribute("aria-label", `Rename ${nameOfCharacter(character)}`);
  edit.addEventListener("click", () => row.replaceWith(nameForm(character, row)));
  buttons.prepend(edit);
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
