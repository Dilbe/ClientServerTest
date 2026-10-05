// The character page: one card per character, buying a new adventurer, and
// renaming characters.
//
// The server sends only the facts it stores (class, rank, XP). The level,
// the stats and the upgrade points are worked out here with the same shared
// rules the server uses, so both always agree.

import {
  CHARACTER_NAME_RULES,
  characterName,
  nameOfCharacter,
  type CharactersPage,
  type CharacterSummary,
} from "../shared/characters.ts";
import {
  ADVENTURER_PRICE_PER_CHARACTER,
  CLASS_NAMES,
  levelFromXp,
  maxLevel,
  upgradePointsEarned,
  xpForLevel,
} from "../shared/rules/advancement.ts";
import { baseStats, STAT_IDS, STATS } from "../shared/rules/stats.ts";
import { api } from "./api.ts";

function element<T extends HTMLElement = HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`missing element ${selector}`);
  return found;
}

const buyButton = element<HTMLButtonElement>("#buy-adventurer-button");
const errorElement = element("#characters-error");

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

buyButton.addEventListener("click", async () => {
  buyButton.disabled = true;
  errorElement.textContent = "";
  const result = await api.buyAdventurer();
  if (!result.ok) {
    // The server refused (not enough silver, or in a game). Show why, and
    // fetch the page again: what we showed was apparently out of date.
    errorElement.textContent = result.error;
    const page = await api.characters();
    if (page.ok) render(page.data);
    return;
  }
  render(result.data);
});

function render(page: CharactersPage): void {
  silverChanged(page.silver);
  element("#characters-silver").textContent = String(page.silver);

  buyButton.textContent = `Buy an adventurer (${page.adventurerPrice} silver)`;
  // Only what the page shows: the server checks all of this again.
  const canAfford = page.silver >= page.adventurerPrice;
  buyButton.disabled = page.inGame || !canAfford;
  element("#buy-note").textContent = page.inGame
    ? "You can't buy characters while you are in a game. Leave the game first."
    : canAfford
      ? `A new level 1, rank 1 adventurer. Each character you have adds ${ADVENTURER_PRICE_PER_CHARACTER} silver to the price.`
      : "Not enough silver yet. Silver comes from winning dungeons.";

  element("#character-list").replaceChildren(...page.characters.map((c) => card(c, page.inGame)));
}

function card(character: CharacterSummary, inGame: boolean): HTMLLIElement {
  const level = levelFromXp(character.xp, character.rank);
  const item = document.createElement("li");
  item.append(
    nameRow(character, inGame),
    textElement("p", `${CLASS_NAMES[character.class]} · rank ${character.rank} · level ${level}`),
    textElement("p", xpText(character.xp, level, character.rank)),
  );

  // No upgrades can be bought yet, so the stats are the base stats.
  const stats = baseStats();
  const list = document.createElement("dl");
  for (const stat of STAT_IDS) list.append(textElement("dt", STATS[stat].name), textElement("dd", String(stats[stat])));
  item.append(list, textElement("p", `Upgrade points earned: ${upgradePointsEarned(level)}`));
  return item;
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
  if (level >= maxLevel(rank)) return `Max level for rank ${rank} (${xp} XP)`;
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
