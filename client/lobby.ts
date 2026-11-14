// Shows the lobby: the open games ("Find a game"), your party ("Party"), the
// two choice screens opened from the party ("Choose a dungeon", and the
// character picker for one of the player's slots), or the started game. The code keeps calling all of it the
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
  canEveryonePlay,
  canPlay,
  DIFFICULTIES,
  DIFFICULTY_IDS,
  dungeonStatus,
  hasCleared,
  isDifficultyUnlocked,
  nextDungeonForEveryone,
  type DungeonChoice,
  type DungeonStatus,
  type DungeonWin,
} from "../shared/rules/difficulties.ts";
import { dungeonFullXp } from "../shared/rules/diminishing-returns.ts";
import { DUNGEON_IDS, DUNGEONS, winRewardText } from "../shared/rules/dungeon-map.ts";
import { drawMapPreview, mapPreview } from "./map-preview.ts";
import { maxLevel } from "../shared/rules/advancement.ts";
import type { Rest } from "../shared/rules/rest.ts";
import { isReady, isWorking, localRest, restText, RestTimer } from "./rest.ts";
import { describeTurnDuration, type TurnDurationId } from "../shared/turn-durations.ts";
import { fillTurnDurations } from "./turn-duration-select.ts";
import { oneTimeRewardName } from "./rewards.ts";
import { characterFilter, shownText } from "./character-filter.ts";
import {
  canPickForSlot,
  defaultChoice,
  pickForSlot,
  roomForPlayer,
  slotStates,
  takeOutOfSlot,
} from "./character-choice-rules.ts";
import { characterViewAddress, pointsToSpendText } from "./character-view.ts";

export interface LobbyActions {
  /** `password`: empty for a game that isn't private. */
  join(gameId: string, characters: number[], password: string): void;
  chooseCharacters(characters: number[]): void;
  chooseDungeon(choice: DungeonChoice): void;
  setTurnOrder(order: TurnOrderEntry[]): void;
  chooseTurnDuration(turnDuration: TurnDurationId): void;
  /** Removes a player from the party: by their index in the game's players, and their name. */
  kick(player: number, displayName: string): void;
}

function element(selector: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(selector);
  if (!found) throw new Error(`missing element ${selector}`);
  return found;
}

/**
 * Which part of the lobby the player asked for: the main screen ("Find a
 * game" or "Party", whichever fits) or one of the choice screens. main.ts
 * sets it from the address (#/choose-dungeon, #/choose-characters/2).
 */
export type LobbyPanel = "main" | "dungeon" | "characters";
let panel: LobbyPanel = "main";
/** On the character picker: the slot it fills, 0 to 2, or -1 for none (checked in renderLobby). */
let pickerSlot = -1;
/**
 * "Choose your characters" was just opened: its "In a game" filter is set
 * again from the next lobby drawn (design.md, Character filters).
 */
let choiceOpened = false;

export function setLobbyPanel(next: LobbyPanel, slot = -1): void {
  if (next === "characters" && panel !== "characters") choiceOpened = true;
  panel = next;
  pickerSlot = slot;
}

/** Draws the lobby again, as it was last drawn: for the filter dropdowns and the rest timer. */
let redrawLobby: () => void = () => {};
/** The filters of this screen, with a setting of their own (see character-filter.ts). */
const filter = characterFilter("choice", element("#choice-filter"), () => redrawLobby());

/** The latest actions, for listeners made before the latest lobby arrived. */
let currentActions: LobbyActions | undefined;

/**
 * The characters to bring, by number, in the order of the player's slots.
 * In an open game this follows the server's copy. Outside a game it is the
 * default character, for creating or joining a game: characters are only
 * chosen in the party (design.md, Characters; issue #387).
 */
let choice: number[] = [];

/** "Take out" on the character picker: empties the slot, then back to the party. */
element("#take-out-button").addEventListener("click", () => {
  currentActions?.chooseCharacters(takeOutOfSlot(choice, pickerSlot));
  // replace(): the back button then doesn't open the picker again.
  location.replace("#/");
});

