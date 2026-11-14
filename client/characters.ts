// The character page (design.md, The character page; issue #386), in three
// screens: the list of short cards, one character's screen (renaming,
// upgrading stats and abilities, resetting upgrades, ranking up and making an
// advanced class), and the screen for buying adventurers of each rank.
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
  canMakeAdvancedClass,
  levelFromXp,
  MAX_RANK,
  maxLevel,
  upgradePointsEarned,
  xpForLevel,
} from "../shared/rules/advancement.ts";
import {
  ADVANCED_CLASS_IDS,
  CLASS_NAMES,
  classRange,
  hasStat,
  perUpgrade,
  rangeText,
  type AdvancedClassId,
} from "../shared/rules/classes.ts";
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
  statUpgradeLimitReached,
  xpAfterReset,
} from "../shared/rules/upgrades.ts";
import { api, type Result } from "./api.ts";
import { characterFilter, shownText } from "./character-filter.ts";
import {
  advancedClassPartners,
  characterView,
  characterViewAddress,
  newCharacterNumber,
  pointsToSpendText,
  rankUpPartners,
  type CharacterView,
} from "./character-view.ts";
import { isReady, isWorking, localRest, restText, RestTimer } from "./rest.ts";

function element<T extends HTMLElement = HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`missing element ${selector}`);
  return found;
}

const buyButtons = element("#buy-buttons");
const errorElement = element("#characters-error");
/** The filters of the list, with a setting of their own (see character-filter.ts). */
const filter = characterFilter("characters", element("#character-filter"), () => draw());

// The collapsed cards of issue #192 are gone: every card on the list is
// short now (issue #386). Forget the setting they remembered in this browser,
// so "What we store" stays true.
try {
  localStorage.removeItem("characterCardsCollapsed");
} catch {
  // The browser doesn't allow storage (some private modes): nothing was stored then.
}

/** The screen on show: the list, the buying screen or one character's (see character-view.ts). */
let view: CharacterView = { kind: "list" };
/** The page as the server last sent it, to draw the screens again without asking it. */
let currentPage: CharactersPage | undefined;
/** When the current page arrived, by `Date.now()`, for the rests on it (see rest.ts). */
let receivedAt = 0;
/** Redraws the screen when a character's rest changes. */
const restTimer = new RestTimer();
/**
 * On a character's screen: whether the player is choosing a partner for a
 * rank-up or an advanced class. Only in the page: nothing is sent until the
 * partner is picked and the player has confirmed.
 */
let choosing: "rankUp" | "advancedClass" | null = null;
/** The class picked for an advanced class (design.md, Advanced classes). */
let advancedClass: AdvancedClassId = ADVANCED_CLASS_IDS[0];

/** Called with the new silver total after it changed, so the main menu can show it too. */
let silverChanged: (silver: number) => void = () => {};

/**
 * Fetches the characters and draws the screen the address asks for: `rest`
 * is what comes after "#/characters/" (see `characterView`). `fromParty`:
 * opened from the party, so "Back" goes there.
 */
export async function showCharacters(
  rest: string | null,
  fromParty: boolean,
  onSilverChanged: (silver: number) => void,
): Promise<void> {
  silverChanged = onSilverChanged;
  const wanted = characterView(rest);
  const sameScreen = JSON.stringify(wanted) === JSON.stringify(view);
  // "Back" goes to where the screen was opened from (design.md, The
  // character page): the party, or the list.
  element<HTMLAnchorElement>("#character-back").href = fromParty ? "#/" : characterViewAddress({ kind: "list" });
  view = wanted;
  if (!sameScreen) choosing = null;
  errorElement.textContent = "";
  // Draw the new screen at once with the page we have; the fresh one follows.
  showViewContainer();
  draw();
  const result = await api.characters();
  if (!result.ok) {
    errorElement.textContent = result.error;
    return;
  }
  // The player may have gone to another screen while this was on its way.
  if (view !== wanted) return;
  // Only when the list opens: "In a game" is ticked when one of the
  // characters is in a game (design.md, Character filters). Redrawing after
  // an action keeps what the player chose.
  if (view.kind === "list") filter.resetInGameBox(result.data.characters);
  render(result.data);
}

