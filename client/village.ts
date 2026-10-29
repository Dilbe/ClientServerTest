// The village page (design.md, The village; issue #295): the buildings, who
// works in them, and putting characters to work or taking them out.
//
// As on the character page, the server sends what it stores and the page
// only shows what's possible: the server checks every action again, and
// works out what a job earns itself.

import { nameOfCharacter, type CharacterSummary } from "../shared/characters.ts";
import { levelFromXp, maxXp } from "../shared/rules/advancement.ts";
import { CLASSES } from "../shared/rules/classes.ts";
import { REST_MINUTES } from "../shared/rules/rest.ts";
import {
  BUILDINGS,
  canPay,
  costText,
  earnedPerHour,
  HOUR_MS,
  jobLengthMs,
  maxBuildingLevel,
  TRAINING_XP_PER_HOUR,
  trainingXpPerHour,
  upgradeCost,
  type BuildingId,
  type Cost,
} from "../shared/rules/village.ts";
import type { VillageBuilding, VillageJob, VillagePage } from "../shared/village.ts";
import { api, type Result } from "./api.ts";
import { isReady, localRest, localTime } from "./rest.ts";

function element<T extends HTMLElement = HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`missing element ${selector}`);
  return found;
}

const errorElement = element("#village-error");

/** What the bar at the top shows: the account's wood, stone and silver. */
type Resources = { wood: number; stone: number; silver: number };

/** Called with the new wood, stone and silver after they changed, so the bar at the top can show them. */
let resourcesChanged: (resources: Resources) => void = () => {};
/** Fetches the page again when a job is done or has earned another hour (see `scheduleRefresh`). */
let refreshTimer: number | undefined;

/** Fetches the village and draws the page. */
export async function showVillage(onResourcesChanged: (resources: Resources) => void): Promise<void> {
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
  element("#village-buildings").replaceChildren(
    ...page.buildings.map((b) => buildingCard(b, page, receivedAt)),
    ...page.unbuilt.map((id) => unbuiltCard(id, page)),
  );
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
  if (BUILDINGS[building.id].earns === "xp") return trainingCard(building, page, receivedAt);
  const { name } = BUILDINGS[building.id];
  const workers = building.jobs.length;
  const item = document.createElement("li");
  item.append(
    textElement("h3", `${name} · level ${building.level} of ${maxBuildingLevel(building.id)}`),
    textElement(
      "p",
      `${describe(building.id)} ${workers} of ${building.slots} ${building.slots === 1 ? "slot" : "slots"} in use.`,
    ),
  );
  if (workers > 0) item.append(jobList(building.jobs, building, page, receivedAt));
  if (workers < building.slots) item.append(startForm(building, page, receivedAt, false));
  item.append(upgradeRow(building, page));
  return item;
}

/**
 * The training house (design.md, The training house; issue #297): the
 * trainer slot first, then the trainees.
 */
function trainingCard(building: VillageBuilding, page: VillagePage, receivedAt: number): HTMLLIElement {
  const { name } = BUILDINGS[building.id];
  const trainerJob = building.jobs.find((job) => job.trainer);
  const trainees = building.jobs.filter((job) => !job.trainer);
  const item = document.createElement("li");
  item.append(
    textElement("h3", `${name} · level ${building.level} of ${maxBuildingLevel(building.id)}`),
    textElement("p", describe(building.id)),
    textElement("h4", "Trainer"),
  );
  if (trainerJob) item.append(jobList([trainerJob], building, page, receivedAt));
  else item.append(startForm(building, page, receivedAt, true));
  item.append(
    textElement(
      "h4",
      `Training: ${trainees.length} of ${building.slots} ${building.slots === 1 ? "slot" : "slots"} in use`,
    ),
  );
  if (trainees.length > 0) item.append(jobList(trainees, building, page, receivedAt));
  if (trainees.length < building.slots) item.append(startForm(building, page, receivedAt, false));
  item.append(upgradeRow(building, page));
  return item;
}

