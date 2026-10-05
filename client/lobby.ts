// Shows the lobby: the open games, your party, or the started game.
//
// Every lobby message is a full snapshot, so drawing simply starts over each
// time instead of updating what is already on screen.

import type { LobbyGame, LobbyMessage } from "../shared/protocol.ts";
import { DUNGEON_IDS, DUNGEONS, type DungeonId } from "../shared/rules/dungeon-map.ts";

export interface LobbyActions {
  join(gameId: string): void;
  chooseDungeon(dungeonId: DungeonId): void;
}

function element(selector: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(selector);
  if (!found) throw new Error(`missing element ${selector}`);
  return found;
}

/** The latest actions, for the dungeon list's one "change" listener. */
let currentActions: LobbyActions | undefined;

export function renderLobby(lobby: LobbyMessage, myName: string, actions: LobbyActions): void {
  currentActions = actions;
  const mine = lobby.myGame;
  element("#lobby-browse").hidden = mine !== null;
  element("#lobby-party").hidden = mine === null || mine.started;
  element("#game").hidden = mine === null || !mine.started;

  if (mine === null) renderOpenGames(lobby.openGames, actions);
  else if (!mine.started) renderParty(mine, myName);
  else renderPlayers(element("#game-players"), mine);
}

function renderOpenGames(games: LobbyGame[], actions: LobbyActions): void {
  element("#no-games").hidden = games.length > 0;
  const list = element("#open-games");
  list.replaceChildren(
    ...games.map((game) => {
      const item = document.createElement("li");
      const names = document.createElement("span");
      // textContent, never innerHTML: names come from other players.
      names.textContent = `${game.players.map((p) => p.displayName).join(", ")} · ${DUNGEONS[game.dungeonId].name}`;
      const join = document.createElement("button");
      join.type = "button";
      join.textContent = "Join";
      join.addEventListener("click", () => actions.join(game.id));
      item.append(names, join);
      return item;
    }),
  );
}

function renderParty(game: LobbyGame, myName: string): void {
  const isCreator = game.creator === myName;
  element("#start-button").hidden = !isCreator;
  renderDungeon(game, isCreator);
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
      return item;
    }),
  );
}

/**
 * The chosen dungeon. The creator gets a list to choose from; the others
 * only see the choice, which changes live when the creator changes it.
 *
 * The list's options are made once and then only updated. Replacing them on
 * every lobby update would close the list while the creator has it open,
 * for example when another player comes online.
 */
function renderDungeon(game: LobbyGame, isCreator: boolean): void {
  const dungeon = DUNGEONS[game.dungeonId];
  element("#dungeon-choice").hidden = !isCreator;
  const stats = `At most ${dungeon.maxCharacters} characters; ${dungeon.silverReward} silver each for a win.`;
  element("#party-dungeon").textContent = isCreator ? stats : `Dungeon: ${dungeon.name}. ${stats}`;
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
  // Each player brings one character until issue #26.
  const characters = game.players.length;
  for (const option of select.options) {
    option.disabled = characters > DUNGEONS[option.value as DungeonId].maxCharacters;
  }
  select.value = game.dungeonId;
}
