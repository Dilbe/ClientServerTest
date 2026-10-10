// Shows the lobby: the open games ("Find a game"), your party ("Party"), the
// two choice screens opened from those ("Choose a dungeon", "Choose your
// characters"), or the started game. The code keeps calling all of it the
// lobby; only the player sees the screen names.
//
// Every lobby message is a full snapshot, so drawing simply starts over each
// time instead of updating what is already on screen.

import {
  MAX_CHARACTERS_PER_PLAYER,
  type LobbyCharacter,
  type LobbyGame,
  type LobbyMessage,
  type TurnOrderEntry,
} from "../shared/protocol.ts";
import {
  canPlay,
  DIFFICULTIES,
  DIFFICULTY_IDS,
  dungeonStatus,
  hasCleared,
  isDifficultyUnlocked,
  nextDungeon,
  type DungeonChoice,
  type DungeonStatus,
  type DungeonWin,
} from "../shared/rules/difficulties.ts";
import { dungeonFullXp } from "../shared/rules/diminishing-returns.ts";
import { DUNGEON_IDS, DUNGEONS } from "../shared/rules/dungeon-map.ts";
import type { Rest } from "../shared/rules/rest.ts";
import { isReady, localRest, restText, RestTimer } from "./rest.ts";
import {
  DEFAULT_TURN_DURATION,
  describeTurnDuration,
  TURN_DURATION_IDS,
  type TurnDurationId,
} from "../shared/turn-durations.ts";
import { describeOneTimeRewards } from "./rewards.ts";

export interface LobbyActions {
  join(gameId: string, characters: number[]): void;
  chooseCharacters(characters: number[]): void;
  chooseDungeon(choice: DungeonChoice): void;
  setTurnOrder(order: TurnOrderEntry[]): void;
}

function element(selector: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(selector);
  if (!found) throw new Error(`missing element ${selector}`);
  return found;
}

/**
 * Which part of the lobby the player asked for: the main screen ("Find a
 * game" or "Party", whichever fits) or one of the choice screens. main.ts
 * sets it from the address (#/choose-dungeon, #/choose-characters).
 */
export type LobbyPanel = "main" | "dungeon" | "characters";
let panel: LobbyPanel = "main";

export function setLobbyPanel(next: LobbyPanel): void {
  panel = next;
}

/** The latest actions, for listeners made before the latest lobby arrived. */
let currentActions: LobbyActions | undefined;

/**
 * The characters to bring into the next game created or joined, by number.
 * Outside a game only the browser knows this choice; in an open game the
 * server's copy counts, and this follows it, so leaving keeps the choice.
 */
let choice: number[] = [];

/** The characters chosen for a new game: for the "Create a game" button. */
export function chosenCharacters(): number[] {
  return [...choice];
}

/**
 * The turn duration list next to "Create a game". Its options never
 * change, so they are made once, with the default selected; the browser
 * keeps the player's choice from then on.
 */
const turnDurationSelect = element("#turn-duration-select") as HTMLSelectElement;
for (const id of TURN_DURATION_IDS) {
  const option = document.createElement("option");
  option.value = id;
  option.textContent = describeTurnDuration(id);
  turnDurationSelect.append(option);
}
turnDurationSelect.value = DEFAULT_TURN_DURATION;

/** The turn duration chosen for a new game: for the "Create a game" button. */
export function chosenTurnDuration(): TurnDurationId {
  return turnDurationSelect.value as TurnDurationId;
}

/** Redraws the choice when a character's rest changes (see rest.ts). */
const restTimer = new RestTimer();