/** Shows the part of the page for the current screen, and hides the other two. */
function showViewContainer(): void {
  element("#characters-list-view").hidden = view.kind !== "list";
  element("#characters-buy-view").hidden = view.kind !== "buy";
  element("#characters-one-view").hidden = view.kind !== "character";
}

async function buy(button: HTMLButtonElement, rank: number): Promise<void> {
  button.disabled = true; // no double purchase from a double tap
  // The server refuses when there isn't enough silver; showResult then shows why.
  await showResult(await api.buyAdventurer({ rank }));
}

function render(page: CharactersPage): void {
  silverChanged(page.silver);
  currentPage = page;
  receivedAt = Date.now();
  // What the server sent is the new truth: a choice made on the old page is gone.
  choosing = null;
  draw();
}

/** Draws the current screen from the page we have, if any. */
function draw(): void {
  const page = currentPage;
  if (!page) return;
  if (view.kind === "list") drawList(page);
  else if (view.kind === "buy") drawBuy(page);
  else drawCharacter(page, view.number);
  restTimer.set(
    page.characters.map((c) => localRest(c, receivedAt)),
    draw,
  );
}

// ---- The list ----

function drawList(page: CharactersPage): void {
  const characters = sortedForPage(page.characters).map((c) => ({
    character: c,
    filtered: {
      atMaxLevel: levelFromXp(c.xp, c.class, c.rank) >= maxLevel(c.class, c.rank),
      ready: isReady(localRest(c, receivedAt)),
      working: isWorking(localRest(c, receivedAt)),
      inGame: c.inGame,
    },
  }));
  filter.sync(characters.map((c) => c.filtered));
  const shown = characters.filter((c) => filter.isShown(c.filtered)).map((c) => c.character);
  element("#character-filter-note").textContent = shownText(shown.length, page.characters.length);
  element("#character-list").replaceChildren(...shown.map(shortCard));
}

/**
 * Highest rank first, then highest level (design.md, The character page).
 * The server sends them by number, and sort() keeps that order for ties
 * because it is stable, like OrderBy in LINQ. A copy, so the page as the
 * server sent it stays as it was.
 */
function sortedForPage(characters: CharacterSummary[]): CharacterSummary[] {
  return [...characters].sort(
    (a, b) => b.rank - a.rank || levelFromXp(b.xp, b.class, b.rank) - levelFromXp(a.xp, a.class, a.rank),
  );
}

/**
 * A character's short card on the list: name, class, rank and level, what
 * it is busy with, and the points it has to spend. The whole card is a link
 * to the character's screen, so it works with the keyboard and the back
 * button like any link, as the village's tiles do.
 */
function shortCard(character: CharacterSummary): HTMLLIElement {
  const level = levelFromXp(character.xp, character.class, character.rank);
  const atMax = level >= maxLevel(character.class, character.rank);
  const link = document.createElement("a");
  link.href = characterViewAddress({ kind: "character", number: character.number });
  link.append(
    textElement("strong", nameOfCharacter(character)),
    textElement("span", `${CLASS_NAMES[character.class]} · rank ${character.rank} · level ${level}${atMax ? " (max)" : ""}`),
  );
  for (const status of statusTexts(character)) {
    const line = textElement("span", status);
    line.className = "rest";
    link.append(line);
  }
  const points = pointsToSpendText(pointsLeft(level, character.upgrades));
  if (points) {
    const mark = textElement("span", points);
    mark.className = "points-to-spend";
    link.append(mark);
  }
  const item = document.createElement("li");
  item.append(link);
  return item;
}

/**
 * What keeps a character from going into a dungeon now: working in the
 * village, or healing or resting after its last dungeon or job (design.md,
 * Resting), and being in a game.
 */
