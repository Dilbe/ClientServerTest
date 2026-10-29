// How the character filters are remembered (design.md, Character filters;
// issue #222): each screen has its own setting, under its own key in the
// browser's `localStorage`. character-filter.ts explains what localStorage
// is and why what comes out of it is checked.
//
// Like character-filter-rules.ts, this file uses no browser features: it is
// given the storage to use, so Node can run its tests with a stand-in.

import { z } from "zod";

/** The screens with character filters: the character page and "Choose your characters". */
export type FilterScreen = "characters" | "choice";

/**
 * What is remembered: every option but "In a game". "Working" came later
 * (issue #295): a setting saved before it has none, and gets it unselected.
 */
const remembered = z.object({
  maxLevel: z.boolean(),
  belowMaxLevel: z.boolean(),
  resting: z.boolean(),
  available: z.boolean(),
  working: z.boolean().default(false),
});
export type RememberedFilter = z.infer<typeof remembered>;

export const DEFAULTS: RememberedFilter = {
  maxLevel: false,
  belowMaxLevel: true,
  resting: false,
  available: true,
  working: false,
};

/**
 * The key both screens shared before issue #222. A setting found there is
 * copied to both screens, so the player keeps it, and then removed.
 */
export const SHARED_KEY = "characterFilter";

/** The key a screen's setting is remembered under, like "characterFilter.choice". */
export function storageKey(screen: FilterScreen): string {
  return `${SHARED_KEY}.${screen}`;
}

/** The parts of `localStorage` used here. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * The remembered options of a screen, or the defaults when there are none
 * (yet) or they can't be read. Can throw when the browser doesn't allow
 * storage (some private modes); the caller decides what to do then.
 */
export function loadFilter(storage: KeyValueStorage, screen: FilterScreen): RememberedFilter {
  moveSharedSetting(storage);
  return read(storage, storageKey(screen)) ?? DEFAULTS;
}

/** Remembers a screen's options. Can throw when storage isn't allowed or is full. */
export function saveFilter(storage: KeyValueStorage, screen: FilterScreen, setting: RememberedFilter): void {
  const { maxLevel, belowMaxLevel, resting, available, working } = setting;
  storage.setItem(storageKey(screen), JSON.stringify({ maxLevel, belowMaxLevel, resting, available, working }));
}

/** Copies the setting both screens shared to each screen that has none of its own yet, then removes it. */
function moveSharedSetting(storage: KeyValueStorage): void {
  const shared = read(storage, SHARED_KEY);
  if (shared) {
    for (const screen of ["characters", "choice"] as const) {
      if (read(storage, storageKey(screen)) === undefined) saveFilter(storage, screen, shared);
    }
  }
  storage.removeItem(SHARED_KEY);
}

/** The options stored under `key`, or undefined when there are none or they aren't valid. */
function read(storage: KeyValueStorage, key: string): RememberedFilter | undefined {
  try {
    const stored = remembered.safeParse(JSON.parse(storage.getItem(key) ?? "null"));
    return stored.success ? stored.data : undefined;
  } catch {
    // Not valid JSON.
    return undefined;
  }
}