/** `receivedAt`: when the lobby message arrived, by `Date.now()`, for the rests in it (see rest.ts). */
export function renderLobby(lobby: LobbyMessage, receivedAt: number, myName: string, actions: LobbyActions): void {
  currentActions = actions;
  const redraw = () => renderLobby(lobby, receivedAt, myName, actions);
  const rests = new Map(lobby.yourCharacters.map((c) => [c.number, localRest(c, receivedAt)]));
  const mine = lobby.myGame;
  const inParty = mine !== null && !mine.started;
  const isHost = inParty && mine.creator === myName;
  // A choice screen that doesn't fit (any more) shows the main screen
  // instead: the game started, or the player isn't the host (any more).
  // replaceState() changes the address without a "hashchange" event and
  // without a new entry for the back button.
  const shown = (panel === "dungeon" && !isHost) || (panel === "characters" && mine?.started) ? "main" : panel;
  if (shown !== panel) {
    panel = shown;
    history.replaceState(null, "", "#/");
  }
  element("#lobby-browse").hidden = mine !== null || shown !== "main";
  element("#lobby-party").hidden = !inParty || shown !== "main";
  element("#choose-dungeon").hidden = shown !== "dungeon";
  element("#choose-characters").hidden = shown !== "characters";
  element("#game").hidden = mine === null || !mine.started;

  if (inParty) {
    const me = mine.players.find((p) => p.displayName === myName);
    choice = me ? me.characters.map((c) => c.number) : choice;
  } else {
    // Characters may have been used up, added or gone to rest since; by
    // default, bring the first that is ready (design.md, Resting).
    const ready = (n: number) => rests.has(n) && isReady(rests.get(n)!);
    choice = choice.filter(ready);
    const first = sortedForChoice(lobby.yourCharacters).find((c) => ready(c.number));
    if (choice.length === 0 && first) choice = [first.number];
  }
  // With every character resting there is nothing to bring: the server would
  // drop a game without characters.
  (element("#create-button") as HTMLButtonElement).disabled = choice.length === 0;
  if (mine === null || !mine.started) {
    renderCharacterSummary(lobby);
    renderCharacterChoice(lobby, rests, inParty, redraw);
    restTimer.set([...rests.values()], redraw);
  }

  if (mine === null) renderOpenGames(lobby.openGames, actions);
  else if (!mine.started) renderParty(mine, isHost, lobby.dungeonWins);
  else renderPlayers(element("#game-players"), mine);
}

/**
 * The chosen characters on "Find a game", by name, with a link to "Choose
 * your characters" to change them. In the party, the player's own card
 * already shows them.
 */
function renderCharacterSummary(lobby: LobbyMessage): void {
  const chosen = sortedForChoice(lobby.yourCharacters).filter((c) => choice.includes(c.number));
  element("#character-summary-hint").textContent =
    choice.length === 0
      ? "All your characters are resting after their last dungeon. Wait until one is ready, or buy one on the character page."
      : "";
  element("#character-summary-list").replaceChildren(
    // textContent: the player chose the name.
    ...chosen.map((c) => textElement("li", `${c.name} - rank ${c.rank} · level ${c.level}`, "")),
  );
}

/**
 * "Choose your characters": one checkbox per character, so taking one out of
 * the choice is unticking it. Outside a game, a change only changes the
 * local choice (`redraw` shows it); in an open game it is sent to the
 * server, and the checkboxes follow when the new lobby arrives. Choices the
 * server would refuse anyway (none, or more than 3) can't be made here.
 * Whether the party has room is only known to the server: it says so when
 * the choice is too big, and the old choice stays.
 */
function renderCharacterChoice(
  lobby: LobbyMessage,
  rests: ReadonlyMap<number, Rest>,
  inParty: boolean,
  redraw: () => void,
): void {
  element("#character-choice-hint").textContent = inParty
    ? `Tick 1 to ${MAX_CHARACTERS_PER_PLAYER} characters; untick one to leave it out. You can change this until the game starts.`
    : choice.length === 0
      ? "All your characters are resting after their last dungeon. Wait until one is ready, or buy one on the character page."
      : `Tick 1 to ${MAX_CHARACTERS_PER_PLAYER} characters to bring into the game you create or join; untick one to leave it out.`;
  element("#character-choices").replaceChildren(
    ...sortedForChoice(lobby.yourCharacters).map((character) => {
      const checked = choice.includes(character.number);
      // A resting character can't be chosen (design.md, Resting). The
      // server refuses it too: this only saves a refusal.
      const rest = restText(rests.get(character.number)!);
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = checked;
      box.disabled = checked
        ? choice.length === 1
        : choice.length >= MAX_CHARACTERS_PER_PLAYER || rest !== undefined;
      box.addEventListener("change", () => {
        const next = box.checked
          ? [...choice, character.number].sort((a, b) => a - b)
          : choice.filter((n) => n !== character.number);
        if (inParty) {
          currentActions?.chooseCharacters(next);
        } else {
          choice = next;
          redraw();
        }
      });
      const label = document.createElement("label");
      // textContent: the player chose the name.
      label.append(box, `${character.name} - rank ${character.rank} · level ${character.level}`);
      const item = document.createElement("li");
      item.append(label);
      if (rest) item.append(" ", textElement("span", rest, "small"));
      return item;
    }),
  );
}

