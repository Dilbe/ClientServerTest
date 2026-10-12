// The rules of the character filters (design.md, Character filters; issues
// #191 and #214), without the page: which characters they show, what a
// closed dropdown says and the counts next to the options. character-filter.ts
// puts them on the page.
//
// This file uses no browser features (no `document`, no `localStorage`), so
// Node can run its tests like the server's, without a browser.

export type FilterId = "maxLevel" | "belowMaxLevel" | "available" | "resting" | "inGame";

/** Which options are selected. */
export type FilterSetting = Record<FilterId, boolean>;

/** One dropdown: its name and its options, in the order they are shown. */
export interface FilterGroup {
  name: string;
  options: readonly { id: FilterId; label: string }[];
}

/**
 * The two dropdowns. A character is shown when a selected option in each
 * dropdown fits it.
 */
export const GROUPS: readonly FilterGroup[] = [
  {
    name: "Level",
    options: [
      { id: "maxLevel", label: "Max level" },
      { id: "belowMaxLevel", label: "Below max level" },
    ],
  },
  {
    name: "Status",
    options: [
      { id: "available", label: "Available" },
      { id: "resting", label: "Resting or healing" },
      { id: "inGame", label: "In a game" },
    ],
  },
];

/** What the filters need to know about a character. */
export interface FilteredCharacter {
  atMaxLevel: boolean;
  /** Not resting or healing. */
  ready: boolean;
  inGame: boolean;
}

/**
 * The option in each dropdown that fits a character. A character in a game
 * counts only as "in a game", also while it is ready.
 */
function fitting(character: FilteredCharacter): { level: FilterId; status: FilterId } {
  return {
    level: character.atMaxLevel ? "maxLevel" : "belowMaxLevel",
    status: character.inGame ? "inGame" : character.ready ? "available" : "resting",
  };
}

/** Whether `setting` shows this character. */
export function fits(setting: FilterSetting, character: FilteredCharacter): boolean {
  const { level, status } = fitting(character);
  return setting[level] && setting[status];
}

/** What a closed dropdown says: "Status: Available, In a game", or "Level: none". */
export function summaryText(group: FilterGroup, setting: FilterSetting): string {
  const selected = group.options.filter((o) => setting[o.id]).map((o) => o.label);
  return `${group.name}: ${selected.length === 0 ? "none" : selected.join(", ")}`;
}

/**
 * How many characters an option would show, given what the other dropdown
 * has selected: the "3" in "Available (3)". It doesn't depend on whether
 * the option itself is selected, or on the other options in its own
 * dropdown.
 */
export function optionCount(id: FilterId, setting: FilterSetting, characters: readonly FilteredCharacter[]): number {
  return characters.filter((c) => {
    const { level, status } = fitting(c);
    if (level === id) return setting[status];
    if (status === id) return setting[level];
    return false;
  }).length;
}

/** "Showing 3 of 7 characters.", or that none fit, for under the dropdowns. */
export function shownText(shown: number, total: number): string {
  if (total === 0) return "";
  if (shown === 0) return `None of your ${total} characters fit these filters.`;
  return shown === total ? "" : `Showing ${shown} of ${total} characters.`;
}
