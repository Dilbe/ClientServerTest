// The village page (design.md, The village page; issues #295 and #360): an
// overview with a tile per building, and a screen per building with who
// works there, putting characters to work or taking them out, and upgrading.
//
// As on the character page, the server sends what it stores and the page
// only shows what's possible: the server checks every action again, and
// works out what a job earns itself.

import { nameOfCharacter, type CharacterSummary } from "../shared/characters.ts";
import { levelFromXp, maxXp } from "../shared/rules/advancement.ts";
import { REST_MINUTES, restState } from "../shared/rules/rest.ts";
import {
  BUILDINGS,
  canPay,
  costText,
  earnedPerHour,
  HOUR_MS,
  jobLengthMs,
  marketAmount,
  marketJobMs,
  marketSilver,
  recruitCount,
  RECRUITING_MIN_RANK,
  RESOURCE_IDS,
  restCutMs,
  restSpeed,
  trainingXpPerHour,
  upgradeCost,
  type BuildingId,
  type Cost,
  type ResourceId,
} from "../shared/rules/village.ts";
import type { VillageBuilding, VillageJob, VillagePage } from "../shared/village.ts";
import { api, type Result } from "./api.ts";
import { isReady, localRest, localTime } from "./rest.ts";
import {
  capitalize,
  characterLabel,
  classBonusText,
  discountText,
  floorText,
  freeSlotsText,
  isBuildingId,
  jobText,
  levelText,
  shortDuration,
  slotCount,
  slotDots,
  statusText,
} from "./village-text.ts";

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
/**
 * The building the address asks for (`#/village/<id>`), as typed: anyone can
 * type any address, so `render` checks it. Null for the overview.
 */
let wanted: string | null = null;
/** The page last fetched, to draw the other screen at once while the new one is fetched. */
let lastPage: { page: VillagePage; receivedAt: number } | undefined;

/**
 * Fetches the village and draws the overview (`building` null) or the screen
 * of one building, as the address says.
 */
export async function showVillage(
  building: string | null,
  onResourcesChanged: (resources: Resources) => void,
): Promise<void> {
  resourcesChanged = onResourcesChanged;
  wanted = building;
  errorElement.textContent = "";
  if (lastPage) render(lastPage.page, lastPage.receivedAt);
  const result = await api.village();
  if (!result.ok) {
    errorElement.textContent = result.error;
    return;
  }
  // The player may have gone to another screen while this was on its way.
  if (wanted !== building) return;
  render(result.data);
}

/** The page is no longer on screen: stop fetching it. */
export function stopVillage(): void {
  window.clearTimeout(refreshTimer);
  refreshTimer = undefined;
}

function render(page: VillagePage, receivedAt = Date.now()): void {
  lastPage = { page, receivedAt };
  resourcesChanged(page);
  const building = wanted === null ? undefined : page.buildings.find((b) => b.id === wanted);
  if (wanted !== null && !(isBuildingId(wanted) && building)) {
    // Not a building, or one the player hasn't built: show the overview
    // instead. replace() changes the address without a new step in the
    // browser's history, so the back button doesn't come back here.
    location.replace("#/village");
    return;
  }
  element("#village-locked").hidden = page.unlocked;
  element("#village-title").textContent = building ? BUILDINGS[building.id].name : "Your village";
  element("#village-back").hidden = !building;
  element("#village-resources").textContent = page.unlocked ? `${page.wood} wood · ${page.stone} stone` : "";
  const list = element("#village-buildings");
  const unbuilt = element<HTMLDetailsElement>("#village-unbuilt");
  if (building) {
    list.className = "characters";
    list.replaceChildren(buildingCard(building, page, receivedAt));
    unbuilt.hidden = true;
  } else {
    list.className = "village-tiles";
    list.replaceChildren(...page.buildings.map((b) => tile(b, receivedAt)));
    // The <details> element stays, so whether it is open stays too.
    unbuilt.hidden = page.unbuilt.length === 0;
    element("#village-unbuilt-list").replaceChildren(...page.unbuilt.map((id) => unbuiltCard(id, page)));
  }
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
  refreshTimer = window.setTimeout(() => void showVillage(wanted, resourcesChanged), Math.min(...waits) + 1000);
}

// ---- The overview ----

/**
 * A building's tile on the overview: name, level, slots and one status
 * line. The whole tile is a link to the building's screen, so it works with
 * the keyboard and the back button like any link.
 */