/**
 * Highest rank first, then highest level, like the character page
 * (design.md, The character page). The server sends them by number, and
 * sort() keeps that order for ties because it is stable. A copy, so the
 * lobby as the server sent it stays as it was.
 */
function sortedForChoice(characters: LobbyMessage["yourCharacters"]): LobbyMessage["yourCharacters"] {
  return [...characters].sort((a, b) => b.rank - a.rank || b.level - a.level);
}

function renderOpenGames(games: LobbyGame[], actions: LobbyActions): void {
  element("#no-games").hidden = games.length > 0;
  const list = element("#open-games");
  list.replaceChildren(
    ...games.map((game) => {
      const item = document.createElement("li");
      const names = document.createElement("span");
      // textContent, never innerHTML: names come from other players.
      const dungeon = DUNGEONS[game.dungeonId];
      names.textContent =
        `${game.players.map((p) => p.displayName).join(", ")} · ` +
        `${dungeon.name} on ${DIFFICULTIES[game.difficulty].name} · ` +
        `${characterCount(game)} of ${dungeon.maxCharacters} characters · ` +
        `${describeTurnDuration(game.turnDuration)} turns`;
      const join = document.createElement("button");
      join.type = "button";
      join.textContent = "Join";
      join.disabled = choice.length === 0;
      join.addEventListener("click", () => actions.join(game.id, chosenCharacters()));
      item.append(names, join);
      return item;
    }),
  );
}

function renderParty(game: LobbyGame, isHost: boolean, wins: readonly DungeonWin[]): void {
  element("#start-button").hidden = !isHost;
  renderDungeon(game, isHost, wins);
  element("#party-waiting").textContent = isHost
    ? "Start when everyone is here. Nobody can join after the start."
    : `Waiting for ${game.creator} to start the game.`;
  const dungeon = DUNGEONS[game.dungeonId];
  element("#party-players-title").textContent =
    `Players · ${characterCount(game)} of ${dungeon.maxCharacters} characters`;
  renderPlayerCards(game);
  renderTurnOrder(game, isHost);
}

/**
 * The turn order (design.md, Setting up the track): every character of the
 * party in the order they will act, with its player's name. A character
 * that joins goes to the end. The host can move characters with the up
 * and down buttons, or by dragging the handle; everyone else only sees the
 * order, which changes live. Each change sends the whole new order, and the
 * list is drawn again when the server's lobby comes back.
 */
function renderTurnOrder(game: LobbyGame, isHost: boolean): void {
  element("#turn-order-hint").textContent = isHost
    ? "The characters act in this order. Drag one by its handle, or use the arrows, to change it."
    : `The characters act in this order. ${game.creator} can change it.`;
  const list = element("#turn-order");
  const order = game.turnOrder;
  const move = (from: number, to: number) => {
    if (from === to) return;
    const next = [...order];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    currentActions?.setTurnOrder(next);
  };
  list.replaceChildren(
    ...order.map((entry, index) => {
      const player = game.players[entry.player];
      const character = player?.characters.find((c) => c.number === entry.number);
      const item = document.createElement("li");
      // textContent: the names come from other players.
      const name = textElement("span", `${character?.name ?? "?"} (${player?.displayName ?? "?"})`, "name");
      if (!isHost) {
        item.append(name);
        return item;
      }
      const handle = textElement("span", "≡", "drag-handle");
      handle.setAttribute("aria-hidden", "true");
      handle.addEventListener("pointerdown", (event) => dragInList(event, list, item, (to) => move(index, to)));
      item.append(handle, name, arrowButton("▲", "Move up", index > 0, () => move(index, index - 1)));
      item.append(arrowButton("▼", "Move down", index < order.length - 1, () => move(index, index + 1)));
      return item;
    }),
  );
}

function arrowButton(text: string, label: string, enabled: boolean, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "secondary";
  button.textContent = text;
  button.setAttribute("aria-label", label);
  button.disabled = !enabled;
  button.addEventListener("click", onClick);
  return button;
}

