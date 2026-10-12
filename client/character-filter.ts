// The character filters on the character page and on "Choose your
// characters" (design.md, Character filters; issues #191 and #214): two
// dropdowns, "Level" and "Status", in which the player selects options with
// checkboxes. character-filter-rules.ts has the rules; this file keeps the
// setting and puts the dropdowns on the page.
//
// Both screens share one setting. All of it but "In a game" is remembered in
// the browser's `localStorage`: roughly a per-user settings file on one
// machine, like user-scoped settings in a WinForms app. Each site has its
// own, and it stays until the player clears it. "In a game" isn't
// remembered: it is set again each time one of the screens is opened.
//
// localStorage can be read by any script on our site, so it is only for
// harmless preferences like these, never for anything secret. It is also
// the player's own to change, so what comes out of it is checked like any
// other input.

import { z } from "zod";
import {
  fits,
  GROUPS,
  optionCount,
  summaryText,
  type FilteredCharacter,
  type FilterSetting,
} from "./character-filter-rules.ts";

export { shownText, type FilteredCharacter } from "./character-filter-rules.ts";

const STORAGE_KEY = "characterFilter";

/** What is remembered: every option but "In a game". */
const remembered = z.object({
  maxLevel: z.boolean(),
  belowMaxLevel: z.boolean(),
  resting: z.boolean(),
  available: z.boolean(),
});

const DEFAULTS: z.infer<typeof remembered> = { maxLevel: false, belowMaxLevel: true, resting: false, available: true };

const filter: FilterSetting = { ...load(), inGame: false };

/** The remembered options, or the defaults when there are none (yet) or they can't be read. */
function load(): z.infer<typeof remembered> {
  try {
    const stored = remembered.safeParse(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null"));
    return stored.success ? stored.data : DEFAULTS;
  } catch {
    // Not valid JSON, or the browser doesn't allow storage (some private modes).
    return DEFAULTS;
  }
}

function save(): void {
  const { maxLevel, belowMaxLevel, resting, available } = filter;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ maxLevel, belowMaxLevel, resting, available }));
  } catch {
    // Storage not allowed or full: the setting then lasts until the page is reloaded.
  }
}

/**
 * Sets "In a game" when a screen opens: selected when one of the player's
 * characters is in a game. That includes a game the player has left, which
 * goes on with the character until it ends (issues #195 and #215).
 */
export function resetInGameBox(characters: readonly { inGame: boolean }[]): void {
  filter.inGame = characters.some((c) => c.inGame);
}

/** Whether the filters show this character. */
export function isShown(character: FilteredCharacter): boolean {
  return fits(filter, character);
}

/**
 * The dropdowns of both screens. Only one screen shows at a time,
 * so one listener for the whole page closes them.
 */
const dropdowns: HTMLDetailsElement[] = [];

// A click outside an open dropdown closes it, as with a <select>. A click
// on the other dropdown's summary is outside this one, so opening one
// closes the other.
document.addEventListener("click", (event) => {
  for (const details of dropdowns) {
    if (details.open && !details.contains(event.target as Node)) details.open = false;
  }
});

/**
 * Fills `container` with the two dropdowns, once. They are made from
 * `<details>` and `<summary>`: the browser opens and closes them on a
 * click, a tap, Enter or Space, without any script. A `<select multiple>`
 * would need Ctrl+click to select more than one option, and shows as a
 * different control on each phone.
 *
 * `changed` is called after the player selects or unselects an option.
 * Returns a function that puts the dropdowns in line with the setting and
 * updates the counts next to the options, for every time the list is drawn:
 * the other screen may have changed the setting, "In a game" may have been
 * set again, or a character may have finished resting. It takes the
 * characters the counts are for.
 */
export function filterControls(
  container: HTMLElement,
  changed: () => void,
): (characters: readonly FilteredCharacter[]) => void {
  const wrapper = document.createElement("div");
  wrapper.className = "filters";
  wrapper.append(Object.assign(document.createElement("span"), { className: "filters-label", textContent: "Show:" }));
  const parts = GROUPS.map((group) => {
    const details = document.createElement("details");
    details.className = "filter-dropdown";
    const summary = document.createElement("summary");
    const list = document.createElement("div");
    list.className = "filter-options";
    list.setAttribute("role", "group");
    list.setAttribute("aria-label", group.name);
    const options = group.options.map(({ id, label }) => {
      const box = document.createElement("input");
      box.type = "checkbox";
      box.addEventListener("change", () => {
        filter[id] = box.checked;
        if (id !== "inGame") save();
        changed();
      });
      const text = document.createElement("span");
      const option = document.createElement("label");
      option.append(box, text);
      list.append(option);
      return { id, label, box, text };
    });
    // Escape closes the dropdown and puts the focus back on its summary, so
    // a keyboard user can go on from where they were.
    details.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && details.open) {
        details.open = false;
        summary.focus();
      }
    });
    details.append(summary, list);
    wrapper.append(details);
    dropdowns.push(details);
    return { group, summary, options };
  });
  container.replaceChildren(wrapper);
  const sync = (characters: readonly FilteredCharacter[]) => {
    for (const { group, summary, options } of parts) {
      summary.textContent = summaryText(group, filter);
      for (const { id, label, box, text } of options) {
        box.checked = filter[id];
        text.textContent = `${label} (${optionCount(id, filter, characters)})`;
      }
    }
  };
  sync([]);
  return sync;
}