function statusTexts(character: CharacterSummary): string[] {
  const texts: string[] = [];
  const rest = restText(localRest(character, receivedAt), character.workplace);
  if (rest) texts.push(rest);
  if (character.inGame) texts.push("In a game");
  return texts;
}

// ---- The buying screen ----

function drawBuy(page: CharactersPage): void {
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
  // The prices from the server include what the trading post took off
  // already (issue #339). Heroes still working there lower them when done.
  const traders = page.characters
    .filter((c) => c.workplace === "tradingPost" && isWorking(localRest(c, Date.now())))
    .map(nameOfCharacter);
  element("#buy-trading-post").textContent =
    traders.length === 0
      ? ""
      : `${namesText(traders)} ${traders.length === 1 ? "is" : "are"} in the trading post: ` +
        "these prices go down when each is done.";
}

// ---- A character's screen ----

function drawCharacter(page: CharactersPage, number: number): void {
  const character = page.characters.find((c) => c.number === number);
  if (!character) {
    // No such character (any more): a rank-up may have used it up, or the
    // address was typed. Show the list; replace() leaves no step in the
    // browser's history, so the back button doesn't come back here.
    location.replace(characterViewAddress({ kind: "list" }));
    return;
  }
  element("#character-detail").replaceChildren(fullCard(character, page));
}