/**
 * Drags a list item up or down with a mouse, a finger or a pen. Pointer
 * events cover all three (the browser's own drag and drop doesn't work with
 * a finger on most phones). While dragging, the item is moved within the
 * list so the player sees where it will land; on release, `drop` gets its
 * new index. The list is drawn again when the server answers.
 */
function dragInList(event: PointerEvent, list: HTMLElement, item: HTMLElement, drop: (to: number) => void): void {
  event.preventDefault();
  item.classList.add("dragging");
  const home = item.nextSibling;
  // The moves and the release are followed on the whole window, not on the
  // handle: the pointer soon leaves the handle, and moving the item within
  // the list would end a pointer capture on it (setPointerCapture, much like
  // Control.Capture in WinForms).
  const onMove = (move: PointerEvent) => {
    if (move.pointerId !== event.pointerId) return;
    for (const other of list.children) {
      if (other === item) continue;
      const box = other.getBoundingClientRect();
      if (move.clientY < box.top || move.clientY > box.bottom) continue;
      // Past the middle of the other item: swap places with it.
      const before = move.clientY < box.top + box.height / 2;
      other.insertAdjacentElement(before ? "beforebegin" : "afterend", item);
      break;
    }
  };
  const onEnd = (end: PointerEvent) => {
    if (end.pointerId !== event.pointerId) return;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onEnd);
    window.removeEventListener("pointercancel", onEnd);
    item.classList.remove("dragging");
    // Cancelled (for example by the phone itself): back where it was.
    if (end.type === "pointerup") drop([...list.children].indexOf(item));
    else list.insertBefore(item, home);
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onEnd);
  window.addEventListener("pointercancel", onEnd);
}

/**
 * The party's players, one card each: their name, whether they are the
 * host or offline, and the characters they bring with the XP each would get
 * from the chosen dungeon (design.md, Diminishing returns).
 */
function renderPlayerCards(game: LobbyGame): void {
  element("#party-players").replaceChildren(
    ...game.players.map((player) => {
      const card = document.createElement("li");
      if (!player.online) card.classList.add("offline");
      const header = document.createElement("div");
      header.className = "card-header";
      // textContent, never innerHTML: names come from other players.
      header.append(textElement("strong", player.displayName, "player-name"));
      if (player.displayName === game.creator) header.append(textElement("span", "Host", "tag"));
      if (!player.online) header.append(textElement("span", "Offline", "tag"));
      const characters = document.createElement("ul");
      characters.className = "card-characters";
      characters.append(
        ...player.characters.map((character) => {
          const item = document.createElement("li");
          item.append(textElement("span", character.name, ""), textElement("span", describeXp(character), "small"));
          return item;
        }),
      );
      card.append(header, characters);
      return card;
    }),
  );
}

/** Like "70% XP" or "max level"; empty when the server didn't send it. */
function describeXp(character: LobbyCharacter): string {
  if (character.xp === undefined) return "";
  if (character.xp === "maxLevel") return "max level";
  return `${character.xp}% XP`;
}

function renderPlayers(list: HTMLElement, game: LobbyGame): void {
  list.replaceChildren(
    ...game.players.map((player) => {
      const item = document.createElement("li");
      item.textContent = player.displayName;
      if (player.displayName === game.creator) item.textContent += " (created the game)";
      if (!player.online) {
        item.textContent += " (offline)";
        item.classList.add("offline");
      }
      // The characters they bring, under their name. A started game that was
      // restored after a server restart has none: the game shows them.
      if (player.characters.length > 0) {
        const characters = document.createElement("span");
        characters.className = "player-characters small";
        characters.textContent = player.characters.map((c) => c.name).join(", ");
        item.append(characters);
      }
      return item;
    }),
  );
}

/**
 * The chosen dungeon and difficulty. Everyone sees the choice, which changes
 * live when the host changes it, and whether they have won that dungeon on
 * that difficulty before, and so whether a win gives them its one-time
 * rewards. Only the host can change it, on "Choose a dungeon" with the
 * dungeon map. That screen is drawn along with the party, so it is up to date
 * when it opens.
 */
