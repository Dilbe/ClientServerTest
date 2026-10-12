// The character filters on the character page and on "Choose your
// characters" (design.md, Character filters; issue #191): five checkboxes in
// two groups. A character is shown when a ticked box in each group fits it:
//
// - its level: at its max level, or below it;
// - where it is: available, resting (or healing), or in a game.
//
// Both screens share one setting. The first four boxes are remembered in
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

export type FilterId = "maxLevel" | "belowMaxLevel" | "resting" | "available" | "inGame";

/** The boxes in the order they are shown, with their labels. */
const BOXES: readonly { id: FilterId; label: string }[] = [
  { id: "maxLevel", label: "Max level" },
  { id: "belowMaxLevel", label: "Below max level" },
  { id: "resting", label: "Resting or healing" },
  { id: "available", label: "Available" },
  { id: "inGame", label: "In a game" },
];

const STORAGE_KEY = "characterFilter";

/** What is remembered: every box but "In a game". */
const remembered = z.object({
  maxLevel: z.boolean(),
  belowMaxLevel: z.boolean(),
  resting: z.boolean(),
  available: z.boolean(),
});

const DEFAULTS: z.infer<typeof remembered> = { maxLevel: false, belowMaxLevel: true, resting: false, available: true };

const filter: Record<FilterId, boolean> = { ...load(), inGame: false };

/** The remembered boxes, or the defaults when there are none (yet) or they can't be read. */
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
 * Sets "In a game" when a screen opens: ticked when one of the player's
 * characters is in a game. That includes a game the player has left, which
 * goes on with the character until it ends (issues #195 and #215).
 */
export function resetInGameBox(characters: readonly { inGame: boolean }[]): void {
  filter.inGame = characters.some((c) => c.inGame);
}

/** What the filters need to know about a character. */
export interface FilteredCharacter {
  atMaxLevel: boolean;
  /** Not resting or healing. */
  ready: boolean;
  inGame: boolean;
}

/**
 * Whether the filters show this character. A character in a game counts
 * only as "in a game", also while it is ready.
 */
export function isShown(character: FilteredCharacter): boolean {
  const level = character.atMaxLevel ? filter.maxLevel : filter.belowMaxLevel;
  const where = character.inGame ? filter.inGame : character.ready ? filter.available : filter.resting;
  return level && where;
}

/**
 * Fills `container` with the checkboxes, once. `changed` is called after
 * the player ticks or unticks one. Returns a function that puts the
 * boxes in line with the setting, for when the other screen changed it or
 * "In a game" was set again.
 */
export function filterControls(container: HTMLElement, changed: () => void): () => void {
  const fieldset = document.createElement("fieldset");
  fieldset.className = "filters";
  const legend = document.createElement("legend");
  legend.textContent = "Show";
  fieldset.append(legend);
  const boxes = BOXES.map(({ id, label }) => {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.addEventListener("change", () => {
      filter[id] = box.checked;
      if (id !== "inGame") save();
      changed();
    });
    const wrapper = document.createElement("label");
    wrapper.append(box, label);
    fieldset.append(wrapper);
    return { id, box };
  });
  container.replaceChildren(fieldset);
  const sync = () => {
    for (const { id, box } of boxes) box.checked = filter[id];
  };
  sync();
  return sync;
}

/** "Showing 3 of 7 characters.", or that none fit, for under the boxes. */
export function shownText(shown: number, total: number): string {
  if (total === 0) return "";
  if (shown === 0) return `None of your ${total} characters fit these filters.`;
  return shown === total ? "" : `Showing ${shown} of ${total} characters.`;
}
