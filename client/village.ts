// The village page (design.md, The village; issue #295): the buildings, who
// works in them, and putting characters to work or taking them out.
//
// As on the character page, the server sends what it stores and the page
// only shows what's possible: the server checks every action again, and
// works out what a job earns itself.

import { nameOfCharacter, type CharacterSummary } from "../shared/characters.ts";
import { levelFromXp } from "../shared/rules/advancement.ts";
import { REST_MINUTES } from "../shared/rules/rest.ts";
import { BUILDINGS, earned, earnedPerHour, HOUR_MS, jobLengthMs } from "../shared/rules/village.ts";
import type { VillageBuilding, VillageJob, VillagePage } from "../shared/village.ts";
import { api, type Result } from "./api.ts";
import { isReady, localRest, localTime } from "./rest.ts";

function element<T extends HTMLElement = HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`missing element ${selector}`);
  return found;
}

const errorElement = element("#village-error");

/** Called with the new wood and stone after they changed, so the bar at the top can show them. */
let resourcesChanged: (resources: { wood: number; stone: number }) => void = () => {};
/** Fetches the page again when a job is done or has earned another hour (see `scheduleRefresh`). */
let refreshTimer: number | undefined;

/** Fetches the village and draws the page. */
export async function showVillage(onResourcesChanged: (resources: { wood: number; stone: number }) => void): Promise<void> {
  resourcesChanged = onResourcesChanged;
  errorElement.textContent = "";
  const result = await api.village();
  if (!result.ok) {
    errorElement.textContent = result.error;
    return;
  }
  render(result.data);
}

/** The page is no longer on screen: stop fetching it. */
export function stopVillage(): void {
  window.clearTimeout(refreshTimer);
  refreshTimer = undefined;
}

function render(page: VillagePage): void {
  const receivedAt = Date.now();
  resourcesChanged(page);
  element("#village-locked").hidden = page.unlocked;
  element("#village-resources").textContent = page.unlocked ? `${page.wood} wood · ${page.stone} stone` : "";
  element("#village-buildings").replaceChildren(...page.buildings.map((b) => buildingCard(b, page, receivedAt)));
  scheduleRefresh(page);
}

/**
 * Fetches the page again when the next job is done, or has finished another
 * full hour, so the wood and stone and the free slots follow without a
 * reload. Only the server pays out a job: the page just asks again.
 */
function scheduleRefresh(page: VillagePage): void {
  stopVillage();
  const waits = page.buildings.flatMap((b) =>
    b.jobs.map((job) => Math.min(job.doneInMs, HOUR_MS - (job.startedMsAgo % HOUR_MS))),
  );
  if (waits.length === 0) return;
  // A moment late, so the server's clock has passed it too.
  refreshTimer = window.setTimeout(() => void showVillage(resourcesChanged), Math.min(...waits) + 1000);
}

function buildingCard(building: VillageBuilding, page: VillagePage, receivedAt: number): HTMLLIElement {
  const { name, resource } = BUILDINGS[building.id];
  const item = document.createElement("li");
  item.append(
    textElement("h3", `${name} · level ${building.level}`),
    textElement(
      "p",
      `Earns ${resource}: 1 per rank of the character for every full hour it works. A job lasts 1 hour per ` +
        `level of the character; then it rests, as after a dungeon. ${building.jobs.length} of ${building.slots} ` +
        `${building.slots === 1 ? "slot" : "slots"} in use.`,
    ),
  );
  if (building.jobs.length > 0) {
    const list = document.createElement("ul");
    list.className = "jobs";
    list.append(...building.jobs.map((job) => jobItem(job, building, page, receivedAt)));
    item.append(list);
  }
  if (building.jobs.length < building.slots) item.append(startForm(building, page, receivedAt));
  return item;
}

