// Shows the lobby: the open games, your party, or the started game.
//
// Every lobby message is a full snapshot, so drawing simply starts over each
// time instead of updating what is already on screen.

import { MAX_CHARACTERS_PER_PLAYER, type LobbyGame, type LobbyMessage } from "../shared/protocol.ts";
import { DUNGEON_IDS, DUNGEONS, type DungeonId } from "../shared/rules/dungeon-map.ts";
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
  chooseDungeon(dungeonId: DungeonId): void;
}

function element(selector: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(selector);
  if (!found) throw new Error(`missing element ${selector}`);
  return found;
}

/** The latest actions, for the dungeon list's one "change" listener. */
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
  else if (!mine.started) renderParty(mine, myName, new Set(lobby.dungeonsWon));
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
      label.append(box, `${character.name} · level ${character.level}`);
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
        `${game.players.map((p) => p.displayName).join(", ")} · ${dungeon.name} · ` +
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

function renderParty(game: LobbyGame, myName: string, won: ReadonlySet<DungeonId>): void {
  const isCreator = game.creator === myName;
  element("#start-button").hidden = !isCreator;
  renderDungeon(game, isCreator, won);
  element("#party-waiting").textContent = isCreator
    ? "Start when everyone is here. Nobody can join after the start."
    : `Waiting for ${game.creator} to start the game.`;
  renderPlayers(element("#party-players"), game);
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
      // The characters they bring, under their name. A started game that
      // was restored after a server restart has none: the game shows them.
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
 * The chosen dungeon. The creator gets a list to choose from; the others
 * only see the choice, which changes live when the creator changes it.
 * Everyone sees whether they have won it before, and so whether a win gives
 * them its one-time rewards; the list marks the dungeons they have won.
 *
 * The list's options are made once and then only updated. Replacing them on
 * every lobby update would close the list while the creator has it open,
 * for example when another player comes online.
 */
function renderDungeon(game: LobbyGame, isCreator: boolean, won: ReadonlySet<DungeonId>): void {
  const dungeon = DUNGEONS[game.dungeonId];
  element("#dungeon-choice").hidden = !isCreator;
  const firstWin = won.has(dungeon.id)
    ? `You have won it before, so no first-win reward (${describeOneTimeRewards(dungeon.oneTimeRewards)}).`
    : `Your first win also gives you ${describeOneTimeRewards(dungeon.oneTimeRewards)}.`;
  const stats = `At most ${dungeon.maxCharacters} characters; ${dungeon.silverReward} silver each for a win. ${firstWin}`;
  const turns = `Turn duration: ${describeTurnDuration(game.turnDuration)}.`;
  element("#party-dungeon").textContent = isCreator ? `${stats} ${turns}` : `Dungeon: ${dungeon.name}. ${stats} ${turns}`;
  if (!isCreator) return;

  const select = element("#dungeon-select") as HTMLSelectElement;
  if (select.options.length === 0) {
    for (const id of DUNGEON_IDS) {
      const option = document.createElement("option");
      option.value = id;
      option.textContent = DUNGEONS[id].name;
      select.append(option);
    }
    select.addEventListener("change", () => currentActions?.chooseDungeon(select.value as DungeonId));
  }
  // The server refuses a dungeon the party is too big for; don't offer it.
  const characters = characterCount(game);
  for (const option of select.options) {
    const id = option.value as DungeonId;
    option.disabled = characters > DUNGEONS[id].maxCharacters;
    // Only touched when it changes (after a win), so an open list isn't disturbed.
    const text = won.has(id) ? `${DUNGEONS[id].name} (won)` : DUNGEONS[id].name;
    if (option.textContent !== text) option.textContent = text;
  }
  select.value = game.dungeonId;
}

/** The characters the game will start with: everyone's choices together. */
function characterCount(game: LobbyGame): number {
  return game.players.reduce((sum, p) => sum + p.characters.length, 0);
}
