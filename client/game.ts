// The game screen: the hex map, the initiative track with its countdown, and
// the playback of resolved turns (design.md, Showing what happens;
// architecture.md, Keeping the client in sync).
//
// ## Staying in sync
//
// The server sends a full snapshot ("game") on every connect, and after that
// one "turn" message per resolved turn, numbered 1, 2, 3, ... If a number is
// skipped, a turn got lost and the state on screen can no longer be trusted,
// so the client asks for a new snapshot ("get-game") and ignores turns until
// it arrives. A reconnect needs nothing special: the server sends a snapshot
// anyway.
//
// ## Playback
//
// A turn arrives as a list of events at once, but the player should see them
// one by one. So the events go into a queue, and a timer takes one out every
// STEP_MS: it applies the event to the state on screen with the shared rules'
// `applyEvent` (the same function the server uses), and redraws. The map's
// tokens move smoothly because CSS animates the change (see style.css).
//
// The countdown doesn't wait for the playback: it always counts down from the
// newest "next turns" the server sent.

import type { GameMessage, TurnMessage } from "../shared/protocol.ts";
import { applyEvent, type Actor, type GameEvent } from "../shared/rules/events.ts";
import type { CharacterId, GameState, MonsterId } from "../shared/rules/game-state.ts";
import type { Hex } from "../shared/rules/hex.ts";
import { drawHexes, hexCentre, HEX_SIZE, svgElement } from "./hex-map.ts";

/** Time between two events in the playback. Tune by trying it out (design.md). */
const STEP_MS = 800;
/** How often the countdown is redrawn. */
const COUNTDOWN_MS = 250;
/** How many lines of "what happened" to keep on screen. */
const LOG_LINES = 6;

export interface GameScreenActions {
  /** Asks the server for a new snapshot of the game. */
  requestSnapshot(): void;
}

function element<T extends Element = HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`missing element ${selector}`);
  return found;
}

export class GameScreen {
  private readonly actions: GameScreenActions;
  private readonly svg = element<SVGSVGElement>("#map");

  private gameId: string | undefined;
  /** The number of the last turn received (not necessarily shown yet). */
  private sequence = 0;
  /** A turn went missing: ignore turns until the new snapshot arrives. */
  private waitingForSnapshot = false;

  /** The state as drawn now: the snapshot plus the events played back so far. */
  private shown: GameState | undefined;
  /** Events received but not played back yet, oldest first. */
  private queue: GameEvent[] = [];
  private stepTimer: number | undefined;
  /** Who is doing something in the event being shown, to highlight them. */
  private acting: Actor | undefined;
  private result: "won" | "lost" | null = null;
  private log: string[] = [];

  private names = new Map<CharacterId, string>();
  private mine = new Set<CharacterId>();
  /** The newest turn times from the server, and when they arrived (`performance.now()`). */
  private nextTurns: GameMessage["nextTurns"] = [];
  private nextTurnsReceivedAt = 0;
  private countdownTimer: number | undefined;

  constructor(actions: GameScreenActions) {
    this.actions = actions;
  }

  /** A full snapshot: start over from it, without playback. */
  showSnapshot(message: GameMessage): void {
    this.stopPlayback();
    if (message.gameId !== this.gameId) this.log = [];
    this.gameId = message.gameId;
    this.sequence = message.sequence;
    this.waitingForSnapshot = false;
    this.names = new Map(message.players.map((p) => [p.characterId, p.displayName]));
    this.mine = new Set(message.yourCharacters);
    this.setNextTurns(message.nextTurns);
    this.result = message.result;
    this.shown = message.state;

    drawHexes(this.svg, message.state.map.hexes, message.state.map.startHexes);
    this.draw(undefined);
    this.drawLog();

    window.clearInterval(this.countdownTimer);
    this.countdownTimer = window.setInterval(() => this.drawTrack(), COUNTDOWN_MS);
  }

  /** One resolved turn: queue its events for playback, or ask for a snapshot when a turn is missing. */
  receiveTurn(message: TurnMessage): void {
    if (message.gameId !== this.gameId || this.waitingForSnapshot) return;
    if (message.sequence <= this.sequence) return; // Already have it.
    if (message.sequence !== this.sequence + 1) {
      this.waitingForSnapshot = true;
      this.actions.requestSnapshot();
      return;
    }
    this.sequence = message.sequence;
    this.setNextTurns(message.nextTurns);
    this.queue.push(...message.events);

    // A hidden tab gets its timers slowed down by the browser, so the queue
    // would only grow. Nobody is watching anyway: catch up at once.
    if (document.visibilityState === "hidden") this.catchUp();
    else if (this.stepTimer === undefined) this.step();
  }

  /** Leaves the game screen (the game ended for this player, or they left it). */
  stop(): void {
    this.stopPlayback();
    window.clearInterval(this.countdownTimer);
    this.countdownTimer = undefined;
    this.gameId = undefined;
    this.shown = undefined;
  }

  // ---- Playback ----