function tile(building: VillageBuilding, receivedAt: number): HTMLLIElement {
  const link = document.createElement("a");
  link.href = `#/village/${building.id}`;
  const title = document.createElement("span");
  title.className = "tile-title";
  title.append(textElement("strong", BUILDINGS[building.id].name));
  const level = levelText(building.id, building.level);
  if (level) title.append(" ", small(level));
  const slots = slotCount(building);
  const dots = textElement("span", slotDots(building.jobs.length, slots));
  dots.className = "slot-dots";
  // A screen reader would read "black circle, black circle, white circle".
  dots.setAttribute("aria-label", `${building.jobs.length} of ${slots} ${slots === 1 ? "slot" : "slots"} in use`);
  const status = textElement("span", statusText(building, (ms) => localTime(receivedAt + ms)));
  link.append(title, dots, status);
  const free = freeSlotsText(building);
  if (free) {
    const mark = textElement("span", free);
    mark.className = "free-slots";
    link.append(mark);
  }
  const item = document.createElement("li");
  item.append(link);
  return item;
}

/** A building the player hasn't built yet, with a Build button (issue #297). */
function unbuiltCard(id: BuildingId, page: VillagePage): HTMLLIElement {
  const { name, buildCost } = BUILDINGS[id];
  const item = document.createElement("li");
  item.append(textElement("h3", name), textElement("p", describe(id)));
  if (buildCost) {
    item.append(
      costButton(`Build: ${costText(buildCost)}`, buildCost, page, () => api.build({ building: id })),
    );
  }
  return item;
}

/** What a building does, in one line: only for the buildings not built yet. The game guide has the details. */
function describe(id: BuildingId): string {
  const { earns, speedsUp, cutsRest, sellsResources, lowersHeroPrices, recruits } = BUILDINGS[id];
  if (recruits) return "Put a senior hero to work here to recruit new adventurers.";
  if (lowersHeroPrices) return "Put a hero here: when it is done, buying a new hero costs less.";
  if (cutsRest) return "Put a hero here to cut the rest of another hero.";
  if (sellsResources) return "Put a hero here to sell wood or stone for silver.";
  if (speedsUp) return `Put a hero here to make ${speedsUp} faster for all your heroes.`;
  if (earns === "xp") return "Put heroes here to gain XP. A trainer makes training faster if it's of higher rank.";
  return `Put a hero to work here to gain ${earns}.`;
}

// ---- A building screen ----

function buildingCard(building: VillageBuilding, page: VillagePage, receivedAt: number): HTMLLIElement {
  const { trainerSlot, speedsUp, cutsRest, sellsResources } = BUILDINGS[building.id];
  const item = document.createElement("li");
  item.append(header(building));
  if (trainerSlot) appendTraining(item, building, page, receivedAt);
  else {
    if (speedsUp) {
      const job = building.jobs[0];
      item.append(
        textElement("p", job ? `${capitalize(speedsUp)} ×${job.perHour} now` : `${capitalize(speedsUp)} at normal speed`),
      );
    }
    if (building.jobs.length > 0) item.append(jobList(building.jobs, building, page, receivedAt));
    if (building.jobs.length < building.slots) {
      item.append(
        cutsRest
          ? pubForm(building, page, receivedAt)
          : sellsResources
            ? marketForm(building, page, receivedAt)
            : startForm(building, page, receivedAt, false),
      );
    }
  }
  const upgrade = upgradeRow(building, page);
  if (upgrade) item.append(upgrade);
  return item;
}

/** The top of a building screen: "Lv 3/5 · ●●○ · How it works". */
function header(building: VillageBuilding): HTMLElement {
  const line = document.createElement("p");
  line.className = "small";
  const level = levelText(building.id, building.level);
  if (level) line.append(`${level} · `);
  const slots = slotCount(building);
  const dots = textElement("span", slotDots(building.jobs.length, slots));
  dots.className = "slot-dots";
  dots.setAttribute("aria-label", `${building.jobs.length} of ${slots} ${slots === 1 ? "slot" : "slots"} in use`);
  line.append(dots, " · ", guideLink());
  return line;
}

/**
 * A link to the village part of the game guide. The guide is one screen
 * (#/guide), so the link goes there and then scrolls to the section, as the
 * guide's own contents list does.
 */
function guideLink(): HTMLAnchorElement {
  const link = textElement("a", "How it works");
  link.href = "#/guide";
  link.addEventListener("click", (event) => {
    event.preventDefault();
    // Added after main.ts's own listener, so it runs once the guide is shown.
    window.addEventListener(
      "hashchange",
      () => document.getElementById("guide-village")?.scrollIntoView(),
      { once: true },
    );
    location.hash = "#/guide";
  });
  return link;
}