/** The characters chosen for a new game: for the "Create a game" button. */
export function chosenCharacters(): number[] {
  return [...choice];
}

/**
 * The host's turn duration list in the party (issue #372). Its options
 * never change, so they are made once; every lobby update selects the
 * party's choice again. Choosing one sends it at once, like the dungeon:
 * the server's choice is what counts, and everyone sees it change.
 */
const turnDurationSelect = element("#party-turn-duration-select") as HTMLSelectElement;
fillTurnDurations(turnDurationSelect);
turnDurationSelect.addEventListener("change", () =>
  currentActions?.chooseTurnDuration(turnDurationSelect.value as TurnDurationId),
);

const passwordInput = element("#game-password-input") as HTMLInputElement;

/** The password for a new game, empty for none: for the "Create a game" button. */
export function chosenPassword(): string {
  return passwordInput.value;
}

/**
 * The password dialog for joining a private game. It is plain HTML that the
 * lobby never redraws, so a new lobby snapshot arriving while the player
 * types doesn't wipe what they typed. The game to join is remembered while
 * it is open.
 */
const joinDialog = element("#join-dialog") as HTMLDialogElement;
const joinPasswordInput = element("#join-password-input") as HTMLInputElement;
let joiningGameId: string | undefined;
joinDialog.addEventListener("close", () => {
  // returnValue: the value of the button that closed it; "" for the Escape key.
  if (joinDialog.returnValue === "join" && joiningGameId !== undefined) {
    currentActions?.join(joiningGameId, chosenCharacters(), joinPasswordInput.value);
  }
  joiningGameId = undefined;
});

function askPasswordAndJoin(gameId: string): void {
  joiningGameId = gameId;
  joinPasswordInput.value = "";
  // Set again each time: closing with Escape leaves the last value in place.
  joinDialog.returnValue = "";
  joinDialog.showModal();
}

/** Redraws the choice when a character's rest changes (see rest.ts). */
const restTimer = new RestTimer();

/** `receivedAt`: when the lobby message arrived, by `Date.now()`, for the rests in it (see rest.ts). */
export function renderLobby(lobby: LobbyMessage, receivedAt: number, myName: string, actions: LobbyActions): void {
  currentActions = actions;
  const redraw = () => renderLobby(lobby, receivedAt, myName, actions);
  redrawLobby = redraw;
  const rests = new Map(lobby.yourCharacters.map((c) => [c.number, localRest(c, receivedAt)]));
  const mine = lobby.myGame;
  const inParty = mine !== null && !mine.started;
  const isHost = inParty && mine.creator === myName;

  if (inParty) {
    const me = mine.players.find((p) => p.displayName === myName);
    choice = me ? me.characters.map((c) => c.number) : choice;
  } else {
    // Characters may have been used up, added, gone to rest or still be in
    // a game the player left since; bring the first that is ready
    // (design.md, Resting), not in a game (issue #195) and below its max
    // level (issue #373).
    const inGame = new Set(lobby.yourCharacters.filter((c) => c.inGame).map((c) => c.number));
    const ready = (n: number) => rests.has(n) && isReady(rests.get(n)!) && !inGame.has(n);
    const first = defaultChoice(sortedForChoice(lobby.yourCharacters), ready);
    choice = first ? [first.number] : [];
  }
  const room = inParty ? roomForPlayer(mine, myName) : MAX_CHARACTERS_PER_PLAYER;

  // A choice screen that doesn't fit (any more) shows the main screen
  // instead: not in a party (any more), the player isn't the host (any
  // more), or the slot has no room (or the address named no slot).
  // replaceState() changes the address without a "hashchange" event and
  // without a new entry for the back button.
  const pickerFits = inParty && canPickForSlot(pickerSlot, choice.length, room);
  const shown = (panel === "dungeon" && !isHost) || (panel === "characters" && !pickerFits) ? "main" : panel;
  if (shown !== panel) {
    panel = shown;
    history.replaceState(null, "", "#/");
  }
  element("#lobby-browse").hidden = mine !== null || shown !== "main";
  element("#lobby-party").hidden = !inParty || shown !== "main";
  element("#choose-dungeon").hidden = shown !== "dungeon";
  element("#choose-characters").hidden = shown !== "characters";
  element("#game").hidden = mine === null || !mine.started;
  if (choiceOpened && shown === "characters") {
    choiceOpened = false;
    filter.resetInGameBox(lobby.yourCharacters);
  }

  // With every character resting or in a game there is nothing to bring: the server would
  // drop a game without characters.
  (element("#create-button") as HTMLButtonElement).disabled = choice.length === 0;
  if (mine === null || !mine.started) {
    renderCharacterSummary(lobby);
    if (shown === "characters") renderPicker(lobby, rests);
    // The lobby as last drawn, not this one: by the time a rest changes, a
    // newer lobby may be on screen, such as the started game (issue #208).
    restTimer.set([...rests.values()], () => redrawLobby());
  } else {
    // A started game shows no rests, so nothing needs redrawing for them.
    restTimer.clear();
  }

  if (mine === null) renderOpenGames(lobby.openGames, lobby.dungeonWins, actions);
  else if (!mine.started) renderParty(mine, isHost, myName, lobby, room);
  else renderPlayers(element("#game-players"), mine);
}