function fullCard(character: CharacterSummary, page: CharactersPage): HTMLLIElement {
  // In a running game it can only be upgraded (issue #153). The server
  // checks that again.
  const locked = character.inRunningGame;
  const level = levelFromXp(character.xp, character.class, character.rank);
  const atMax = level >= maxLevel(character.class, character.rank);
  const left = pointsLeft(level, character.upgrades);
  const item = document.createElement("li");
  item.append(
    nameRow(character, locked),
    textElement("p", `${CLASS_NAMES[character.class]} · rank ${character.rank} · level ${level}${atMax ? " (max)" : ""}`),
    textElement("p", xpText(character.xp, level, maxLevel(character.class, character.rank))),
  );
  for (const status of statusTexts(character)) {
    const line = textElement("p", status);
    line.className = "rest";
    item.append(line);
  }
  // How to go on from the max level (issue #130). Rank 5 is the highest
  // rank, so it gets no rank-up hint; a rank 5 adventurer can still make an
  // advanced class (design.md, Advanced classes).
  if (atMax && character.rank < MAX_RANK) {
    const hint = textElement(
      "p",
      `This character can't gain more XP. To rank it up, combine it with another rank ${character.rank} ` +
        `${CLASS_NAMES[character.class].toLowerCase()} that is also at max level.`,
    );
    hint.className = "hint";
    item.append(hint);
  } else if (canMakeAdvancedClass(character.xp, character.class, character.rank)) {
    const hint = textElement(
      "p",
      `This character can't gain more XP. To make an advanced class, combine it with another rank ${MAX_RANK} ` +
        "adventurer that is also at max level.",
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
  item.append(
    textElement("p", `Upgrade points: ${left} left of ${upgradePointsEarned(level)} earned`),
    statList(character, left),
  );
  const abilities = abilityList(character, left);
  if (abilities) item.append(abilities);
  if (locked) return item;
  // Resetting and ranking up, in one row that wraps on a narrow screen.
  const actions = document.createElement("div");
  actions.className = "card-actions";
  if (choosing === "rankUp") actions.append(...rankUpChoice(character, page.characters));
  else if (choosing === "advancedClass") actions.append(...advancedClassChoice(character, page.characters));
  else {
    if (level >= MIN_LEVEL_TO_RESET) actions.append(resetButton(character, level));
    actions.append(...combineButtons(character, page.characters));
  }
  if (actions.childElementCount > 0) item.append(actions);
  return item;
}

/**
 * "Rank up" and "Make advanced class", each only when the character has a
 * partner for it. Pressing one shows the partners to choose from.
 */
function combineButtons(character: CharacterSummary, all: CharacterSummary[]): HTMLButtonElement[] {
  const buttons: HTMLButtonElement[] = [];
  if (rankUpPartners(character, all).length > 0) {
    const button = textElement("button", "Rank up");
    button.type = "button";
    button.className = "secondary";
    button.setAttribute("aria-label", `Rank up ${nameOfCharacter(character)} together with another character`);
    button.addEventListener("click", () => startChoosing("rankUp"));
    buttons.push(button);
  }
  if (advancedClassPartners(character, all).length > 0) {
    const button = textElement("button", "Make advanced class");
    button.type = "button";
    button.className = "secondary";
    button.setAttribute(
      "aria-label",
      `Make an advanced class from ${nameOfCharacter(character)} and another rank ${MAX_RANK} adventurer`,
    );
    button.addEventListener("click", () => startChoosing("advancedClass"));
    buttons.push(button);
  }
  return buttons;
}

/** Shows the partners to choose from, and puts the keyboard focus on the first. */
function startChoosing(what: "rankUp" | "advancedClass"): void {
  choosing = what;
  draw();
  document.querySelector<HTMLElement>("#character-detail .card-actions select, #character-detail .card-actions button")?.focus();
}

function cancelButton(): HTMLButtonElement {
  const cancel = textElement("button", "Cancel");
  cancel.type = "button";
  cancel.className = "secondary";
  cancel.addEventListener("click", () => {
    choosing = null;
    draw();
  });
  return cancel;
}

/** One button per character the rank-up can be done with, then Cancel. */
function rankUpChoice(character: CharacterSummary, all: CharacterSummary[]): HTMLElement[] {
  const note = textElement(
    "p",
    `Rank up with which rank ${character.rank} ${CLASS_NAMES[character.class].toLowerCase()}? ` +
      "Both are used up for the new one.",
  );
  note.className = "hint";
  const partners = rankUpPartners(character, sortedForPage(all)).map((partner) => {
    const button = textElement("button", partnerText(partner));
    button.type = "button";
    button.addEventListener("click", async () => {
      // Both characters are gone for good, so the player confirms first.
      const question =
        `Rank up ${nameOfCharacter(character)} and ${nameOfCharacter(partner)}?\n\n` +
        `Both are used up, with their upgrades. You get one rank ${character.rank + 1} ` +
        `${CLASS_NAMES[character.class].toLowerCase()} at level 1 in their place. This can't be undone.`;
      if (!confirm(question)) return;
      button.disabled = true;
      await showMade(all, await api.rankUp({ first: character.number, second: partner.number }));
    });
    return button;
  });
  return [note, ...partners, cancelButton()];
}

/** The class to make, one button per character it can be made with, then Cancel. */
function advancedClassChoice(character: CharacterSummary, all: CharacterSummary[]): HTMLElement[] {
  const note = textElement(
    "p",
    `Pick a class, then the second rank ${MAX_RANK} adventurer. Both are used up for the new one.`,
  );
  note.className = "hint";
  // A <select> is the browser's own dropdown, like a ComboBox in WinForms.
  const select = document.createElement("select");
  select.setAttribute("aria-label", "Advanced class");
  for (const id of ADVANCED_CLASS_IDS) {
    const option = textElement("option", CLASS_NAMES[id]);
    option.value = id;
    option.selected = id === advancedClass;
    select.append(option);
  }
  select.id = "advanced-class";
  select.addEventListener("change", () => {
    advancedClass = select.value as AdvancedClassId;
    // The buttons name the class, so they are drawn anew: put the keyboard
    // focus back on the dropdown.
    draw();
    document.querySelector<HTMLSelectElement>("#advanced-class")?.focus();
  });
  const className = CLASS_NAMES[advancedClass].toLowerCase();
  const partners = advancedClassPartners(character, sortedForPage(all)).map((partner) => {
    const button = textElement("button", `Make a ${className} with ${nameOfCharacter(partner)}`);
    button.type = "button";
    button.addEventListener("click", async () => {
      // Both characters are gone for good, so the player confirms first.
      const question =
        `Make a ${className} from ${nameOfCharacter(character)} and ${nameOfCharacter(partner)}?\n\n` +
        `Both are used up, with their upgrades. You get one rank 1 ${className} at level 1 in their ` +
        "place. This can't be undone.";
      if (!confirm(question)) return;
      button.disabled = true;
      await showMade(
        all,
        await api.advancedClass({ first: character.number, second: partner.number, class: advancedClass }),
      );
    });
    return button;
  });
  return [note, select, ...partners, cancelButton()];
}

/** A partner to choose, like "Bram · level 10". */
function partnerText(partner: CharacterSummary): string {
  return `${nameOfCharacter(partner)} · level ${levelFromXp(partner.xp, partner.class, partner.rank)}`;
}

/**
 * After a rank-up or an advanced class: the character on screen is used
 * up, so show the new one. replaceState() changes the address without a new
 * step in the browser's history (and without a "hashchange" event, so the
 * page isn't fetched once more): the back button goes to the list, not to
 * a character that is gone.
 */
async function showMade(before: CharacterSummary[], result: Result<CharactersPage>): Promise<void> {
  if (result.ok) {
    const made = newCharacterNumber(
      before.map((c) => c.number),
      result.data.characters.map((c) => c.number),
    );
    if (made !== undefined) {
      view = { kind: "character", number: made };
      history.replaceState(null, "", characterViewAddress(view));
    }
  }
  await showResult(result);
}

/**
 * The stats that can be upgraded, each with a button that upgrades it and
 * shows what that costs. Movement isn't shown: it can't be upgraded. A stat
 * of one class, such as the healer's healing power or the ranger's range,
 * only for that class. A stat at its limit says "Max", as an ability does.
 */
function statList(character: CharacterSummary, left: number): HTMLDListElement {
  const stats = statsWithUpgrades(character.class, character.upgrades);
  const list = document.createElement("dl");
  for (const stat of UPGRADABLE_STAT_IDS) {
    if (!hasStat(character.class, stat)) continue;
    const maxed = statUpgradeLimitReached(character.class, character.upgrades, stat);
    const cost = nextUpgradeCost(character.class, character.upgrades, stat);
    // What one upgrade adds depends on the class: a tank gets 2 hit points.
    const amount = perUpgrade(character.class, stat);
    const button = textElement("button", maxed ? "Max" : `+${amount} (${cost} ${cost === 1 ? "point" : "points"})`);
    button.type = "button";
    button.className = "secondary";
    button.setAttribute(
      "aria-label",
      maxed ? `${STATS[stat].name} is fully upgraded` : `Upgrade ${STATS[stat].name} by ${amount} for ${cost} upgrade points`,
    );
    // Only what the page shows: the server checks the limit and the points again.
    button.disabled = maxed || cost > left;
    button.addEventListener("click", () => upgrade(button, character.number, stat));
    const upgradeCell = document.createElement("dd");
    upgradeCell.append(button);
    // The range shows both ends, like "2–3": an upgrade adds 1 to the longest (design.md, The ranger).
    const value = stat === "range" ? rangeText(classRange(character.class, stats)) : String(stats[stat] ?? 0);
    list.append(textElement("dt", STATS[stat].name), textElement("dd", value), upgradeCell);
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
  const stats = statsWithUpgrades(character.class, character.upgrades);
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
 * The character's name, the heading of its screen, with an edit button.
 * Editing swaps the row for a small form; an empty name goes back to the
 * default ("Adventurer 1").
 */
function nameRow(character: CharacterSummary, locked: boolean): HTMLElement {
  const row = document.createElement("div");
  row.className = "name-row";
  row.append(textElement("h2", nameOfCharacter(character)));
  // Other players in the game see the name, so it can't change during one.
  if (locked) return row;

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
function xpText(xp: number, level: number, max: number): string {
  if (level >= max) return `Max level (${xp} XP)`;
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

/** Names as a sentence says them: "Ann", "Ann and Bo", "Ann, Bo and Cy". */
function namesText(names: readonly string[]): string {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}