/** One character at work: what it has earned so far, when it is done, and a button to take it out. */
function jobItem(job: VillageJob, building: VillageBuilding, page: VillagePage, receivedAt: number): HTMLLIElement {
  const { resource } = BUILDINGS[building.id];
  const character = page.characters.find((c) => c.number === job.number);
  const name = character ? nameOfCharacter(character) : `Character ${job.number}`;
  const startedAt = receivedAt - job.startedMsAgo;
  const soFar = earned(job.perHour, startedAt, Date.now());
  const item = document.createElement("li");
  // textContent: the player chose the name.
  item.append(
    textElement(
      "span",
      `${name}: ${job.perHour} ${resource} an hour, ${soFar} so far · done at ${localTime(receivedAt + job.doneInMs)}`,
    ),
  );
  const button = textElement("button", "Take out");
  button.type = "button";
  button.className = "secondary";
  button.setAttribute("aria-label", `Take ${name} out of the ${BUILDINGS[building.id].name.toLowerCase()}`);
  button.addEventListener("click", async () => {
    const rest = character ? REST_MINUTES[character.rank] : undefined;
    const question =
      `Take ${name} out now?\n\nIt keeps the ${soFar} ${resource} of the full hours it worked` +
      (rest === undefined ? "" : `, and rests for ${rest} minutes before it can go into a dungeon`) +
      ". The rest of the job is lost.";
    // confirm() is the browser's own yes/no dialog, like MessageBox.Show in WinForms.
    if (!confirm(question)) return;
    button.disabled = true; // no second request from a double tap
    await showResult(await api.takeOut({ number: job.number }));
  });
  item.append(" ", button);
  return item;
}

/**
 * Choosing a character to put to work: only characters that are ready and
 * not in a game or party, best first. Each option says how long the job
 * would last and what it would earn, with the same shared rules the server
 * uses when it starts the job.
 */
function startForm(building: VillageBuilding, page: VillagePage, receivedAt: number): HTMLElement {
  const { name, resource } = BUILDINGS[building.id];
  const candidates = page.characters
    .filter((c) => !c.inGame && isReady(localRest(c, receivedAt)))
    .sort((a, b) => b.rank - a.rank || level(b) - level(a) || a.number - b.number);
  const row = document.createElement("div");
  row.className = "card-actions";
  if (candidates.length === 0) {
    const note = textElement("p", "None of your characters is free to work now: they are working, resting or in a game.");
    note.className = "hint";
    row.append(note);
    return row;
  }
  // A <select> is the browser's own dropdown, like a ComboBox in WinForms.
  const select = document.createElement("select");
  select.setAttribute("aria-label", `Character to put to work in the ${name.toLowerCase()}`);
  for (const character of candidates) {
    const hours = jobLengthMs(level(character)) / HOUR_MS;
    const total = earnedPerHour(character.rank) * hours;
    const option = textElement(
      "option",
      `${nameOfCharacter(character)} - rank ${character.rank} · level ${level(character)}: ` +
        `${hours} ${hours === 1 ? "hour" : "hours"}, ${total} ${resource}`,
    );
    option.value = String(character.number);
    select.append(option);
  }
  const button = textElement("button", "Start working");
  button.type = "button";
  button.addEventListener("click", async () => {
    button.disabled = true; // no second request from a double tap
    await showResult(await api.startJob({ building: building.id, number: Number(select.value) }));
  });
  row.append(select, button);
  return row;
}

function level(character: CharacterSummary): number {
  return levelFromXp(character.xp, character.class, character.rank);
}

/**
 * Draws the page the server sent back. When it refused, shows why and
 * fetches the page again: what we showed was apparently out of date.
 */
async function showResult(result: Result<VillagePage>): Promise<void> {
  errorElement.textContent = "";
  if (result.ok) {
    render(result.data);
    return;
  }
  const page = await api.village();
  if (page.ok) render(page.data);
  errorElement.textContent = result.error;
}

function textElement<K extends keyof HTMLElementTagNameMap>(tag: K, text: string): HTMLElementTagNameMap[K] {
  const found = document.createElement(tag);
  // textContent, never innerHTML (see main.ts).
  found.textContent = text;
  return found;
}