/** Why there is nothing to choose: every character is resting or still in a game. */
const NO_CHARACTER_READY =
  "None of your characters can go into a dungeon now: they are working, resting, or still in a game you left. Wait until one is ready, or buy one on the character page.";

/**
 * The line on "Find a game" about characters: they are chosen in the party,
 * and which one comes along by default; or that none can go now.
 */
function renderCharacterSummary(lobby: LobbyMessage): void {
  const first = lobby.yourCharacters.find((c) => c.number === choice[0]);
  // textContent: the player chose the name.
  element("#character-summary-hint").textContent = first
    ? `You choose your characters in the party. Creating or joining a game brings ${first.name} to start with.`
    : NO_CHARACTER_READY;
}

/**
 * The character picker for one slot of the player's party card (design.md,
 * Parties and the lobby; issue #387): the characters that can go in it,
 * each a button. On a filled slot, picking one swaps it for the character
 * there; on an open slot it is added. Either way the choice is sent to the
 * server, and the picker goes back to the party: the party card shows the
 * new choice when the server's lobby arrives. The characters in the
 * player's other slots, and the one in this slot, aren't listed.
 */
function renderPicker(lobby: LobbyMessage, rests: ReadonlyMap<number, Rest>): void {
  const slot = pickerSlot;
  const current = lobby.yourCharacters.find((c) => c.number === choice[slot]);
  // textContent: the player chose the name.
  element("#character-choice-hint").textContent =
    (current
      ? `Slot ${slot + 1}: pick a character to bring instead of ${current.name}.`
      : `Slot ${slot + 1}: pick a character to bring.`) + " You can change this until the game starts.";
  element("#take-out-button").hidden = current === undefined || choice.length <= 1;
  const characters = sortedForChoice(lobby.yourCharacters)
    .filter((c) => !choice.includes(c.number))
    .map((c) => ({
      character: c,
      filtered: {
        atMaxLevel: c.level >= maxLevel(c.class, c.rank),
        ready: isReady(rests.get(c.number)!),
        working: isWorking(rests.get(c.number)!),
        inGame: c.inGame,
      },
    }));
  filter.sync(characters.map((c) => c.filtered));
  const shown = characters.filter((c) => filter.isShown(c.filtered)).map((c) => c.character);
  element("#choice-filter-note").textContent = shownText(shown.length, characters.length);
  element("#character-choices").replaceChildren(
    ...shown.map((character) => {
      // A resting or working character can't be chosen (design.md,
      // Resting; The village), nor one still in a game the player left
      // (issue #195): it is greyed out, saying why. The server refuses
      // them too: this only saves a refusal.
      const rest = restText(rests.get(character.number)!, character.workplace);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "secondary";
      button.disabled = rest !== undefined || character.inGame;
      // textContent: the player chose the name.
      button.append(textElement("span", `${character.name} - rank ${character.rank} · level ${character.level}`, ""));
      if (rest) button.append(textElement("span", rest, "rest"));
      if (character.inGame) button.append(textElement("span", "still in a game", "rest"));
      const points = pointsToSpendText(character.pointsToSpend);
      if (points) button.append(textElement("span", points, "points-to-spend"));
      button.addEventListener("click", () => {
        currentActions?.chooseCharacters(pickForSlot(choice, slot, character.number));
        // replace(): the back button then doesn't open the picker again.
        location.replace("#/");
      });
      const item = document.createElement("li");
      item.append(button);
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

/**
 * "Find a game": the open games. A game whose dungeon the player can't play
 * yet can't be joined (design.md, Unlocking dungeons): its "Join" button is
 * disabled and says why. The server refuses it too; this only saves a
 * refusal.
 */
function renderOpenGames(games: LobbyGame[], wins: readonly DungeonWin[], actions: LobbyActions): void {
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
      if (game.private) names.append(" ", textElement("span", "Private", "tag"));
      const join = document.createElement("button");
      join.type = "button";
      join.textContent = "Join";
      const playable = canPlay(wins, game);
      join.disabled = choice.length === 0 || !playable;
      if (!playable) {
        join.title = "You can't play this dungeon on this difficulty yet.";
        names.append(" ", textElement("span", "You can't play this yet", "small"));
      }
      join.addEventListener("click", () =>
        game.private ? askPasswordAndJoin(game.id) : actions.join(game.id, chosenCharacters(), ""),
      );
      item.append(names, join);
      return item;
    }),
  );
}

function renderParty(game: LobbyGame, isHost: boolean, myName: string, lobby: LobbyMessage, room: number): void {
  element("#start-button").hidden = !isHost;
  renderDungeon(game, isHost, lobby.dungeonWins);
  element("#party-waiting").hidden = isHost;
  element("#party-waiting").textContent = `Waiting for ${game.creator} to start the game.`;
  const dungeon = DUNGEONS[game.dungeonId];
  element("#party-players-title").textContent =
    `Players · ${characterCount(game)} of ${dungeon.maxCharacters} characters`;
  renderPlayerCards(game, isHost, myName, lobby.yourCharacters, room);
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
    ? "The characters act in this order."
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
      const name = textElement("span", `${describeCharacter(character)} (${player?.displayName ?? "?"})`, "name");
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
 * from the chosen dungeon (design.md, Diminishing returns). The host gets a
 * "Remove" button on everyone else's card (design.md, Private games). The
 * player's own card shows their 3 slots instead (see `slotItems`).
 */
function renderPlayerCards(
  game: LobbyGame,
  isHost: boolean,
  myName: string,
  own: LobbyMessage["yourCharacters"],
  room: number,
): void {
  element("#party-players").replaceChildren(
    ...game.players.map((player, index) => {
      const card = document.createElement("li");
      if (!player.online) card.classList.add("offline");
      const header = document.createElement("div");
      header.className = "card-header";
      // textContent, never innerHTML: names come from other players.
      header.append(textElement("strong", player.displayName, "player-name"));
      if (player.displayName === game.creator) header.append(textElement("span", "Host", "tag"));
      if (!player.online) header.append(textElement("span", "Offline", "tag"));
      if (isHost && player.displayName !== myName) {
        const kick = document.createElement("button");
        kick.type = "button";
        kick.className = "secondary kick";
        kick.textContent = "Remove";
        kick.addEventListener("click", () => currentActions?.kick(index, player.displayName));
        header.append(kick);
      }
      const characters = document.createElement("ul");
      characters.className = "card-characters";
      if (player.displayName === myName) {
        characters.classList.add("slots");
        characters.append(...slotItems(player.characters, own, room, DUNGEONS[game.dungeonId].maxCharacters));
        card.append(header, characters);
        return card;
      }
      characters.append(
        ...player.characters.map((character) => {
          const item = document.createElement("li");
          item.append(
            textElement("span", describeCharacter(character), ""),
            textElement("span", describeXp(character), "small"),
          );
          return item;
        }),
      );
      // A rank-up on the character page used them all up (issue #153).
      if (player.characters.length === 0) characters.append(textElement("li", "No characters chosen", "small"));
      card.append(header, characters);
      return card;
    }),
  );
}

/**
 * The player's 3 character slots on their own party card (design.md,
 * Parties and the lobby; issue #387), so it is clear at a glance how many
 * characters they can still bring:
 * - a filled slot shows the character and its XP percentage, and is a link
 *   to the picker to swap it or take it out; its unspent upgrade points are
 *   a separate link to the character's screen;
 * - an open slot is a link to the picker, to add a character;
 * - a slot without room says why.
 * Links, not buttons: each opens a screen with its own address, so the
 * back button works.
 */
function slotItems(
  chosen: readonly LobbyCharacter[],
  own: LobbyMessage["yourCharacters"],
  room: number,
  maxCharacters: number,
): HTMLLIElement[] {
  return slotStates(chosen.length, room).map((state, slot) => {
    const item = document.createElement("li");
    item.className = `slot ${state}`;
    const picker = document.createElement("a");
    picker.href = `#/choose-characters/${slot + 1}`;
    if (state === "filled") {
      const character = chosen[slot]!;
      picker.setAttribute("aria-label", `Change ${character.name}`);
      picker.append(
        textElement("span", describeCharacter(character), ""),
        textElement("span", describeXp(character), "small"),
      );
      item.append(picker);
      const points = pointsToSpendText(own.find((c) => c.number === character.number)?.pointsToSpend ?? 0);
      if (points) {
        const link = document.createElement("a");
        link.href = characterViewAddress({ kind: "character", number: character.number });
        link.className = "points-to-spend";
        link.textContent = points;
        item.append(link);
      }
    } else if (state === "open") {
      picker.textContent = "+ Add a character";
      item.append(picker);
    } else {
      item.append(textElement("span", `No room in the party (at most ${maxCharacters} characters)`, "small"));
    }
    return item;
  });
}

/**
 * Like "Adventurer 9 - rank 2 · level 3", as in the character selection;
 * only the name when the server didn't send the rank and level.
 */
function describeCharacter(character: LobbyCharacter | undefined): string {
  if (!character) return "?";
  if (character.rank === undefined || character.level === undefined) return character.name;
  return `${character.name} - rank ${character.rank} · level ${character.level}`;
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
 * live when the host changes it, and what a win gives them: the silver, wood and stone, and
 * the one-time rewards when they haven't won that dungeon on that difficulty
 * before. Only the host can change it, on "Choose a dungeon" with the
 * dungeon map. That screen is drawn along with the party, so it is up to date
 * when it opens.
 */
function renderDungeon(game: LobbyGame, isHost: boolean, wins: readonly DungeonWin[]): void {
  const dungeon = DUNGEONS[game.dungeonId];
  const difficulty = DIFFICULTIES[game.difficulty];
  const firstWin = hasCleared(wins, dungeon.id, game.difficulty) ? [] : dungeon.oneTimeRewards[game.difficulty];
  const rewards = [winRewardText(dungeon.winRewards[game.difficulty]), ...firstWin.map(oneTimeRewardName)];
  element("#party-dungeon-name").textContent = dungeon.name;
  element("#party-difficulty").textContent = difficulty.name;
  element("#party-difficulty").dataset.difficulty = game.difficulty;
  element("#party-dungeon-details").textContent =
    `Reward: ${rewards.join(" / ")}. Turns: ${describeTurnDuration(game.turnDuration)}.` +
    (game.private ? " Private: joining needs the password." : "");
  // Redrawn only when the dungeon changes: the party is drawn again on every lobby update.
  const preview = document.querySelector<SVGSVGElement>("#party-dungeon-preview")!;
  if (preview.dataset.dungeon !== dungeon.id) {
    drawMapPreview(preview, dungeon.map);
    preview.dataset.dungeon = dungeon.id;
  }
  element("#change-dungeon").hidden = !isHost;
  element("#party-turn-duration").hidden = !isHost;
  turnDurationSelect.value = game.turnDuration;
  if (isHost) renderDungeonMap(game, wins);
}

/**
 * Who in the party can't play a dungeon on a difficulty, by display name:
 * the server sends every player's wins with the player's own open game.
 */
function blockedBy(game: LobbyGame, choice: DungeonChoice): string[] {
  return game.players.filter((p) => !canPlay(p.dungeonWins ?? [], choice)).map((p) => p.displayName);
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
 * Only what everyone in the party can play can be chosen (design.md,
 * Unlocking dungeons); a dungeon the host could play but someone else can't
 * says who. The server checks that again (lobby.ts): a disabled button only
 * helps the honest player.
 *
 * Choosing a difficulty keeps the dungeon when everyone can play it there,
 * and otherwise goes to the last dungeon on that difficulty everyone can
 * play (for the host alone: their next one); the host stays on the screen
 * to pick a dungeon. Choosing a dungeon goes back to the party.
 */
function renderDungeonMap(game: LobbyGame, wins: readonly DungeonWin[]): void {
  const winsOfEach = game.players.map((p) => p.dungeonWins ?? []);
  element("#difficulty-buttons").replaceChildren(
    ...DIFFICULTY_IDS.map((id, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = DIFFICULTIES[id].name;
      button.setAttribute("aria-pressed", String(id === game.difficulty));
      // The first dungeon on a difficulty everyone has unlocked is open to
      // everyone, so `next` is only undefined when someone hasn't unlocked it.
      const next = nextDungeonForEveryone(winsOfEach, id);
      button.disabled = next === undefined;
      if (!isDifficultyUnlocked(wins, id)) {
        button.title = `Clear every dungeon on ${DIFFICULTIES[DIFFICULTY_IDS[index - 1]!].name} first.`;
      } else if (next === undefined) {
        const others = game.players
          .filter((p) => !isDifficultyUnlocked(p.dungeonWins ?? [], id))
          .map((p) => p.displayName);
        button.title = `Not unlocked yet for ${others.join(", ")}.`;
      }
      button.addEventListener("click", () => {
        if (next === undefined) return;
        const keep = canEveryonePlay(winsOfEach, { dungeonId: game.dungeonId, difficulty: id });
        currentActions?.chooseDungeon({ dungeonId: keep ? game.dungeonId : next, difficulty: id });
      });
      return button;
    }),
  );

  // The server refuses a dungeon the party is too big for; don't offer it.
  const characters = characterCount(game);
  element("#dungeon-map").replaceChildren(
    ...DUNGEON_IDS.map((id) => {
      const dungeon = DUNGEONS[id];
      const ownStatus = dungeonStatus(wins, id, game.difficulty);
      // Locked for someone else in the party: locked here too, saying for whom.
      const blocked = ownStatus === "locked" ? [] : blockedBy(game, { dungeonId: id, difficulty: game.difficulty });
      const status: DungeonStatus = blocked.length > 0 ? "locked" : ownStatus;
      const tooBig = characters > dungeon.maxCharacters;
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("aria-pressed", String(id === game.dungeonId));
      button.disabled = status === "locked" || tooBig;
      // textContent (via append): the names come from other players.
      const statusText = tooBig
        ? `At most ${dungeon.maxCharacters} characters`
        : blocked.length > 0
          ? `Locked for ${blocked.join(", ")}`
          : STATUS_TEXT[status];
      const fullXp = dungeonFullXp(dungeon.map, game.difficulty);
      // The text in one column, and a thumbnail of the map beside it.
      const text = document.createElement("span");
      text.className = "text";
      text.append(
        dungeon.name,
        textElement("span", statusText, "status small"),
        textElement("span", `Up to ${fullXp} XP`, "xp small"),
      );
      button.append(text, mapPreview(dungeon.map, "thumbnail"));
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