/**
 * The training house (design.md, The training house; issue #297): the
 * trainer slot first, then the trainees.
 */
function appendTraining(item: HTMLElement, building: VillageBuilding, page: VillagePage, receivedAt: number): void {
  const trainerJob = building.jobs.find((job) => job.trainer);
  const trainees = building.jobs.filter((job) => !job.trainer);
  item.append(textElement("h4", "Trainer"));
  if (trainerJob) item.append(jobList([trainerJob], building, page, receivedAt));
  else item.append(startForm(building, page, receivedAt, true));
  const heading = textElement("h4", "Training ");
  const dots = textElement("span", slotDots(trainees.length, building.slots));
  dots.className = "slot-dots";
  dots.setAttribute("aria-label", `${trainees.length} of ${building.slots} training slots in use`);
  heading.append(dots);
  item.append(heading);
  if (trainees.length > 0) item.append(jobList(trainees, building, page, receivedAt));
  if (trainees.length < building.slots) item.append(startForm(building, page, receivedAt, false));
}

/**
 * The pub's two dropdowns: whose rest to cut (only characters that are
 * resting, not healing), then who goes in (only free characters of a high
 * enough rank), each saying how much it would cut. Worked out with the same
 * shared rules the server uses; the server checks it all again.
 */
function pubForm(building: VillageBuilding, page: VillagePage, receivedAt: number): HTMLElement {
  const now = Date.now();
  const restLeftMs = (c: CharacterSummary) => localRest(c, receivedAt).restingUntil - now;
  const resting = page.characters
    .filter((c) => restState(localRest(c, receivedAt), now) === "resting")
    .sort((a, b) => restLeftMs(b) - restLeftMs(a) || a.number - b.number);
  const free = freeCharacters(page, receivedAt);
  const row = document.createElement("div");
  row.className = "card-actions";
  const note = (text: string) => {
    const hint = textElement("p", text);
    hint.className = "hint";
    row.append(hint);
    return row;
  };
  if (resting.length === 0) return note("None of your characters is resting now, so there is no rest to cut.");
  if (free.length === 0) return note("None of your characters is free to go to the pub now.");

  const restSelect = document.createElement("select");
  restSelect.setAttribute("aria-label", "Character whose rest to cut");
  for (const character of resting) {
    const option = textElement(
      "option",
      `${nameOfCharacter(character)} - R${character.rank}: ${shortMinutes(restLeftMs(character))} rest left`,
    );
    option.value = String(character.number);
    restSelect.append(option);
  }
  const drinkerSelect = document.createElement("select");
  drinkerSelect.setAttribute("aria-label", "Character to go to the pub");
  const button = textElement("button", "Go to the pub");
  button.type = "button";

  // The second dropdown depends on the first: how much each free character
  // would cut of that rest. Any rank can cut any rest (issue #362).
  const fillDrinkers = () => {
    const target = resting.find((c) => c.number === Number(restSelect.value));
    drinkerSelect.replaceChildren();
    if (!target) return;
    for (const character of free) {
      const cut = restCutMs(character, level(character), restLeftMs(target));
      const option = textElement("option", `${characterLabel(character)}: cuts ${shortMinutes(cut)}`);
      option.value = String(character.number);
      drinkerSelect.append(option);
    }
    button.disabled = drinkerSelect.options.length === 0;
    button.title = button.disabled ? "None of your characters is free." : "";
  };
  restSelect.addEventListener("change", fillDrinkers);
  fillDrinkers();

  button.addEventListener("click", async () => {
    const target = resting.find((c) => c.number === Number(restSelect.value));
    const drinker = free.find((c) => c.number === Number(drinkerSelect.value));
    if (!target || !drinker) return;
    const cut = restCutMs(drinker, level(drinker), restLeftMs(target));
    const question =
      `Cut ${minutesText(cut)} of ${nameOfCharacter(target)}'s rest?\n\n` +
      `${nameOfCharacter(drinker)} stays in the pub for ${minutesText(cut)} and can't be taken out early. ` +
      `Then it rests for ${REST_MINUTES[drinker.rank]} minutes before it can go into a dungeon.`;
    if (!confirm(question)) return;
    button.disabled = true; // no second request from a double tap
    await showResult(
      await api.startJob({ building: building.id, number: drinker.number, cutRestOf: target.number }),
    );
  });
  row.append(restSelect, drinkerSelect, button);
  return row;
}

/**
 * The market's two dropdowns: what to sell, then who sells it (only free
 * characters), each saying how much it would sell, for how much silver and
 * how long it takes. A character that would sell more than the player has
 * is left out. Worked out with the same shared rules the server uses; the
 * server checks it all again.
 */
