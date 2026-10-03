// Shows the lobby: the open games, your party, or the started game.
//
// Every lobby message is a full snapshot, so drawing simply starts over each
// time instead of updating what is already on screen.

import type { LobbyGame, LobbyMessage } from "../shared/protocol.ts";

export interface LobbyActions {
  join(gameId: string): void;
}

function element(selector: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(selector);
  if (!found) throw new Error(`missing element ${selector}`);
  return found;
}

export function renderLobby(lobby: LobbyMessage, myName: string, actions: LobbyActions): void {
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
      names.textContent = game.players.map((p) => p.displayName).join(", ");
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