  private step(): void {
    const event = this.queue.shift();
    if (event === undefined || this.shown === undefined) {
      // Done: draw once more without highlights.
      this.stepTimer = undefined;
      this.acting = undefined;
      this.draw(undefined);
      return;
    }
    if (!this.apply(event)) return;
    this.acting = actorOf(event);
    this.draw(event);
    this.stepTimer = window.setTimeout(() => this.step(), STEP_MS);
  }

  /** Applies all queued events at once, without animation. */
  private catchUp(): void {
    window.clearTimeout(this.stepTimer);
    this.stepTimer = undefined;
    this.acting = undefined;
    for (let event = this.queue.shift(); event !== undefined; event = this.queue.shift()) {
      if (!this.apply(event)) return;
    }
    this.draw(undefined);
  }

  /**
   * Applies one event to the state on screen. If that fails, the client's
   * state doesn't match the server's: get a fresh snapshot.
   */
  private apply(event: GameEvent): boolean {
    try {
      this.shown = applyEvent(this.shown!, event);
    } catch (error) {
      console.warn("Couldn't apply an event; asking for a new snapshot.", error);
      this.stopPlayback();
      this.waitingForSnapshot = true;
      this.actions.requestSnapshot();
      return false;
    }
    if (event.type === "gameEnded") this.result = event.result;
    this.addLog(this.describe(event));
    return true;
  }

  private stopPlayback(): void {
    window.clearTimeout(this.stepTimer);
    this.stepTimer = undefined;
    this.queue = [];
    this.acting = undefined;
  }

  private setNextTurns(nextTurns: GameMessage["nextTurns"]): void {
    this.nextTurns = nextTurns;
    this.nextTurnsReceivedAt = performance.now();
  }

  // ---- Drawing ----

  /** Redraws everything that follows from the state. `event` is the one just played back, to animate it. */
  private draw(event: GameEvent | undefined): void {
    this.drawTokens(event);
    this.drawTrack();
    const result = element("#game-result");
    result.hidden = this.result === null;
    result.textContent =
      this.result === "won" ? "Victory! All monsters are dead." : "Defeat. All characters are dead.";
  }

  /**
   * The characters and monsters on the map. Tokens are kept between redraws
   * and only moved, so CSS can animate the move; that's why this updates the
   * existing elements instead of drawing everything anew.
   */
  private drawTokens(event: GameEvent | undefined): void {
    const state = this.shown;
    const layer = this.svg.querySelector("g.tokens");
    if (!state || !layer) return;

    const wanted: { key: string; actor: Actor; position: Hex; hp: number }[] = [
      ...state.characters
        .filter((c) => c.hp > 0 && c.position !== null)
        .map((c) => ({ key: `c${c.id}`, actor: { kind: "character", id: c.id } as Actor, position: c.position!, hp: c.hp })),
      ...state.monsters
        .filter((m) => m.hp > 0)
        .map((m) => ({ key: `m${m.id}`, actor: { kind: "monster", id: m.id } as Actor, position: m.position, hp: m.hp })),
    ];

    const existing = new Map<string, SVGGElement>();
    for (const token of layer.querySelectorAll<SVGGElement>("g.token:not(.dying)")) {
      existing.set(token.dataset.key!, token);
    }

    for (const { key, actor, position, hp } of wanted) {
      let token = existing.get(key);
      existing.delete(key);
      if (!token) {
        token = this.createToken(key, actor);
        if (event?.type === "placed") token.classList.add("appearing");
        layer.append(token);
      }
      const { x, y } = hexCentre(position);
      // Set through `style` (CSSOM), not a style="" attribute: our Content
      // Security Policy blocks inline style attributes, but not this.
      token.style.transform = `translate(${x}px, ${y}px)`;
      token.querySelector(".hp")!.textContent = String(hp);
      token.classList.toggle("acting", sameActor(this.acting, actor));
      if (event?.type === "attacked" && sameActor(event.target, actor)) this.showHit(token, event.damage);
    }

    // Whoever is no longer on the map (died) fades out, then is removed.
    for (const token of existing.values()) {
      token.classList.add("dying");
      window.setTimeout(() => token.remove(), STEP_MS);
    }
  }

  private createToken(key: string, actor: Actor): SVGGElement {
    const isCharacter = actor.kind === "character";
    const token = svgElement("g", { class: `token ${actor.kind}` });
    token.dataset.key = key;
    if (isCharacter && this.mine.has(actor.id)) token.classList.add("mine");
    const label = svgElement("text", { class: "label", y: -2 });
    label.textContent = isCharacter ? String(actor.id) : `M${actor.id + 1}`;
    const hp = svgElement("text", { class: "hp", y: HEX_SIZE * 0.72 });
    token.append(svgElement("circle", { class: "body", r: HEX_SIZE * 0.5 }), label, hp);
    return token;
  }