function marketForm(building: VillageBuilding, page: VillagePage, receivedAt: number): HTMLElement {
  const free = freeCharacters(page, receivedAt);
  const row = document.createElement("div");
  row.className = "card-actions";
  if (free.length === 0) {
    const hint = textElement("p", "None of your characters is free to go to the market now.");
    hint.className = "hint";
    row.append(hint);
    return row;
  }
  const resourceSelect = document.createElement("select");
  resourceSelect.setAttribute("aria-label", "Resource to sell");
  for (const resource of RESOURCE_IDS) {
    const option = textElement("option", `Sell ${resource} (you have ${page[resource]})`);
    option.value = resource;
    resourceSelect.append(option);
  }
  const sellerSelect = document.createElement("select");
  sellerSelect.setAttribute("aria-label", "Character to go to the market");
  const button = textElement("button", "Go to the market");
  button.type = "button";

  const resource = () => resourceSelect.value as ResourceId;
  const sale = (c: CharacterSummary) => {
    const amount = marketAmount(level(c));
    return { amount, silver: marketSilver(c, amount), ms: marketJobMs(c, level(c)) };
  };
  // The second dropdown depends on the first: only who can sell that much.
  const fillSellers = () => {
    sellerSelect.replaceChildren();
    for (const character of free.filter((c) => sale(c).amount <= page[resource()])) {
      const { amount, silver, ms } = sale(character);
      const option = textElement(
        "option",
        `${characterLabel(character)}: ${amount} ${resource()} for ${silver} silver, ${shortDuration(ms)}`,
      );
      option.value = String(character.number);
      sellerSelect.append(option);
    }
    button.disabled = sellerSelect.options.length === 0;
    button.title = button.disabled ? `You don't have enough ${resource()} for any of your free characters.` : "";
  };
  resourceSelect.addEventListener("change", fillSellers);
  fillSellers();

  button.addEventListener("click", async () => {
    const seller = free.find((c) => c.number === Number(sellerSelect.value));
    if (!seller) return;
    const { amount, silver, ms } = sale(seller);
    const question =
      `Sell ${amount} ${resource()} for ${silver} silver?\n\n` +
      `The ${resource()} is taken now. ${nameOfCharacter(seller)} stays in the market for ${durationText(ms)}; ` +
      "the silver comes only if it stays the full time. Taken out early, you get the " +
      `${resource()} back but no silver. Then it rests for ${REST_MINUTES[seller.rank]} minutes before it can go ` +
      "into a dungeon.";
    if (!confirm(question)) return;
    button.disabled = true; // no second request from a double tap
    await showResult(await api.startJob({ building: building.id, number: seller.number, sells: resource() }));
  });
  row.append(resourceSelect, sellerSelect, button);
  return row;
}

/** The characters that can start a job now: ready, and not in a game or party. Best first. */
function freeCharacters(page: VillagePage, receivedAt: number): CharacterSummary[] {
  return page.characters
    .filter((c) => !c.inGame && isReady(localRest(c, receivedAt)))
    .sort((a, b) => b.rank - a.rank || level(b) - level(a) || a.number - b.number);
}

/** A duration as the confirmation questions say it: "45 minutes", "2 hours 30 minutes". */
function durationText(ms: number): string {
  const hours = Math.floor(ms / HOUR_MS);
  const minutes = Math.round((ms % HOUR_MS) / 60_000);
  const parts = [
    ...(hours > 0 ? [`${hours} ${hours === 1 ? "hour" : "hours"}`] : []),
    ...(minutes > 0 || hours === 0 ? [`${minutes} ${minutes === 1 ? "minute" : "minutes"}`] : []),
  ];
  return parts.join(" ");
}

/** A duration as the pub's question says it, rounded up to the minute: "45 minutes". */
function minutesText(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
}