/** A building the player hasn't built yet, with a Build button (issue #297). */
function unbuiltCard(id: BuildingId, page: VillagePage): HTMLLIElement {
  const { name, buildCost } = BUILDINGS[id];
  const item = document.createElement("li");
  item.append(textElement("h3", `${name} · not built yet`), textElement("p", describe(id)));
  if (buildCost) {
    item.append(
      costButton(`Build: ${costText(buildCost)}`, buildCost, page, null, () => api.build({ building: id })),
    );
  }
  return item;
}

/** What a building does, as its card says it. */
function describe(id: BuildingId): string {
  const { earns } = BUILDINGS[id];
  if (earns === "xp") {
    return (
      `Characters training here gain ${TRAINING_XP_PER_HOUR} XP for every full hour, up to their max level. ` +
      `Training lasts 24 hours; then the character rests, as after a dungeon. The trainer stays 1 hour per ` +
      `level and gains no XP, but makes training faster for lower-ranked characters: +100% per rank of ` +
      `difference. An advanced class counts as 5 ranks higher, and only trains adventurers and its own ` +
      `class. Taken out early, a character keeps the XP of its full hours. Each level opens one more ` +
      `training slot.`
    );
  }
  return (
    `Earns ${earns}: 1 per rank of the character for every full hour it works. A job lasts 1 hour per ` +
    `level of the character; then it rests, as after a dungeon. Each level opens one more slot.`
  );
}

function jobList(
  jobs: VillageJob[],
  building: VillageBuilding,
  page: VillagePage,
  receivedAt: number,
): HTMLUListElement {
  const list = document.createElement("ul");
  list.className = "jobs";
  list.append(...jobs.map((job) => jobItem(job, building, page, receivedAt)));
  return list;
}

/**
 * The Upgrade button with the cost of the next level, worked out with the
 * same shared rules the server uses. It is greyed out, saying why, when the
 * player can't afford it or the building is at its max level. The server
 * checks both again.
 */
function upgradeRow(building: VillageBuilding, page: VillagePage): HTMLElement {
  const cost = upgradeCost(building.id, building.level);
  const next = building.level + 1;
  return costButton(
    cost ? `Upgrade to level ${next}: ${costText(cost)}` : "Upgrade",
    cost,
    page,
    "It is at its max level.",
    // The level we show: if the building is past it already, the server buys nothing.
    () => api.upgradeBuilding({ building: building.id, level: building.level }),
  );
}

/**
 * A button that pays a cost: an upgrade or a build. Greyed out, saying why,
 * when there is no cost (`noCostReason`) or the player can't afford it. The
 * server checks both again.
 */
function costButton(
  label: string,
  cost: Cost | null,
  page: VillagePage,
  noCostReason: string | null,
  send: () => Promise<Result<VillagePage>>,
): HTMLElement {
  const row = document.createElement("div");
  row.className = "card-actions";
  const button = textElement("button", label);
  button.type = "button";
  button.className = "secondary";
  row.append(button);
  const reason = !cost ? noCostReason : !canPay(page, cost) ? "You don't have enough for this yet." : null;
  if (reason) {
    button.disabled = true;
    const note = textElement("span", reason);
    note.className = "hint";
    row.append(" ", note);
    return row;
  }
  button.addEventListener("click", async () => {
    button.disabled = true; // no second request from a double tap
    await showResult(await send());
  });
  return row;
}