  /** A short flash and the damage floating up from the target. */
  private showHit(token: SVGGElement, damage: number): void {
    token.classList.remove("hit");
    // Reading the size forces the browser to notice the class was removed,
    // so adding it again restarts the animation.
    void token.getBoundingClientRect();
    token.classList.add("hit");
    const text = svgElement("text", { class: "damage", y: -HEX_SIZE * 0.6 });
    text.textContent = `-${damage}`;
    token.append(text);
    window.setTimeout(() => {
      text.remove();
      token.classList.remove("hit");
    }, STEP_MS);
  }

  /**
   * The initiative track: each character in turn order, followed by its
   * monsters, with the time until each character's next turn.
   */
  private drawTrack(): void {
    const state = this.shown;
    if (!state) return;
    const next = this.result === null ? this.nextTurns[0]?.characterId : undefined;

    const items: HTMLLIElement[] = [];
    for (const slot of state.track) {
      const character = state.characters.find((c) => c.id === slot.characterId);
      const item = document.createElement("li");
      item.className = "character";
      // textContent, never innerHTML: names come from other players.
      item.textContent = this.characterName(slot.characterId);
      if (this.mine.has(slot.characterId)) item.classList.add("mine");
      if (character?.position === null) {
        item.classList.add("unplaced");
        item.title = "Not on the map yet";
      }
      if (slot.characterId === next) item.classList.add("next");
      if (sameActor(this.acting, { kind: "character", id: slot.characterId })) item.classList.add("acting");
      const seconds = this.secondsUntil(slot.characterId);
      if (seconds !== undefined) {
        const countdown = document.createElement("span");
        countdown.className = "countdown";
        countdown.textContent = seconds === 0 ? "now" : `${seconds} s`;
        item.append(" ", countdown);
      }
      items.push(item);

      for (const monsterId of slot.monsterIds) {
        const monster = document.createElement("li");
        monster.className = "monster";
        monster.textContent = `M${monsterId + 1}`;
        if (sameActor(this.acting, { kind: "monster", id: monsterId })) monster.classList.add("acting");
        items.push(monster);
      }
    }
    element("#track").replaceChildren(...items);

    const nextLine = element("#next-turn");
    const seconds = next === undefined ? undefined : this.secondsUntil(next);
    nextLine.textContent =
      next === undefined || seconds === undefined
        ? ""
        : `Next turn: ${this.characterName(next)}, ${seconds === 0 ? "now" : `in ${seconds} s`}`;
  }

  /** Whole seconds until the character's next turn, counted down from when the server said it. */
  private secondsUntil(characterId: CharacterId): number | undefined {
    const entry = this.nextTurns.find((t) => t.characterId === characterId);
    if (!entry) return undefined;
    const elapsed = (performance.now() - this.nextTurnsReceivedAt) / 1000;
    return Math.ceil(Math.max(0, entry.inSeconds - elapsed));
  }

  private addLog(line: string | undefined): void {
    if (line === undefined) return;
    this.log = [line, ...this.log].slice(0, LOG_LINES);
    this.drawLog();
  }

  private drawLog(): void {
    element("#game-log").replaceChildren(
      ...this.log.map((line) => {
        const item = document.createElement("li");
        item.textContent = line;
        return item;
      }),
    );
  }

  // ---- Text ----

  /** "1 Ann": the character's number in the game, and its player. */
  private characterName(id: CharacterId): string {
    const name = this.names.get(id) ?? "?";
    return this.mine.has(id) ? `${id} ${name} (you)` : `${id} ${name}`;
  }

  private actorName(actor: Actor): string {
    return actor.kind === "character" ? this.characterName(actor.id) : monsterName(actor.id);
  }

  private describe(event: GameEvent): string | undefined {
    switch (event.type) {
      case "placed":
        return `${this.characterName(event.characterId)} entered the room.`;
      case "notPlaced":
        return `${this.characterName(event.characterId)} couldn't enter: no start hex is free.`;
      case "moved":
        return `${this.actorName(event.actor)} moved.`;
      case "attacked":
        return `${this.actorName(event.attacker)} hit ${this.actorName(event.target)} for ${event.damage}.`;
      case "died":
        return `${this.actorName(event.who)} died.`;
      case "planCancelled":
        return `${this.characterName(event.characterId)}'s plan was cancelled: ${event.reason}.`;
      case "gameEnded":
        return event.result === "won" ? "The party won!" : "The party lost.";
    }
  }
}

function monsterName(id: MonsterId): string {
  return `Monster ${id + 1}`;
}

/** Who does something in an event, to highlight them while it is shown. */
function actorOf(event: GameEvent): Actor | undefined {
  switch (event.type) {
    case "placed":
    case "notPlaced":
    case "planCancelled":
      return { kind: "character", id: event.characterId };
    case "moved":
      return event.actor;
    case "attacked":
      return event.attacker;
    case "died":
    case "gameEnded":
      return undefined;
  }
}

function sameActor(a: Actor | undefined, b: Actor): boolean {
  return a !== undefined && a.kind === b.kind && a.id === b.id;
}
