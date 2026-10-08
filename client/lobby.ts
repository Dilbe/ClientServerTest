// Shows the lobby: the open games ("Find a game"), your party ("Party"), or
// the started game. The code keeps calling all of it the lobby; only the
// player sees the screen names.
//
// Every lobby message is a full snapshot, so drawing simply starts over each
// time instead of updating what is already on screen.

import {
  MAX_CHARACTERS_PER_PLAYER,
  type LobbyCharacter,
  type LobbyGame,
  type LobbyMessage,
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
}

function element(selector: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(selector);
  if (!found) throw new Error(`missing element ${selector}`);
  return found;
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

export function renderLobby(lobby: LobbyMessage, myName: string, actions: LobbyActions): void {
  currentActions = actions;
  const mine = lobby.myGame;
  element("#lobby-browse").hidden = mine !== null;
  element("#lobby-party").hidden = mine === null || mine.started;
  element("#game").hidden = mine === null || !mine.started;
  element("#character-choice").hidden = mine !== null && mine.started;
  // One character choice for both screens, in a different place on each:
  // append() moves an element that is already in the page, it doesn't copy it.
  element(mine === null ? "#browse-choice-slot" : "#party-choice-slot").append(element("#character-choice"));

  const inParty = mine !== null && !mine.started;
  if (inParty) {
    const me = mine.players.find((p) => p.displayName === myName);
    choice = me ? me.characters.map((c) => c.number) : choice;
  } else {
    // Characters may have been used up or added since; by default, bring the first.
    const own = new Set(lobby.yourCharacters.map((c) => c.number));
    choice = choice.filter((n) => own.has(n));
    if (choice.length === 0 && lobby.yourCharacters.length > 0) choice = [lobby.yourCharacters[0]!.number];
  }
  if (mine === null || !mine.started) renderCharacterChoice(lobby, inParty, () => renderLobby(lobby, myName, actions));

  if (mine === null) renderOpenGames(lobby.openGames, actions);
  else if (!mine.started) renderParty(mine, myName, lobby.dungeonWins);
  else renderPlayers(element("#game-players"), mine);
}

/**
 * One checkbox per character. Outside a game, a change only changes the
 * local choice (`redraw` shows it); in an open game it is sent to the
 * server, and the checkboxes follow when the new lobby arrives. Choices the
 * server would refuse anyway (none, or more than 3) can't be made here.
 * Whether the party has room is only known to the server: it says so when
 * the choice is too big, and the old choice stays.
 */
function renderCharacterChoice(lobby: LobbyMessage, inParty: boolean, redraw: () => void): void {
  element("#character-choice-hint").textContent = inParty
    ? `You can change your choice until the game starts.`
    : `Choose 1 to ${MAX_CHARACTERS_PER_PLAYER} characters, then create or join a game.`;
  element("#character-choices").replaceChildren(
    ...lobby.yourCharacters.map((character) => {
      const checked = choice.includes(character.number);
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = checked;
      box.disabled = checked ? choice.length === 1 : choice.length >= MAX_CHARACTERS_PER_PLAYER;
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
      return item;
    }),
  );
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
      join.addEventListener("click", () => actions.join(game.id, chosenCharacters()));
      item.append(names, join);
      return item;
    }),
  );
}

function renderParty(game: LobbyGame, myName: string, wins: readonly DungeonWin[]): void {
  const isCreator = game.creator === myName;
  element("#start-button").hidden = !isCreator;
  renderDungeon(game, isCreator, wins);
  element("#party-waiting").textContent = isCreator
    ? "Start when everyone is here. Nobody can join after the start."
    : `Waiting for ${game.creator} to start the game.`;
  const dungeon = DUNGEONS[game.dungeonId];
  element("#party-players-title").textContent =
    `Players · ${characterCount(game)} of ${dungeon.maxCharacters} characters`;
  renderPlayerCards(game);
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
 * rewards. Only the host gets the dungeon map to choose from.
 */
function renderDungeon(game: LobbyGame, isCreator: boolean, wins: readonly DungeonWin[]): void {
  const dungeon = DUNGEONS[game.dungeonId];
  const difficulty = DIFFICULTIES[game.difficulty];
  const firstWin = hasCleared(wins, dungeon.id, game.difficulty)
    ? `You have won it on ${difficulty.name} before, so no first-win reward (${describeOneTimeRewards(dungeon.oneTimeRewards)}).`
    : `Your first win on ${difficulty.name} also gives you ${describeOneTimeRewards(dungeon.oneTimeRewards)}.`;
  element("#party-dungeon-name").textContent = dungeon.name;
  element("#party-difficulty").textContent = difficulty.name;
  element("#party-difficulty").dataset.difficulty = game.difficulty;
  element("#party-dungeon-details").textContent =
    `${dungeon.silverReward} silver each for a win. ${firstWin} ` +
    `Turns: ${describeTurnDuration(game.turnDuration)}.`;
  element("#dungeon-choice").hidden = !isCreator;
  if (isCreator) renderDungeonMap(game, wins);
}

/** What the dungeon map says under each dungeon's name. */
const STATUS_TEXT: Record<DungeonStatus, string> = {
  cleared: "Cleared",
  next: "Next to clear",
  locked: "Locked: clear the dungeons before it first",
};

/**
 * The host's dungeon map (design.md, Parties and the lobby): a button per
 * difficulty, and the dungeons in the order they are cleared, each marked
 * cleared, next to clear or locked for the host on the chosen difficulty,
 * with the XP a character with no kills would get from killing everything.
 * Only what the host can play can be chosen. The server checks that again
 * (lobby.ts): a disabled button only helps the honest player.
 *
 * Choosing a difficulty keeps the dungeon when the host can play it there,
 * and otherwise goes to their next dungeon on that difficulty.
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
      button.addEventListener("click", () => currentActions?.chooseDungeon({ dungeonId: id, difficulty: game.difficulty }));
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