/** One character at work: what it has earned so far, when it is done, and a button to take it out. */
function jobItem(job: VillageJob, building: VillageBuilding, page: VillagePage, receivedAt: number): HTMLLIElement {
  const { earns } = BUILDINGS[building.id];
  const unit = earns === "xp" ? "XP" : earns;
  const character = page.characters.find((c) => c.number === job.number);
  const name = character ? nameOfCharacter(character) : `Character ${job.number}`;
  const done = `done at ${localTime(receivedAt + job.doneInMs)}`;
  // What it keeps if taken out now, worked out by the server; it changes at
  // the next full hour, when the page is fetched again (`scheduleRefresh`).
  const soFar = job.earnedSoFar;
  const speed = earns === "xp" && job.perHour > TRAINING_XP_PER_HOUR ? ` (×${job.perHour / TRAINING_XP_PER_HOUR})` : "";
  const item = document.createElement("li");
  // textContent: the player chose the name.
  item.append(
    textElement(
      "span",
      job.trainer
        ? `${name}: ${done}`
        : `${name}: ${job.perHour} ${unit} an hour${speed}, ${soFar} so far · ${done}`,
    ),
  );
  const button = textElement("button", "Take out");
  button.type = "button";
  button.className = "secondary";
  button.setAttribute("aria-label", `Take ${name} out of the ${BUILDINGS[building.id].name.toLowerCase()}`);
  button.addEventListener("click", async () => {
    const rest = character ? REST_MINUTES[character.rank] : undefined;
    const keeps = job.trainer
      ? "Training goes on at the normal speed"
      : `It keeps the ${soFar} ${unit} of the full hours it ${earns === "xp" ? "trained" : "worked"}`;
    const question =
      `Take ${name} out now?\n\n${keeps}` +
      (rest === undefined ? "" : `, and ${name} rests for ${rest} minutes before it can go into a dungeon`) +
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
 * Choosing a character to put to work, or to train or be the trainer:
 * only characters that are ready and not in a game or party, best first.
 * A character at its max level can't train. Each option says how long the
 * job would last and what it would earn, with the same shared rules the
 * server uses when it starts the job.
 */
function startForm(building: VillageBuilding, page: VillagePage, receivedAt: number, asTrainer: boolean): HTMLElement {
  const { name, earns } = BUILDINGS[building.id];
  const training = earns === "xp" && !asTrainer;
  const candidates = page.characters
    .filter((c) => !c.inGame && isReady(localRest(c, receivedAt)))
    .filter((c) => !training || c.xp < maxXp(c.class, c.rank))
    .sort((a, b) => b.rank - a.rank || level(b) - level(a) || a.number - b.number);
  const row = document.createElement("div");
  row.className = "card-actions";
  if (candidates.length === 0) {
    const note = textElement(
      "p",
      training
        ? "None of your characters can train now: they are working, resting, in a game or at their max level."
        : "None of your characters is free to work now: they are working, resting or in a game.",
    );
    note.className = "hint";
    row.append(note);
    return row;
  }
  const trainerJob = building.jobs.find((job) => job.trainer);
  const trainer = trainerJob ? (page.characters.find((c) => c.number === trainerJob.number) ?? null) : null;
  // A <select> is the browser's own dropdown, like a ComboBox in WinForms.
  const select = document.createElement("select");
  select.setAttribute(
    "aria-label",
    asTrainer ? `Character to be the trainer` : `Character to put to work in the ${name.toLowerCase()}`,
  );
  for (const character of candidates) {
    const hours = jobLengthMs(building.id, level(character), asTrainer) / HOUR_MS;
    const duration = `${hours} ${hours === 1 ? "hour" : "hours"}`;
    const earnsText = asTrainer
      ? ""
      : training
        ? `, ${trainingXpPerHour(trainer, character)} XP an hour`
        : `, ${earnedPerHour(character.rank) * hours} ${earns}`;
    const option = textElement(
      "option",
      `${nameOfCharacter(character)} - ${CLASSES[character.class].name.toLowerCase()} rank ${character.rank} · ` +
        `level ${level(character)}: ${duration}${earnsText}`,
    );
    option.value = String(character.number);
    select.append(option);
  }
  const button = textElement("button", asTrainer ? "Start as trainer" : training ? "Start training" : "Start working");
  button.type = "button";
  button.addEventListener("click", async () => {
    button.disabled = true; // no second request from a double tap
    const number = Number(select.value);
    await showResult(await api.startJob({ building: building.id, number, ...(asTrainer ? { trainer: true } : {}) }));
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