function renderDungeon(game: LobbyGame, isHost: boolean, wins: readonly DungeonWin[]): void {
  const dungeon = DUNGEONS[game.dungeonId];
  const difficulty = DIFFICULTIES[game.difficulty];
  const rewards = describeOneTimeRewards(dungeon.oneTimeRewards[game.difficulty]);
  const firstWin = hasCleared(wins, dungeon.id, game.difficulty)
    ? `You have won it on ${difficulty.name} before, so no first-win reward (${rewards}).`
    : `Your first win on ${difficulty.name} also gives you ${rewards}.`;
  element("#party-dungeon-name").textContent = dungeon.name;
  element("#party-difficulty").textContent = difficulty.name;
  element("#party-difficulty").dataset.difficulty = game.difficulty;
  element("#party-dungeon-details").textContent =
    `${dungeon.silverReward} silver each for a win. ${firstWin} ` +
    `Turns: ${describeTurnDuration(game.turnDuration)}.`;
  element("#change-dungeon").hidden = !isHost;
  if (isHost) renderDungeonMap(game, wins);
}

/** What the dungeon map says under each dungeon's name. */
const STATUS_TEXT: Record<DungeonStatus, string> = {
  cleared: "Cleared",
  next: "Next to clear",
  locked: "Locked: clear the dungeons before it first",
};

/**
 * The host's dungeon map on "Choose a dungeon" (design.md, Parties and the
 * lobby): a button per
 * difficulty, and the dungeons in the order they are cleared, each marked
 * cleared, next to clear or locked for the host on the chosen difficulty,
 * with the XP a character with no kills would get from killing everything.
 * Only what the host can play can be chosen. The server checks that again
 * (lobby.ts): a disabled button only helps the honest player.
 *
 * Choosing a difficulty keeps the dungeon when the host can play it there,
 * and otherwise goes to their next dungeon on that difficulty; the host stays
 * on the screen to pick a dungeon. Choosing a dungeon goes back to the party.
 */
function renderDungeonMap(game: LobbyGame, wins: readonly DungeonWin[]): void {
  element("#difficulty-buttons").replaceChildren(
    ...DIFFICULTY_IDS.map((id, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = DIFFICULTIES[id].name;
      button.setAttribute("aria-pressed", String(id === game.difficulty));
      const unlocked = isDifficultyUnlocked(wins, id);
      button.disabled = !unlocked;
      if (!unlocked) button.title = `Clear every dungeon on ${DIFFICULTIES[DIFFICULTY_IDS[index - 1]!].name} first.`;
      button.addEventListener("click", () => {
        const keep = canPlay(wins, { dungeonId: game.dungeonId, difficulty: id });
        currentActions?.chooseDungeon({ dungeonId: keep ? game.dungeonId : nextDungeon(wins, id), difficulty: id });
      });
      return button;
    }),
  );

  // The server refuses a dungeon the party is too big for; don't offer it.
  const characters = characterCount(game);
  element("#dungeon-map").replaceChildren(
    ...DUNGEON_IDS.map((id) => {
      const dungeon = DUNGEONS[id];
      const status = dungeonStatus(wins, id, game.difficulty);
      const tooBig = characters > dungeon.maxCharacters;
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("aria-pressed", String(id === game.dungeonId));
      button.disabled = status === "locked" || tooBig;
      const statusText = tooBig ? `At most ${dungeon.maxCharacters} characters` : STATUS_TEXT[status];
      const fullXp = dungeonFullXp(dungeon.map, game.difficulty);
      button.append(
        dungeon.name,
        textElement("span", statusText, "status small"),
        textElement("span", `Up to ${fullXp} XP`, "xp small"),
      );
      button.addEventListener("click", () => {
        currentActions?.chooseDungeon({ dungeonId: id, difficulty: game.difficulty });
        // replace(): the back button then doesn't open this screen again.
        location.replace("#/");
      });
      const item = document.createElement("li");
      item.className = status;
      item.append(button);
      return item;
    }),
  );
}

function textElement(tag: string, text: string, className: string): HTMLElement {
  const created = document.createElement(tag);
  created.textContent = text;
  created.className = className;
  return created;
}

/** The characters the game will start with: everyone's choices together. */
function characterCount(game: LobbyGame): number {
  return game.players.reduce((sum, p) => sum + p.characters.length, 0);
}