/** The same, short, for the pub's dropdowns: "45 min". */
function shortMinutes(ms: number): string {
  return `${Math.max(1, Math.ceil(ms / 60_000))} min`;
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
 * The Upgrade button with the next level and its cost, worked out with the
 * same shared rules the server uses, greyed out when the player can't
 * afford it. None at the max level. The server checks both again.
 */
function upgradeRow(building: VillageBuilding, page: VillagePage): HTMLElement | null {
  const cost = upgradeCost(building.id, building.level);
  if (!cost) return null;
  return costButton(
    `Upgrade to Lv ${building.level + 1}: ${costText(cost)}`,
    cost,
    page,
    // The level we show: if the building is past it already, the server buys nothing.
    () => api.upgradeBuilding({ building: building.id, level: building.level }),
  );
}

/**
 * A button that pays a cost: an upgrade or a build. Greyed out when the
 * player can't afford it. The server checks it again.
 */
function costButton(
  label: string,
  cost: Cost,
  page: VillagePage,
  send: () => Promise<Result<VillagePage>>,
): HTMLElement {
  const row = document.createElement("div");
  row.className = "card-actions";
  const button = textElement("button", label);
  button.type = "button";
  button.className = "secondary";
  row.append(button);
  if (!canPay(page, cost)) {
    button.disabled = true;
    return row;
  }
  button.addEventListener("click", async () => {
    button.disabled = true; // no second request from a double tap
    await showResult(await send());
  });
  return row;
}

/** One character at work, as a compact row, with a button to take it out. */
function jobItem(job: VillageJob, building: VillageBuilding, page: VillagePage, receivedAt: number): HTMLLIElement {
  const { earns, speedsUp, cutsRest, lowersHeroPrices, recruits } = BUILDINGS[building.id];
  const unit = earns === "xp" ? "XP" : earns;
  const character = page.characters.find((c) => c.number === job.number);
  const name = character ? nameOfCharacter(character) : `Character ${job.number}`;
  // What it keeps if taken out now, worked out by the server; it changes at
  // the next full hour, when the page is fetched again (`scheduleRefresh`).
  const soFar = job.earnedSoFar;
  const item = document.createElement("li");
  // textContent: the player chose the name.
  item.append(textElement("span", jobText(job, building.id, character, localTime(receivedAt + job.doneInMs))));
  // The pub's characters can't be taken out early (issue #299).
  if (cutsRest) return item;
  const button = textElement("button", "Take out");
  button.type = "button";
  button.className = "secondary";
  button.setAttribute("aria-label", `Take ${name} out of the ${BUILDINGS[building.id].name.toLowerCase()}`);
  button.addEventListener("click", async () => {
    const rest = character ? REST_MINUTES[character.rank] : undefined;
    const keeps = job.trainer
      ? "Training goes on at the normal speed"
      : speedsUp
        ? `${capitalize(speedsUp)} goes on at the normal speed`
        : lowersHeroPrices
          ? "It doesn't lower the prices"
          : recruits
            ? "It recruits no one"
            : job.sale
              ? `It gets no silver; you get the ${job.sale.amount} ${job.sale.resource} back`
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
  const { name, earns, speedsUp, lowersHeroPrices, recruits } = BUILDINGS[building.id];
  const training = earns === "xp" && !asTrainer;
  const candidates = freeCharacters(page, receivedAt)
    .filter((c) => !training || c.xp < maxXp(c.class, c.rank))
    // The recruiting office only takes a senior hero (issue #358).
    .filter((c) => !recruits || recruitCount(c) > 0);
  const row = document.createElement("div");
  row.className = "card-actions";
  if (candidates.length === 0) {
    const note = textElement(
      "p",
      training
        ? "None of your characters can train now: they are working, resting, in a game or at their max level."
        : recruits
          ? `None of your characters can recruit now: it takes rank ${RECRUITING_MIN_RANK} or higher, or an advanced class, that isn't working, resting or in a game.`
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
    const lengthMs = jobLengthMs(building.id, level(character), asTrainer);
    const hours = lengthMs / HOUR_MS;
    // A trainee leaves earlier when it reaches its max level first (issue #321).
    // The trading post's 30 minutes per level can give half hours (issue #353).
    const duration = `${training ? "up to " : ""}${shortDuration(lengthMs)}`;
    const earnsText = asTrainer
      ? ""
      : training
        ? `, ${trainingXpPerHour(trainer, character)} XP/h`
        : speedsUp
          ? `, ${speedsUp} ×${restSpeed(character, building.id)}`
          : lowersHeroPrices
            ? `, prices −${discountText(level(character))} (floor −${floorText(character)})`
            : recruits
              ? `, recruits ${recruitCount(character)}`
              : `, ${earnedPerHour(character, building.id) * hours} ${earns}`;
    const option = textElement(
      "option",
      `${characterLabel(character)}: ${duration}${earnsText}${classBonusText(character, building.id, training)}`,
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

function small(text: string): HTMLElement {
  const found = textElement("span", text);
  found.className = "small";
  return found;
}

function textElement<K extends keyof HTMLElementTagNameMap>(tag: K, text: string): HTMLElementTagNameMap[K] {
  const found = document.createElement(tag);
  // textContent, never innerHTML (see main.ts).
  found.textContent = text;
  return found;
}
