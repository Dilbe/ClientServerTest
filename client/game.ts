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
//
// The order of the track does wait for it (issue #128). In a turn, the
// character acts first and then each of its monsters. While one of them acts,
// its chip stays at the front; after its last event, a "done" item in the
// queue slides that chip to the end of the track. A monster that does nothing
// gets its "done" right after the one before it. So the client keeps the
// order on screen itself (`trackOrder`), instead of working it out from the
// newest "next turns", which would jump ahead of the board. When the queue
// is empty, the order is the same as the rotated track again. Catching up
// (a hidden tab, a snapshot) puts the chips in place without animation.
//
// The slide is a "FLIP" animation: note where every chip is (First), put
// them in the new order (Last), move each chip back to where it was with a
// CSS transform (Invert), and let the browser animate the transform away
// (Play). The list itself only changes once, and every chip stays the same
// element, so tapping a chip keeps working while it moves (issue #73).
//
// ## Planning
//
// The player plans by tapping the map (design.md, Planning and Mobile). A
// plan is a list of actions, as many as the character's actions stat, and
// each tap adds one. The hexes that make sense for the next action are
// highlighted, seen from where the actions planned so far leave the
// character: the free start hexes before it is placed, and afterwards its
// free neighbours (move) and its neighbours with a monster (attack). When
// the plan is full, a tap replaces its last action.
//
// A tap never takes an action back; only the buttons do: "Undo last action"
// and "Clear all actions" (issue #91). A monster can be attacked more than
// once in a turn, so tapping a monster that is already attacked adds another
// attack while the plan has room. When the plan is full, that tap changes
// nothing and only shows a short hint. (It used to take the attacks back,
// which players did by accident without noticing.)
//
// A character with heavy strike (design.md, Heavy strike) also gets a
// "Heavy strike" button. Tapping it arms it; the next tap on a monster next
// to the character then plans a heavy strike instead of an attack, and the
// button goes back to normal. Tapping the button again disarms it. So a
// normal attack still takes one tap. While a heavy strike can't be planned
// (on cooldown, or the plan already holds one), the button is greyed out and
// says why, worked out by the same shared function the server checks plans
// with.
//
// From rank 3, a "Charge" button works the same way (design.md, Charge).
// While it is armed, the highlighted hexes are only the monsters the
// character can charge from where its plan leaves it: in a straight line 2
// to 4 hexes away, with nothing in the way. Only one button is armed at a
// time.
//
// Every planned move, attack and door opening is drawn as a thick arrow from
// where the character will stand to the target hex, numbered when the plan
// has more than one action, so a player can see what each character will do
// and what a tap just changed.
//
// With more than one own character, the player chooses which one to plan
// for by tapping its chip on the track, or its token on the map. A tap that
// plans something always wins; only a tap that wouldn't plan anything can
// select. That never clashes in practice: a hex with a character on it is
// never a plan target. Planned positions (the dashed rings) can't be tapped
// to select, because a planned placement can sit on a start hex that is a
// target for another unplaced character.
//
// A tap that neither plans nor selects, on a monster that is on guard,
// shows that monster's alert range (design.md, Guards and alert range), and
// on a monster with a ranged attack, the hexes it can hit right now
// (design.md, Ranged attacks). Any other such tap hides it again.
//
// Plans are always worked out against the *latest* state: the snapshot plus
// every event received, also the ones still waiting to be played back. The
// playback can run a few seconds behind, and a plan is about the next turn,
// not about what the screen happens to show.
//
// A tap only sends a message; the plan on screen changes when the server's
// "plan" message comes back, the same message the other players get. So what
// a player sees is what the server has, and not what they hoped to set. With
// a round trip of tens of milliseconds, that is quick enough.
//
// ## The details card
//
// A card above the planning buttons shows one character or monster at a
// time, with its stats (design.md, The details card). The map is for acting
// and the track for looking: tapping any chip on the track shows it, and so
// does every tap on a token on the map, next to what the tap already does. A
// mouse shows a token while hovering over it, and a long press with a
// finger shows it without planning (map-view.ts tells it from a tap). When
// nothing else is shown, or what was shown dies, the card shows the
// selected character.
//
// ## The monster preview
//
// The game is deterministic, so the client can show exactly what the
// monsters will do with the current plans (design.md, Planning). It runs the
// shared rules' `previewCycle` on the latest state, the plans and the order
// of the next turns: the same `resolveTurn` the server will run when the
// turns fire. The server isn't involved. Whenever a plan changes or a turn
// arrives, the preview is simply worked out again; on a map this small that
// takes well under a millisecond.
//
// The same preview says which planned actions won't go through, for example
// because another character will have stepped onto the hex first. Those
// actions are drawn in red and listed under the map.

import type { GameMessage, PlanMessage, TurnMessage } from "../shared/protocol.ts";
import { ABILITIES, abilityProblem, type AbilityId } from "../shared/rules/abilities.ts";
import { CHARGE_MIN_DISTANCE, chargeMaxDistance, chargeProblem } from "../shared/rules/charge.ts";
import { positionAfter, stateAfterPlan } from "../shared/rules/planning.ts";
import { CLASS_NAMES, levelInGame, progressInGame } from "../shared/rules/advancement.ts";
import { DIFFICULTIES, monsterStats } from "../shared/rules/difficulties.ts";
import { isOnMap, type OneTimeReward } from "../shared/rules/dungeon-map.ts";
import { applyEvent, applyEvents, type Actor, type GameEvent } from "../shared/rules/events.ts";
import { isClosedDoor, isFree, type CharacterId, type GameState, type MonsterId } from "../shared/rules/game-state.ts";
import { distance, hexEquals, hexKey, neighbours, type Hex } from "../shared/rules/hex.ts";
import { canHit } from "../shared/rules/monsters.ts";
import {
  previewCycle,
  type MonsterPreview,
  type Preview,
  type PreviewCancellation,
} from "../shared/rules/preview.ts";
import {
  MONSTER_TYPES,
  STAT_IDS,
  STATS,
  TARGET_RULES,
  type MonsterType,
  type TargetRuleId,
} from "../shared/rules/stats.ts";
import { rotateTrack } from "../shared/rules/track.ts";
import { gameResult, type Plan, type PlannedAction } from "../shared/rules/turn.ts";
import { drawHexes, hexAt, hexCentre, hexElement, HEX_SIZE, svgElement } from "./hex-map.ts";
import { MapView } from "./map-view.ts";
import { describeOneTimeReward } from "./rewards.ts";

/** Time between two events in the playback. Tune by trying it out (design.md). */
const STEP_MS = 800;
/** How long a chip takes to slide to the end of the track, and the pause it gets in the playback. */
const SLIDE_MS = 500;
/** How often the countdown is redrawn. */
const COUNTDOWN_MS = 250;
/** How many lines of "what happened" to keep on screen. */
const LOG_LINES = 6;
/** How long a hint under the map stays, such as "Already attacking Rat 3". */
const HINT_MS = 3000;
/** The button of each ability, in index.html. Tapping one arms it. */
const ABILITY_BUTTONS: readonly [AbilityId, string][] = [
  ["heavyStrike", "#heavy-strike-button"],
  ["charge", "#charge-button"],
];

export interface GameScreenActions {
  /** Asks the server for a new snapshot of the game. */
  requestSnapshot(): void;
  /** Asks the server to set (or, with `null`, clear) the plan of one of the player's characters. */
  sendPlan(characterId: CharacterId, plan: Plan | null): void;
  /**
   * The result screen is shown: the rewards have been written, so the silver
   * total has changed. Also says whether any of the player's characters
   * gained a level, or reached a max level it can rank up from, for the
   * one-time hints (design.md, Rewards).
   */
  resultShown(progress: { levelledUp: boolean; reachedMaxLevel: boolean }): void;
}

function element<T extends Element = HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`missing element ${selector}`);
  return found;
}

export class GameScreen {
  private readonly actions: GameScreenActions;
  private readonly svg = element<SVGSVGElement>("#map");
  /** Zooming and moving the map; a long press shows a token in the details card. */
  private readonly mapView = new MapView(this.svg, element<HTMLButtonElement>("#fit-map-button"), (target) => {
    const h = hexAt(target);
    const token = h && this.tokenAt(h);
    if (token) this.showInCard(token);
  });

  private gameId: string | undefined;
  /** The number of the last turn received (not necessarily shown yet). */
  private sequence = 0;
  /** A turn went missing: ignore turns until the new snapshot arrives. */
  private waitingForSnapshot = false;

  /** The state as drawn now: the snapshot plus the events played back so far. */
  private shown: GameState | undefined;
  /** The snapshot plus every event received, played back or not: what plans are made against. */
  private latest: GameState | undefined;
  /** The current plan of every character that has one, as the server last said. */
  private plans = new Map<CharacterId, Plan>();
  /** The player's own character that taps plan for. */
  private selected: CharacterId | undefined;
  /**
   * The ability whose button is armed: the next tap on a monster plans it
   * instead of an attack. `undefined`: none.
   */
  private armed: AbilityId | undefined;
  /**
   * The monster whose range is highlighted, after a tap on it: its alert
   * range while it is on guard, or the hexes its ranged attack can hit.
   */
  private rangeShown: MonsterId | undefined;
  /**
   * What the details card shows instead of the selected character, after a
   * tap on it. `undefined`: the selected character.
   */
  private cardShows: Actor | undefined;
  /** The token the mouse is over: the card shows it for as long as that lasts. */
  private hovered: Actor | undefined;
  /** Hides the hint under the map again (see `showHint`). */
  private hintTimer: number | undefined;
  /** Events received but not played back yet, oldest first, with when each actor is done. */
  private queue: PlaybackItem[] = [];
  /**
   * The chips on the track in the order shown now, as `chipKey`s. Follows the
   * playback, not the newest "next turns" (see Playback above).
   */
  private trackOrder: string[] = [];
  /** The next `drawTrack` puts the chips in place without animation. */
  private trackJumps = true;
  private stepTimer: number | undefined;
  /** Who is doing something in the event being shown, to highlight them. */
  private acting: Actor | undefined;
  private result: "won" | "lost" | null = null;
  /** Whether the result screen is on screen now, so `resultShown` is called once per game. */
  private resultOnScreen = false;
  /** What every player gets when the game is won. */
  private silverReward = 0;
  /** What this player gets on top of the silver for a win: their first win of this dungeon. */
  private oneTimeRewards: OneTimeReward[] = [];
  private log: string[] = [];

  private names = new Map<CharacterId, GameMessage["players"][number]>();
  private mine = new Set<CharacterId>();
  /** The newest turn times from the server, and when they arrived (`performance.now()`). */
  private nextTurns: GameMessage["nextTurns"] = [];
  private nextTurnsReceivedAt = 0;
  private countdownTimer: number | undefined;

  constructor(actions: GameScreenActions) {
    this.actions = actions;
    // One listener for the whole map instead of one per hex ("event
    // delegation"): a click on a child element bubbles up to the <svg>, and
    // `event.target` says which hex it was. Like handling a click on a
    // WinForms container and asking which control is under the mouse.
    // A drag or pinch ends with a click too, but that one never plans.
    // A drag, a pinch or a long press ends with a click too, but that one never plans.
    this.svg.addEventListener("click", (event) => {
      if (this.mapView.wasNoTap) return;
      const h = hexAt(event.target);
      if (h) this.tapHex(h);
    });
    // Hovering with a mouse: the token under it, if any. Tokens let the
    // pointer through to their hex (see style.css), so the target is a hex.
    this.svg.addEventListener("pointermove", (event) => {
      if (event.pointerType !== "mouse") return;
      const h = event.buttons === 0 ? hexAt(event.target) : undefined;
      this.hover(h && this.tokenAt(h));
    });
    this.svg.addEventListener("pointerleave", () => this.hover(undefined));
    element("#track").addEventListener("click", (event) => {
      const item = (event.target as Element).closest<HTMLElement>("li[data-character], li[data-monster]");
      if (!item) return;
      if (item.dataset.monster !== undefined) return this.showInCard({ kind: "monster", id: Number(item.dataset.monster) });
      const id = Number(item.dataset.character);
      // The player's own characters are selected, as before; that shows them too.
      if (this.mine.has(id)) this.select(id);
      else this.showInCard({ kind: "character", id });
    });
    element("#clear-plan-button").addEventListener("click", () => {
      if (this.selected !== undefined) this.actions.sendPlan(this.selected, null);
    });
    element("#undo-plan-button").addEventListener("click", () => {
      if (this.selected === undefined) return;
      const plan = this.plans.get(this.selected) ?? [];
      this.actions.sendPlan(this.selected, plan.length > 1 ? plan.slice(0, -1) : null);
    });
    for (const [ability, selector] of ABILITY_BUTTONS) {
      element(selector).addEventListener("click", () => {
        this.armed = this.armed === ability ? undefined : ability;
        this.hideHint();
        this.drawPlanning();
      });
    }
  }

  /** A full snapshot: start over from it, without playback. */
  showSnapshot(message: GameMessage): void {
    this.stopPlayback();
    const sameGame = message.gameId === this.gameId;
    if (!sameGame) this.log = [];
    this.gameId = message.gameId;
    this.sequence = message.sequence;
    this.waitingForSnapshot = false;
    this.names = new Map(message.players.map((p) => [p.characterId, p]));
    this.mine = new Set(message.yourCharacters);
    this.setNextTurns(message.nextTurns);
    this.result = message.result;
    this.resultOnScreen = false;
    this.silverReward = message.silverReward;
    this.oneTimeRewards = message.oneTimeRewards;
    this.shown = message.state;
    this.latest = message.state;
    this.resetTrackOrder();
    this.plans = new Map(message.plans.map((p) => [p.characterId, p.plan]));
    this.rangeShown = undefined;
    if (!sameGame) {
      this.cardShows = undefined;
      this.hovered = undefined;
    }
    this.selectDefault();

    const map = message.state.map;
    // A new game gets its starting view (around the start hexes when zoomed
    // in); a new snapshot of the same one keeps the zoom.
    const bounds = drawHexes(this.svg, map.hexes, map.startHexes, map.doors);
    const starts = map.startHexes.map(hexCentre);
    const startFocus = {
      x: starts.reduce((sum, c) => sum + c.x, 0) / starts.length,
      y: starts.reduce((sum, c) => sum + c.y, 0) / starts.length,
    };
    this.mapView.setBounds(bounds, startFocus, sameGame);
    element("#game-difficulty").textContent = `Difficulty: ${DIFFICULTIES[message.state.difficulty].name}`;
    this.drawMonsterRules(message.state);
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
    const before = this.latest!;
    try {
      this.latest = applyEvents(before, message.events);
    } catch (error) {
      console.warn("Couldn't apply a turn; asking for a new snapshot.", error);
      this.waitingForSnapshot = true;
      this.actions.requestSnapshot();
      return;
    }
    this.sequence = message.sequence;
    this.setNextTurns(message.nextTurns);
    this.queue.push(...playbackItems(before, message.characterId, message.events));

    // The turn used up the plan of the character that acted, which may get a
    // follow-up plan instead, and the dead have no plans: the same as the
    // server does (server/game-manager.ts).
    if (message.nextPlan) this.plans.set(message.characterId, message.nextPlan);
    else this.plans.delete(message.characterId);
    for (const id of this.plans.keys()) if (!this.isOnTrack(id)) this.plans.delete(id);
    this.selectDefault();
    this.drawTrack();
    this.drawPlanning();
    this.drawCard();

    // A hidden tab gets its timers slowed down by the browser, so the queue
    // would only grow. Nobody is watching anyway: catch up at once.
    if (document.visibilityState === "hidden") this.catchUp();
    else if (this.stepTimer === undefined) this.step();
  }

  /** A character's plan changed (also the player's own: the server echoes it). */
  receivePlan(message: PlanMessage): void {
    if (message.gameId !== this.gameId) return;
    if (message.plan === null) this.plans.delete(message.characterId);
    else this.plans.set(message.characterId, message.plan);
    if (message.characterId === this.selected) this.hideHint();
    this.drawTrack();
    this.drawPlanning();
    this.drawCard();
  }

  /** Leaves the game screen (the game ended for this player, or they left it). */
  stop(): void {
    this.stopPlayback();
    window.clearInterval(this.countdownTimer);
    this.countdownTimer = undefined;
    this.gameId = undefined;
    this.shown = undefined;
    this.latest = undefined;
    this.plans.clear();
    this.selected = undefined;
    this.armed = undefined;
    this.rangeShown = undefined;
    this.cardShows = undefined;
    this.hovered = undefined;
    this.hideHint();
  }

  // ---- Planning ----

  /** How many actions a character has per turn. */
  private actionsOf(id: CharacterId): number {
    return this.latest?.characters.find((c) => c.id === id)?.stats.actions ?? 1;
  }

  /**
   * The planned actions of the selected character that the next tap builds
   * on: all of them while the plan isn't full, and otherwise all but the
   * last, which the tap then replaces.
   */
  private basePlan(): Plan {
    if (this.selected === undefined) return [];
    const plan = this.plans.get(this.selected) ?? [];
    const actions = this.actionsOf(this.selected);
    return plan.length < actions ? plan : plan.slice(0, actions - 1);
  }

  /**
   * Why the selected character can't plan an ability with the next tap, or
   * `undefined` when it can. Its own plan so far counts: one plan holds at
   * most one of each.
   */
  private abilityProblem(ability: AbilityId): string | undefined {
    const character = this.latest?.characters.find((c) => c.id === this.selected);
    if (!character) return "No character";
    return abilityProblem(character, ability, this.basePlan());
  }

  /** The ability whose button is armed, if it can be planned now. */
  private armedReady(): AbilityId | undefined {
    return this.armed !== undefined && this.abilityProblem(this.armed) === undefined ? this.armed : undefined;
  }

  /** What tapping each hex would add to the selected character's plan, by hex key. */
  private tapTargets(): Map<string, PlannedAction> {
    const targets = new Map<string, PlannedAction>();
    const latest = this.latest;
    if (!latest || gameResult(latest) !== null || this.selected === undefined) return targets;
    const character = latest.characters.find((c) => c.id === this.selected);
    if (!character || character.hp === 0) return targets;

    // Seen from where the actions planned so far leave the character, with
    // the doors they open. Only its own actions count: what the others do is
    // up to the preview.
    const state = stateAfterPlan(latest, character.id, this.basePlan());
    const position = state.characters.find((c) => c.id === character.id)!.position;

    // An armed charge: only the monsters it can reach (design.md, Charge),
    // and nothing before the character is on the map.
    const armed = this.armedReady();
    if (armed === "charge") {
      const maxDistance = chargeMaxDistance(character.abilityUpgrades);
      for (const m of state.monsters) {
        if (position !== null && chargeProblem(state, position, m.id, maxDistance) === undefined) {
          targets.set(hexKey(m.position), { type: "charge", monsterId: m.id });
        }
      }
      return targets;
    }

    // Before placement: the free start hexes.
    if (position === null) {
      for (const h of state.map.startHexes) {
        if (isFree(state, h)) targets.set(hexKey(h), { type: "place", hex: h });
      }
      return targets;
    }

    // After placement: a free neighbour is a move, a neighbour with a monster
    // an attack, and a closed door next to it is opening that door.
    for (const h of neighbours(position)) {
      if (!isOnMap(state.map, h)) continue;
      const monster = state.monsters.find((m) => m.hp > 0 && hexEquals(m.position, h));
      const attack = armed === "heavyStrike" ? "heavyStrike" : "attack";
      if (monster) targets.set(hexKey(h), { type: attack, monsterId: monster.id });
      else if (isClosedDoor(state, h)) targets.set(hexKey(h), { type: "openDoor", door: h });
      else if (isFree(state, h)) targets.set(hexKey(h), { type: "move", to: h });
    }
    return targets;
  }

  private tapHex(h: Hex): void {
    // A tap on a token always shows it in the card, whatever else it does:
    // the target of an attack, or a token a tap can't plan anything with.
    const token = this.tokenAt(h);
    if (token) this.showInCard(token);
    if (this.selected === undefined) return;
    const plan = this.plans.get(this.selected) ?? [];
    // A full plan that already attacks the tapped monster: a tap never takes
    // an action back (issue #91), so leave the plan as it is and say why.
    const monster = this.latest?.monsters.find((m) => m.hp > 0 && hexEquals(m.position, h));
    const attacksIt = (a: PlannedAction) => a.type === "attack" && a.monsterId === monster?.id;
    // An armed ability may still replace the last action.
    if (monster && this.armedReady() === undefined && plan.length >= this.actionsOf(this.selected) && plan.some(attacksIt)) {
      this.showHint(`Already attacking ${this.monsterName(monster.id)}. Use "Undo last action" to change the plan.`);
      return;
    }
    const action = this.tapTargets().get(hexKey(h));
    if (action) {
      this.actions.sendPlan(this.selected, [...this.basePlan(), action]);
      if (action.type === "heavyStrike" || action.type === "charge") this.armed = undefined;
      return;
    }
    // Not a plan target: maybe the token of another of the player's own characters.
    const own = this.ownTokenAt(h);
    if (own !== undefined && own !== this.selected) {
      this.select(own);
      return;
    }
    // Or a monster with a range to show: show it, or hide it on a second tap.
    const monsterWithRange = this.monsterWithRangeAt(h);
    this.rangeShown = monsterWithRange === this.rangeShown ? undefined : monsterWithRange;
    this.drawPlanning();
  }

  /**
   * The monster drawn on a hex, if it has a range worth showing: on guard
   * (asleep, with an alert range), or with a ranged attack. Like
   * `ownTokenAt`, from the state on screen.
   */
  private monsterWithRangeAt(h: Hex): MonsterId | undefined {
    return this.shown?.monsters.find((m) => {
      const type = MONSTER_TYPES[m.type];
      const onGuard = m.asleep && type.alertRange !== undefined;
      return m.hp > 0 && (onGuard || type.range > 1) && hexEquals(m.position, h);
    })?.id;
  }

  /**
   * The character or monster whose token is drawn on a hex, if any. Like
   * `ownTokenAt`, from the state on screen.
   */
  private tokenAt(h: Hex): Actor | undefined {
    const state = this.shown;
    const character = state?.characters.find((c) => c.hp > 0 && c.position !== null && hexEquals(c.position, h));
    if (character) return { kind: "character", id: character.id };
    const monster = state?.monsters.find((m) => m.hp > 0 && hexEquals(m.position, h));
    return monster && { kind: "monster", id: monster.id };
  }

  /**
   * The player's own character whose token is drawn on a hex, if any. Tokens
   * are drawn from the state on screen, not the latest one: the player taps
   * what they see, even while the playback is a turn behind.
   */
  private ownTokenAt(h: Hex): CharacterId | undefined {
    return this.shown?.characters.find(
      (c) =>
        this.mine.has(c.id) && c.hp > 0 && c.position !== null && hexEquals(c.position, h) && this.isOnTrack(c.id),
    )?.id;
  }

  /** The hex a planned action points at, in the latest state. */
  private actionHex(action: PlannedAction): Hex | undefined {
    switch (action.type) {
      case "place":
        return action.hex;
      case "move":
        return action.to;
      case "attack":
      case "heavyStrike":
      case "charge":
        return this.latest?.monsters.find((m) => m.id === action.monsterId && m.hp > 0)?.position;
      case "openDoor":
        return action.door;
    }
  }

  /**
   * A short message next to the plan buttons, for a tap that changed nothing.
   * It goes away after HINT_MS, or as soon as the plan changes.
   */
  private showHint(text: string): void {
    const hint = element("#plan-hint");
    hint.textContent = text;
    hint.hidden = false;
    window.clearTimeout(this.hintTimer);
    this.hintTimer = window.setTimeout(() => this.hideHint(), HINT_MS);
  }

  private hideHint(): void {
    window.clearTimeout(this.hintTimer);
    this.hintTimer = undefined;
    element("#plan-hint").hidden = true;
  }

  private select(id: CharacterId): void {
    if (id !== this.selected) this.armed = undefined;
    this.selected = id;
    // Selecting shows the selected character in the card again.
    this.cardShows = undefined;
    this.hideHint();
    this.drawTokens(undefined);
    this.drawTrack();
    this.drawPlanning();
    this.drawCard();
  }

  /** Shows a character or monster in the details card, until something else is shown. */
  private showInCard(actor: Actor): void {
    const isSelected = actor.kind === "character" && actor.id === this.selected;
    this.cardShows = isSelected ? undefined : actor;
    this.drawTokens(undefined);
    this.drawTrack();
    this.drawCard();
  }

  /** The mouse moved onto a token, or off one (`undefined`). */
  private hover(actor: Actor | undefined): void {
    if (actor === this.hovered || sameActor(actor, this.hovered)) return;
    this.hovered = actor;
    this.drawTokens(undefined);
    this.drawTrack();
    this.drawCard();
  }

  /**
   * What the details card shows: the token under the mouse, else what was
   * last tapped, else the selected character. Whoever has died (on screen)
   * is dropped, so the card goes back to the selected character.
   */
  private cardActor(): Actor | undefined {
    const alive = (a: Actor | undefined) => {
      if (!a || !this.shown) return false;
      const list = a.kind === "character" ? this.shown.characters : this.shown.monsters;
      return (list.find((x) => x.id === a.id)?.hp ?? 0) > 0;
    };
    if (!alive(this.hovered)) this.hovered = undefined;
    if (!alive(this.cardShows)) this.cardShows = undefined;
    const selected: Actor | undefined = this.selected === undefined ? undefined : { kind: "character", id: this.selected };
    return this.hovered ?? this.cardShows ?? (alive(selected) ? selected : undefined);
  }

  /**
   * Whose token and chip are marked as the one in the card: only when that
   * isn't the selected character, which has its own mark.
   */
  private cardMarked(): Actor | undefined {
    const actor = this.cardActor();
    return actor?.kind === "character" && actor.id === this.selected ? undefined : actor;
  }

  /** Keeps the selection on one of the player's characters that is still in the game. */
  private selectDefault(): void {
    if (this.selected !== undefined && this.mine.has(this.selected) && this.isOnTrack(this.selected)) return;
    this.armed = undefined;
    this.selected = this.latest?.track.find((s) => this.mine.has(s.characterId))?.characterId;
  }

  private isOnTrack(id: CharacterId): boolean {
    return this.latest?.track.some((s) => s.characterId === id) ?? false;
  }

  // ---- Playback ----

  private step(): void {
    const item = this.queue.shift();
    if (item === undefined || this.shown === undefined) {
      // Done: draw once more without highlights. The track is normally in
      // order already; this only fixes it up where a death changed it.
      this.stepTimer = undefined;
      this.acting = undefined;
      this.resetTrackOrder(false);
      this.draw(undefined);
      return;
    }
    if (item.kind === "done") {
      const key = chipKey(item.actor);
      // It died during its turn: its chip is gone, so there is nothing to slide.
      if (!this.trackOrder.includes(key)) return this.step();
      this.trackOrder = [...this.trackOrder.filter((k) => k !== key), key];
      this.acting = undefined;
      this.draw(undefined);
      this.stepTimer = window.setTimeout(() => this.step(), SLIDE_MS);
      return;
    }
    const event = item.event;
    if (!this.apply(event)) return;
    // Events that only change bookkeeping, such as cooldowns, show nothing:
    // don't make the player wait for them.
    if (this.describe(event) === undefined) return this.step();
    this.acting = actorOf(event);
    this.draw(event);
    this.stepTimer = window.setTimeout(() => this.step(), STEP_MS);
  }

  /** Applies all queued events at once, without animation. */
  private catchUp(): void {
    window.clearTimeout(this.stepTimer);
    this.stepTimer = undefined;
    this.acting = undefined;
    for (let item = this.queue.shift(); item !== undefined; item = this.queue.shift()) {
      if (item.kind === "event" && !this.apply(item.event)) return;
    }
    this.resetTrackOrder();
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

  /**
   * Puts the track in its order without playback: the rotated track, starting
   * with the next to act. `jump`: without animation.
   */
  private resetTrackOrder(jump = true): void {
    if (!this.shown) return;
    this.trackOrder = rotateTrack(this.shown.track, this.nextTurns[0]?.characterId).flatMap((slot) => [
      chipKey({ kind: "character", id: slot.characterId }),
      ...slot.monsterIds.map((id) => chipKey({ kind: "monster", id })),
    ]);
    if (jump) this.trackJumps = true;
  }

  private setNextTurns(nextTurns: GameMessage["nextTurns"]): void {
    this.nextTurns = nextTurns;
    this.nextTurnsReceivedAt = performance.now();
  }

  // ---- Drawing ----

  /** Redraws everything that follows from the state. `event` is the one just played back, to animate it. */
  private draw(event: GameEvent | undefined): void {
    this.drawDoors();
    this.drawTokens(event);
    this.drawTrack();
    this.drawPlanning();
    this.drawCard();
    this.drawResult();
  }

  /**
   * The details card (design.md, The details card): the stats of one
   * character or monster, as on screen now. Hidden when there is nothing to
   * show, for example once all of the player's characters have died.
   */
  private drawCard(): void {
    const card = element("#details-card");
    const state = this.shown;
    const actor = this.cardActor();
    card.hidden = !state || !actor || this.result !== null;
    if (!state || !actor) return;
    // Each name and value in a <div> of their own, so the grid in style.css
    // keeps them together. textContent only: names come from other players.
    const fact = (name: string, value: string | number) => {
      const pair = document.createElement("div");
      pair.append(textElement("dt", name), textElement("dd", String(value)));
      return pair;
    };

    if (actor.kind === "character") {
      const character = state.characters.find((c) => c.id === actor.id)!;
      const names = this.names.get(actor.id);
      const level = names && levelInGame(names.rank, character.maxXpGain, character.xpGained);
      const stats = character.stats;
      card.className = `details-card character${this.mine.has(actor.id) ? " mine" : ""}`;
      element("#details-name").textContent = this.characterName(actor.id);
      element("#details-kind").textContent = names
        ? `${CLASS_NAMES[names.class]} · rank ${names.rank} · level ${level}` +
          (character.position === null ? " · not on the map yet" : "")
        : "";
      element("#details-stats").replaceChildren(
        fact("HP", `${character.hp}/${stats.hitPoints}`),
        fact(STATS.actions.name, stats.actions),
        fact(STATS.movement.name, stats.movement),
        fact(STATS.attackDamage.name, stats.attackDamage),
        fact("Planned", `${this.plans.get(actor.id)?.length ?? 0}/${stats.actions}`),
      );
      return;
    }

    const monster = state.monsters.find((m) => m.id === actor.id)!;
    const type = MONSTER_TYPES[monster.type];
    const stats = monsterStats(monster.type, state.difficulty);
    card.className = `details-card monster${monster.asleep ? " asleep" : ""}`;
    element("#details-name").textContent = `${this.monsterName(actor.id)} (${this.monsterLabel(actor.id)})`;
    element("#details-kind").textContent = !monster.asleep
      ? "Awake"
      : type.alertRange !== undefined
        ? `On guard: wakes when a character comes within ${type.alertRange} hexes`
        : "Asleep behind a closed door";
    element("#details-stats").replaceChildren(
      fact("HP", `${monster.hp}/${stats.hitPoints}`),
      fact(STATS.actions.name, stats.actions),
      fact(STATS.movement.name, stats.movement),
      fact(STATS.attackDamage.name, stats.attackDamage),
      fact("Range", type.range),
    );
  }

  /**
   * The win or loss screen, once the playback has reached the end. Going back
   * to the lobby replaces leaving: the game is over for everyone anyway.
   */
  private drawResult(): void {
    element("#game-result").hidden = this.result === null;
    element("#leave-game").hidden = this.result !== null;
    if (this.result === null || !this.shown) return;
    const won = this.result === "won";
    element("#result-title").textContent = won ? "Victory!" : "Defeat";
    const difficulty = DIFFICULTIES[this.shown.difficulty].name;
    element("#result-text").textContent = won
      ? `All monsters are dead. The party won the dungeon on ${difficulty}.`
      : `All characters are dead. The party lost the dungeon on ${difficulty}.`;
    // The rewards (design.md, Rewards): the XP is kept either way, the
    // silver only comes with a win.
    element("#result-rewards").replaceChildren(
      ...this.shown.characters.map((c) => textElement("li", `${this.characterName(c.id)}: +${c.xpGained} XP`)),
      textElement(
        "li",
        won ? `Every player earned ${this.silverReward} silver.` : "No silver: that only comes with a win.",
      ),
      // Only shown to the players who get them, on their first win of the dungeon on this difficulty.
      ...(won
        ? this.oneTimeRewards.map((r) =>
            textElement("li", `Your first win of this dungeon on ${difficulty}: ${describeOneTimeReward(r)}.`),
          )
        : []),
    );
    if (!this.resultOnScreen) {
      this.resultOnScreen = true;
      this.actions.resultShown(this.myProgress(this.shown));
    }
  }

  /** Whether the game gave any of the player's own characters a level, or a max level to rank up from. */
  private myProgress(state: GameState): { levelledUp: boolean; reachedMaxLevel: boolean } {
    const progress = { levelledUp: false, reachedMaxLevel: false };
    for (const c of state.characters) {
      const names = this.names.get(c.id);
      if (!this.mine.has(c.id) || !names) continue;
      const own = progressInGame(names.rank, c.maxXpGain, c.xpGained);
      progress.levelledUp ||= own.levelledUp;
      progress.reachedMaxLevel ||= own.reachedMaxLevel;
    }
    return progress;
  }

  /** Marks the doors that are closed in the state on screen. */
  private drawDoors(): void {
    const state = this.shown;
    if (!state) return;
    for (const polygon of this.svg.querySelectorAll<SVGPolygonElement>("polygon.hex.door")) {
      const h = { q: Number(polygon.dataset.q), r: Number(polygon.dataset.r) };
      polygon.classList.toggle("closed", isClosedDoor(state, h));
    }
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

    const wanted: { key: string; actor: Actor; position: Hex; hp: number; asleep: boolean }[] = [
      ...state.characters
        .filter((c) => c.hp > 0 && c.position !== null)
        .map((c) => ({
          key: `c${c.id}`,
          actor: { kind: "character", id: c.id } as Actor,
          position: c.position!,
          hp: c.hp,
          asleep: false,
        })),
      ...state.monsters
        .filter((m) => m.hp > 0)
        .map((m) => ({
          key: `m${m.id}`,
          actor: { kind: "monster", id: m.id } as Actor,
          position: m.position,
          hp: m.hp,
          asleep: m.asleep,
        })),
    ];

    const marked = this.cardMarked();
    const existing = new Map<string, SVGGElement>();
    for (const token of layer.querySelectorAll<SVGGElement>("g.token:not(.dying)")) {
      existing.set(token.dataset.key!, token);
    }

    for (const { key, actor, position, hp, asleep } of wanted) {
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
      // Greyed out until its room wakes up (design.md, Doors and sleeping rooms).
      token.classList.toggle("asleep", asleep);
      // The same mark as the chip on the track: which own character taps plan for.
      token.classList.toggle(
        "selected",
        actor.kind === "character" && this.mine.size > 1 && actor.id === this.selected,
      );
      // The one in the details card, if it isn't the selected character.
      token.classList.toggle("in-card", sameActor(marked, actor));
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
    label.textContent = isCharacter ? String(actor.id) : this.monsterLabel(actor.id);
    const hp = svgElement("text", { class: "hp", y: HEX_SIZE * 0.72 });
    // The selection ring is always there, and only shown on the selected token (see style.css).
    token.append(
      svgElement("circle", { class: "selection", r: HEX_SIZE * 0.68 }),
      svgElement("circle", { class: "body", r: TOKEN_RADIUS }),
      label,
      hp,
    );
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
   * monsters, with how many of its actions are planned and the time until
   * its next turn. It starts with the next to act, so the group that just
   * acted is at the end. The player's own characters that still need an
   * action stand out (design.md, Turns: the initiative track).
   *
   * This runs every COUNTDOWN_MS, so it keeps the chips and only updates
   * them. Replacing them would break clicks: the browser fires `click` only
   * when the button goes down and up on the same element, and a chip that was
   * swapped out in between is no longer the same element (issue #73). Moving
   * a chip to another place in the list keeps it the same element. When a
   * character or monster leaves the track, the other chips are kept too.
   */
  private drawTrack(): void {
    const state = this.shown;
    if (!state) return;
    const next = this.result === null ? this.nextTurns[0]?.characterId : undefined;
    const track = element("#track");

    // Build new chips only when what is on the track changes.
    const layout = state.track
      .map((slot) => `${slot.characterId}:${this.characterName(slot.characterId)}:${slot.monsterIds.join(",")}`)
      .join("|");
    const jump = this.trackJumps || matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.trackJumps = false;
    const before = jump ? undefined : chipPositions(track);
    let moved = false;
    if (track.dataset.layout !== layout) {
      track.dataset.layout = layout;
      track.replaceChildren(...this.trackChips(state, track));
      moved = true;
    }
    if (this.orderTrackChips(track)) moved = true;
    if (before && moved) slideChips(track, before);
    const marked = this.cardMarked();

    for (const item of track.querySelectorAll<HTMLLIElement>("li.character")) {
      const id = Number(item.dataset.character);
      const character = state.characters.find((c) => c.id === id);
      const plan = this.plans.get(id);
      const planned = plan?.length ?? 0;
      const actions = this.actionsOf(id);
      const mine = this.mine.has(id);
      item.classList.toggle("mine", mine);
      // Colour is never the only signal: the count below says the same.
      item.classList.toggle("needs-plan", mine && planned < actions);
      item.classList.toggle("planned", mine && planned >= actions);
      item.classList.toggle("next", id === next);
      // With more than one own character, tapping a chip chooses which one to plan for.
      item.classList.toggle("selected", this.mine.size > 1 && id === this.selected);
      item.classList.toggle("acting", sameActor(this.acting, { kind: "character", id }));
      item.classList.toggle("in-card", sameActor(marked, { kind: "character", id }));
      item.title = plan
        ? `Plans to ${plan.map((a) => a.type).join(", then ")}`
        : character?.position === null
          ? "Not on the map yet"
          : "";
      item.querySelector(".entered")!.textContent = character?.position === null ? " (not entered)" : "";
      item.querySelector(".planned-count")!.textContent = ` ${planned}/${actions}`;
      const seconds = this.secondsUntil(id);
      item.querySelector(".countdown")!.textContent =
        seconds === undefined ? "" : seconds === 0 ? " now" : ` ${seconds} s`;
    }
    for (const item of track.querySelectorAll<HTMLLIElement>("li.monster")) {
      const id = Number(item.dataset.monster);
      const asleep = state.monsters.find((m) => m.id === id)?.asleep ?? false;
      const range = this.monsterType(id).alertRange;
      item.classList.toggle("acting", sameActor(this.acting, { kind: "monster", id }));
      item.classList.toggle("in-card", sameActor(marked, { kind: "monster", id }));
      item.classList.toggle("asleep", asleep);
      const name = this.monsterName(id);
      item.title = !asleep
        ? name
        : range !== undefined
          ? `${name}, on guard: skips its turns until a character comes within ${range} hexes or attacks it`
          : `${name}, asleep behind a closed door: skips its turns until the door opens`;
      item.querySelector(".asleep-mark")!.textContent = !asleep ? "" : range !== undefined ? " (on guard)" : " (asleep)";
    }

    const nextLine = element("#next-turn");
    const seconds = next === undefined ? undefined : this.secondsUntil(next);
    nextLine.textContent =
      next === undefined || seconds === undefined
        ? ""
        : `Next turn: ${this.characterName(next)}, ${seconds === 0 ? "now" : `in ${seconds} s`}`;
  }

  /**
   * Puts the chips in the order of `trackOrder` (see Playback above). Chips
   * that it doesn't know yet go at the end. `append` of a chip that is
   * already in the list moves it, so only the order changes and every chip
   * stays the same element. Returns whether any chip moved.
   */
  private orderTrackChips(track: HTMLElement): boolean {
    const chips = new Map([...track.children].map((chip) => [chipKeyOf(chip as HTMLElement), chip]));
    this.trackOrder = this.trackOrder.filter((key) => chips.has(key));
    for (const key of chips.keys()) if (!this.trackOrder.includes(key)) this.trackOrder.push(key);
    const ordered = this.trackOrder.map((key) => chips.get(key)!);
    if (!ordered.some((chip, i) => track.children[i] !== chip)) return false;
    track.append(...ordered);
    return true;
  }

  /**
   * The chips for the track: the ones already in `track` where they are
   * still on it, and new, empty ones for the rest; `drawTrack` fills in what
   * changes.
   */
  private trackChips(state: GameState, track: HTMLElement): HTMLLIElement[] {
    const existing = new Map([...track.children].map((chip) => [chipKeyOf(chip as HTMLElement), chip as HTMLLIElement]));
    const items: HTMLLIElement[] = [];
    for (const slot of state.track) {
      const kept = existing.get(chipKey({ kind: "character", id: slot.characterId }));
      if (kept) {
        // The name is the chip's first child, before the spans.
        kept.firstChild!.textContent = this.characterName(slot.characterId);
        items.push(kept);
        for (const monsterId of slot.monsterIds) {
          items.push(existing.get(chipKey({ kind: "monster", id: monsterId })) ?? this.monsterChip(monsterId));
        }
        continue;
      }
      const item = document.createElement("li");
      item.className = "character";
      item.dataset.character = String(slot.characterId);
      // textContent, never innerHTML: names come from other players.
      item.textContent = this.characterName(slot.characterId);
      for (const className of ["entered", "planned-count", "countdown"]) {
        const span = document.createElement("span");
        span.className = className;
        item.append(span);
      }
      items.push(item);

      for (const monsterId of slot.monsterIds) {
        items.push(existing.get(chipKey({ kind: "monster", id: monsterId })) ?? this.monsterChip(monsterId));
      }
    }
    return items;
  }

  private monsterChip(monsterId: MonsterId): HTMLLIElement {
    const monster = document.createElement("li");
    monster.className = "monster";
    monster.dataset.monster = String(monsterId);
    monster.textContent = this.monsterLabel(monsterId);
    // Not only the grey: the text says it too (colour is never the only signal).
    const mark = document.createElement("span");
    mark.className = "asleep-mark";
    monster.append(mark);
    return monster;
  }

  /**
   * Everything about plans: the highlighted hexes the selected character can
   * tap, a marker for every planned action of every character, the monster
   * preview, and the line under the map that says what the player's own
   * character will do.
   */
  private drawPlanning(): void {
    const layer = this.svg.querySelector("g.plans");
    const state = this.latest;
    if (!state || !layer) return;
    const preview = this.result === null && gameResult(state) === null ? this.runPreview(state) : undefined;
    const cancelled = new Map(
      (preview?.cancellations ?? []).map((c) => [`${c.characterId}:${c.action}`, c] as const),
    );

    const targets = this.tapTargets();
    const range = this.rangeHexes(state);
    for (const polygon of this.svg.querySelectorAll<SVGPolygonElement>("polygon.hex")) {
      const key = `${polygon.dataset.q},${polygon.dataset.r}`;
      const action = targets.get(key);
      polygon.classList.toggle("target", action !== undefined);
      polygon.classList.toggle("attack", action?.type === "attack" || action?.type === "heavyStrike" || action?.type === "charge");
      polygon.classList.toggle("open-door", action?.type === "openDoor");
      polygon.classList.toggle("alert-range", range.kind === "alert" && range.hexes.has(key));
      polygon.classList.toggle("hit-range", range.kind === "hit" && range.hexes.has(key));
    }

    // Plan markers are cheap and don't animate: draw them anew each time.
    // Every move, attack and door opening is an arrow from where the action
    // before it leaves the character; a placement is a dashed ring on its
    // start hex. Two attacks on the same monster from the same hex would be
    // the same arrow, so they become one arrow with both numbers ("1,2").
    const markers: SVGElement[] = [];
    for (const [characterId, plan] of this.plans) {
      const mine = this.mine.has(characterId) ? " mine" : "";
      const arrows = new Map<string, { from: Hex; to: Hex; type: PlannedAction["type"]; failing: string; numbers: number[] }>();
      // The first action starts where the character is now (as drawn).
      const shownCharacter = this.shown?.characters.find((c) => c.id === characterId);
      let from = shownCharacter?.position ?? null;
      const chargeDistance = chargeMaxDistance(shownCharacter?.abilityUpgrades ?? {});
      plan.forEach((action, index) => {
        const to = this.actionHex(action);
        const start = from;
        from = positionAfter(state, from, action, chargeDistance);
        if (!to || !hexElement(this.svg, to)) return;
        const failing = cancelled.has(`${characterId}:${index}`) ? " cancelled" : "";
        if (action.type === "place" || !start) {
          markers.push(this.placementMarker(to, `${mine}${failing}`, plan.length > 1 ? `${characterId}·${index + 1}` : String(characterId)));
          return;
        }
        const key = `${hexKey(start)}>${hexKey(to)}:${action.type}${failing}`;
        const arrow = arrows.get(key) ?? { from: start, to, type: action.type, failing, numbers: [] };
        arrow.numbers.push(index + 1);
        arrows.set(key, arrow);
      });
      for (const arrow of arrows.values()) {
        markers.push(
          planArrow(arrow.from, arrow.to, arrow.type, `${mine}${arrow.failing}`, plan.length > 1 ? numbersLabel(arrow.numbers) : ""),
        );
      }
    }
    // Actions that won't go through are drawn on top, so they stay visible
    // when another character's arrow points at the same hex: that is
    // usually why they fail.
    const onTop = (m: SVGElement) => (m.classList.contains("cancelled") ? 1 : 0);
    layer.replaceChildren(...markers.sort((a, b) => onTop(a) - onTop(b)));

    this.drawPlanText(targets.size > 0, preview?.cancellations ?? []);
    this.drawPreview(state, preview);
  }

  /**
   * A planned placement: a dashed ring on the start hex. The character isn't
   * on the map yet, so there is no token to start an arrow from; the label
   * says whose it is, with the action's number if the plan has several.
   */
  private placementMarker(h: Hex, classes: string, text: string): SVGElement {
    const centre = hexCentre(h);
    const ring = svgElement("g", { class: `plan-marker place${classes}` });
    ring.style.transform = `translate(${centre.x}px, ${centre.y}px)`;
    // Top right inside the ring, so it stays clear of a token on the hex.
    const label = svgElement("text", { x: HEX_SIZE * 0.42, y: -HEX_SIZE * 0.42 });
    label.textContent = text;
    ring.append(svgElement("circle", { r: HEX_SIZE * 0.62 }), label);
    // Bottom right: a cross for a placement that won't go through.
    if (classes.includes("cancelled")) ring.append(crossMark(HEX_SIZE * 0.42, HEX_SIZE * 0.42));
    return ring;
  }

  /**
   * The range of the monster whose range was tapped open, as hex keys:
   *
   * - On guard: its alert range, every hex of the map within that many hexes
   *   in a straight line, pillars and walls or not, like the rule itself.
   * - With a ranged attack: the hexes it can hit right now, within its range
   *   and in line of sight. A character in the way hides the hexes behind it.
   *
   * Empty when none is shown. Once that monster is dead, or a guard without
   * a ranged attack is awake, its range is hidden.
   */
  private rangeHexes(state: GameState): { kind: "alert" | "hit"; hexes: Set<string> } {
    const monster = state.monsters.find((m) => m.id === this.rangeShown);
    const type = monster && MONSTER_TYPES[monster.type];
    if (monster && type && monster.hp > 0) {
      if (monster.asleep && type.alertRange !== undefined) {
        const alert = type.alertRange;
        const hexes = state.map.hexes.filter((h) => distance(h, monster.position) <= alert);
        return { kind: "alert", hexes: new Set(hexes.map(hexKey)) };
      }
      if (type.range > 1) {
        const hexes = state.map.hexes.filter((h) => canHit(state, monster, h));
        return { kind: "hit", hexes: new Set(hexes.map(hexKey)) };
      }
    }
    this.rangeShown = undefined;
    return { kind: "hit", hexes: new Set() };
  }

  /**
   * What will happen with the current plans: a line under the map for every
   * planned action that won't go through and for every monster, and arrows
   * for the monsters on the map. Like the plans, the preview is worked out
   * against the latest state. The arrows wait until the playback has caught
   * up, because until then the tokens on screen aren't where the arrows would
   * start.
   */
  private drawPreview(state: GameState, preview: Preview | undefined): void {
    const layer = this.svg.querySelector("g.preview");
    element("#monster-preview").hidden = preview === undefined;
    layer?.replaceChildren();
    if (!preview) return;

    element("#monster-preview-list").replaceChildren(
      ...preview.cancellations.map((c) => textElement("li", this.describeCancellation(c, true))),
      ...[...preview.monsters].map(([id, p]) => textElement("li", this.describeMonsterPreview(id, p))),
    );

    if (!layer || this.queue.length > 0) return;
    const shapes: SVGElement[] = [];
    for (const [id, p] of preview.monsters) {
      if (p.type !== "acts") continue;
      let from = state.monsters.find((m) => m.id === id)!.position;
      for (const step of p.steps) {
        if (step.type === "move") {
          shapes.push(previewLine(step.from, step.to, "preview-line"));
          const { x, y } = hexCentre(step.to);
          shapes.push(svgElement("circle", { class: "preview-ghost", cx: x, cy: y, r: HEX_SIZE * 0.5 }));
          from = step.to;
        } else {
          const ranged = distance(from, step.targetAt) > 1 ? " ranged" : "";
          shapes.push(previewAttackLine(from, step.targetAt, `preview-line attack${ranged}`));
          const { x, y } = hexCentre(step.targetAt);
          // Top left inside the hex: plan markers use the top right.
          const damage = svgElement("text", { class: "preview-damage", x: x - HEX_SIZE * 0.45, y: y - HEX_SIZE * 0.45 });
          damage.textContent = `-${step.damage}`;
          shapes.push(damage);
        }
      }
    }
    layer.replaceChildren(...shapes);
  }

  /** The preview for the coming cycle, or `undefined` if the rules couldn't work it out. */
  private runPreview(state: GameState): Preview | undefined {
    try {
      return previewCycle(
        state,
        this.nextTurns.map((t) => t.characterId),
        this.plans,
      );
    } catch (error) {
      // A preview is a nice-to-have: better none than a broken game screen.
      console.warn("Couldn't work out the preview.", error);
      return undefined;
    }
  }

  /**
   * The rules of each monster type in this game (design.md, Monsters): its
   * stats from the monster type's data on the game's difficulty, and how it
   * chooses a target and a route.
   */
  private drawMonsterRules(state: GameState): void {
    const parts: HTMLElement[] = [];
    for (const typeId of new Set(state.monsters.map((m) => m.type))) {
      const type = MONSTER_TYPES[typeId];
      const ruleList = (rules: readonly TargetRuleId[]) => {
        const list = document.createElement("ol");
        list.append(...rules.map((rule) => textElement("li", TARGET_RULES[rule].description)));
        return list;
      };
      const typeStats = monsterStats(typeId, state.difficulty);
      const stats = STAT_IDS.map((stat) => `${STATS[stat].name}: ${typeStats[stat]}`);
      parts.push(
        textElement("h4", `${type.name} (${type.label} on the map)`),
        textElement("p", [...stats, `Range: ${type.range}`].join(", ") + "."),
      );
      if (type.rangedTargetRules) {
        parts.push(
          textElement(
            "p",
            `For each of its actions: if one or more players are within ${type.range} hexes and in line of sight, it shoots one of them, without moving, chosen with these rules, in order, until one player is left:`,
          ),
          ruleList(type.rangedTargetRules),
          textElement(
            "p",
            "Otherwise it moves 1 hex towards its target, chosen with these rules, in order, until one player is left:",
          ),
        );
      } else {
        parts.push(
          textElement(
            "p",
            type.range > 1
              ? `For each of its actions it attacks its target if the target is within ${type.range} hexes and in line of sight, and otherwise moves 1 hex towards it. It chooses its target again for every action.`
              : "For each of its actions it attacks its target if the target is next to it, and otherwise moves 1 hex towards it. It chooses its target again for every action.",
          ),
          textElement("p", "It chooses its target with these rules, in order, until one player is left:"),
        );
      }
      parts.push(
        ruleList(type.targetRules),
        textElement(
          "p",
          "Characters, other monsters and closed doors block its way. When several moves get it equally close, it takes the first of them going clockwise, starting at straight up.",
        ),
        textElement(
          "p",
          type.alertRange !== undefined
            ? `It starts on guard (greyed out): it skips its turns until, at the start of its turn, a character is within ${type.alertRange} hexes in a straight line, or until it is attacked. After that it stays awake. Doors don't wake it. Tap it to see its alert range.`
            : "Monsters never open doors. A monster in a room behind a closed door is asleep (greyed out): it skips its turns until a door into its room is opened.",
        ),
      );
      if (type.range > 1) {
        parts.push(
          textElement(
            "p",
            "Line of sight: the straight line between the centres of the two hexes doesn't pass a wall, pillar, closed door or character. Monsters don't block it. When the line runs exactly along the border between two hexes, it is only blocked if both of them block it. Tap it to see the hexes it can hit right now.",
          ),
        );
      }
    }
    element("#monster-rules-body").replaceChildren(...parts);
  }

  private drawPlanText(canTap: boolean, cancellations: readonly PreviewCancellation[]): void {
    const text = element("#plan-text");
    const clear = element<HTMLButtonElement>("#clear-plan-button");
    const undo = element<HTMLButtonElement>("#undo-plan-button");
    const id = this.selected;
    const character = this.latest?.characters.find((c) => c.id === id);
    const plan = id === undefined ? undefined : this.plans.get(id);
    // Disabled rather than hidden, so the buttons stay in the same place.
    clear.disabled = plan === undefined;
    undo.disabled = plan === undefined;
    for (const [ability, selector] of ABILITY_BUTTONS) this.drawAbilityButton(ability, selector);
    element("#planning").hidden = id === undefined || this.result !== null;
    if (id === undefined || !character) return;
    const armed = this.armedReady();
    if (armed === "heavyStrike") {
      text.textContent = canTap
        ? "Heavy strike: tap a highlighted monster next to the character, or the button again to cancel."
        : "Heavy strike: no monster is next to the character.";
      return;
    }
    if (armed === "charge") {
      const line = `in a straight line ${CHARGE_MIN_DISTANCE} to ${chargeMaxDistance(character.abilityUpgrades)} hexes away`;
      text.textContent = canTap
        ? `Charge: tap a highlighted monster ${line}, or the button again to cancel.`
        : `Charge: no monster is ${line} with a free path.`;
      return;
    }

    const who = this.mine.size > 1 ? `Character ${id}` : "Your character";
    const actions = character.stats.actions;
    if (plan) {
      const more = !canTap
        ? ""
        : plan.length < actions
          ? ` Tap a highlighted hex to plan action ${plan.length + 1} of ${actions}.`
          : " Tap a highlighted hex to replace the last action.";
      const failing = cancellations
        .filter((c) => c.characterId === id)
        .map((c) => ` ${this.describeCancellation(c, false)}`)
        .join("");
      text.textContent =
        `${who} will ${plan.map((a) => this.describeAction(a)).join(", then ")} on its next turn.` +
        failing +
        more;
    } else if (character.position === null) {
      text.textContent = canTap
        ? `${who} isn't on the map yet. Tap a highlighted start hex to choose where it enters; without a plan it enters on the first free one.`
        : `${who} isn't on the map yet, and no start hex is free. It tries again on its next turn.`;
    } else {
      const count = actions > 1 ? ` It has ${actions} actions per turn.` : "";
      text.textContent = canTap
        ? `${who} has no plan and will do nothing. Tap a highlighted hex to move there, a monster next to it to attack, or a closed door next to it to open it.${count}`
        : `${who} has no plan and nowhere to go.`;
    }
  }

  /**
   * The button of an ability, such as "Heavy strike": only for a character
   * that has it. Greyed out with the reason while it can't be planned, and
   * marked while armed.
   */
  private drawAbilityButton(ability: AbilityId, selector: string): void {
    const button = element<HTMLButtonElement>(selector);
    const character = this.latest?.characters.find((c) => c.id === this.selected);
    button.hidden = !character?.abilities.includes(ability);
    const problem = this.abilityProblem(ability);
    // Armed, but no longer possible (for example the plan changed on
    // another device): back to normal.
    if (problem !== undefined && this.armed === ability) this.armed = undefined;
    button.disabled = problem !== undefined;
    const name = ABILITIES[ability].name;
    button.textContent = problem === undefined ? name : `${name} (${problem})`;
    button.classList.toggle("armed", this.armed === ability);
    button.setAttribute("aria-pressed", String(this.armed === ability));
  }

  private describeAction(action: PlannedAction): string {
    switch (action.type) {
      case "place":
        return "enter the room on the marked hex";
      case "move":
        return "move to the marked hex";
      case "attack":
        return `attack ${this.monsterName(action.monsterId)}`;
      case "heavyStrike":
        return `use heavy strike on ${this.monsterName(action.monsterId)}`;
      case "charge":
        return `charge ${this.monsterName(action.monsterId)}`;
      case "openDoor":
        return "open the marked door";
    }
  }

  /**
   * "Its plan" with 1 action per turn, otherwise "action 2 of its plan". For
   * the log and the preview, which also show other players' characters.
   */
  private actionName(characterId: CharacterId, index: number): string {
    return this.actionsOf(characterId) > 1 ? `action ${index + 1} of its plan` : "its plan";
  }

  /**
   * A planned action that the preview says won't go through, and why: with
   * the character's name for the list under the map, or as a follow-up to
   * the plan text of the player's own character.
   */
  private describeCancellation(c: PreviewCancellation, withName: boolean): string {
    if (withName) {
      return `${this.characterName(c.characterId)}: ${this.actionName(c.characterId, c.action)} won't go through (${c.reason}).`;
    }
    const what = this.actionsOf(c.characterId) > 1 ? `action ${c.action + 1}` : "it";
    return `But ${what} won't go through (${c.reason}).`;
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

  /** "1 Runner (Ann)": the character's number in the game, its name, and its player. */
  private characterName(id: CharacterId): string {
    const names = this.names.get(id);
    if (!names) return `${id} ?`;
    return `${id} ${names.characterName} (${this.mine.has(id) ? "you" : names.displayName})`;
  }

  /** "Rat 3": the monster's type and its number in the game. A named monster only has its name: "Tessa". */
  private monsterName(id: MonsterId): string {
    const type = this.monsterType(id);
    return type.named ? type.name : `${type.name} ${id + 1}`;
  }

  /** "R3": the short form on the map and the initiative track, see `MonsterType.label`. */
  private monsterLabel(id: MonsterId): string {
    return `${this.monsterType(id).label}${id + 1}`;
  }

  /** A monster's type never changes during a game, so any copy of the state will do. */
  private monsterType(id: MonsterId): MonsterType {
    const monster = (this.latest ?? this.shown)?.monsters.find((m) => m.id === id);
    return MONSTER_TYPES[monster?.type ?? "basic"];
  }

  private actorName(actor: Actor): string {
    return actor.kind === "character" ? this.characterName(actor.id) : this.monsterName(actor.id);
  }

  private describeMonsterPreview(id: MonsterId, preview: MonsterPreview): string {
    const name = this.monsterName(id);
    switch (preview.type) {
      case "acts": {
        const steps = preview.steps.map((step) => {
          const target = this.characterName(step.target);
          if (step.type === "move") return `moves 1 hex towards ${target}`;
          const verb = this.monsterType(id).range > 1 ? "shoots" : "attacks";
          return `${verb} ${target} for ${step.damage}${step.kills ? ` (${target} dies)` : ""}`;
        });
        return `${name}, acting after ${this.characterName(preview.after)}: ${steps.join(", then ")}.`;
      }
      case "dies":
        return `${name} is killed in the turn of ${this.characterName(preview.after)}.`;
      case "stays":
        return `${name} stays where it is.`;
      case "asleep": {
        const range = this.monsterType(id).alertRange;
        return range !== undefined
          ? `${name} is on guard: it waits until a character comes within ${range} hexes.`
          : `${name} is asleep behind a closed door.`;
      }
    }
  }

  private describe(event: GameEvent): string | undefined {
    switch (event.type) {
      case "placed":
        return `${this.characterName(event.characterId)} entered the room.`;
      case "notPlaced":
        return `${this.characterName(event.characterId)} couldn't enter: no start hex is free.`;
      case "moved":
        return event.ability === "charge"
          ? `${this.actorName(event.actor)} charged.`
          : `${this.actorName(event.actor)} moved.`;
      case "attacked": {
        const ranged = event.attacker.kind === "monster" && this.monsterType(event.attacker.id).range > 1;
        const how = event.ability === "heavyStrike" ? " with a heavy strike" : event.ability === "charge" ? " with a charge" : "";
        return `${this.actorName(event.attacker)} ${ranged ? "shot" : "hit"} ${this.actorName(event.target)}${how} for ${event.damage}.`;
      }
      case "cooldownStarted":
      case "cooldownsAdvanced":
        // Bookkeeping: the ability's button shows the cooldown.
        return undefined;
      case "died":
        return `${this.actorName(event.who)} died.`;
      case "doorOpened":
        return `${this.characterName(event.characterId)} opened a door.`;
      case "monstersWoke":
        return `${event.monsterIds.map((id) => this.monsterName(id)).join(" and ")} woke up!`;
      case "xpGained":
        return `XP: ${event.gains.map((g) => `${this.characterName(g.characterId)} +${g.xp}`).join(", ")}.`;
      case "planCancelled":
        return `${this.characterName(event.characterId)}: ${this.actionName(event.characterId, event.action)} was cancelled (${event.reason}).`;
      case "gameEnded":
        return event.result === "won" ? "The party won!" : "The party lost.";
    }
  }
}

/** An HTML element with plain text in it (textContent, never innerHTML). */
function textElement<K extends keyof HTMLElementTagNameMap>(tag: K, text: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.textContent = text;
  return element;
}

/** A line from one hex towards another, stopping short of both centres so it doesn't cover the tokens. */
function previewLine(from: Hex, to: Hex, className: string): SVGLineElement {
  const a = hexCentre(from);
  const b = hexCentre(to);
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const inset = (HEX_SIZE * 0.5) / length;
  return svgElement("line", {
    class: className,
    x1: a.x + (b.x - a.x) * inset,
    y1: a.y + (b.y - a.y) * inset,
    x2: b.x - (b.x - a.x) * inset,
    y2: b.y - (b.y - a.y) * inset,
  });
}

/** How far a move or door arrow sits to the right of the line between the two hex centres. */
const ARROW_OFFSET = HEX_SIZE * 0.12;

/**
 * How far an attack line sits to the right of the line between the two token
 * centres, seen from the attacker (design.md, Planning). Far enough that an
 * attack back the other way passes beside it instead of under it, and that a
 * line from below passes beside the HP under a token instead of through it.
 */
const ATTACK_OFFSET = HEX_SIZE * 0.38;

/** The radius of a token's circle (see `createToken`). */
const TOKEN_RADIUS = HEX_SIZE * 0.5;

/**
 * Positions along a line from one hex to another, shifted `offset` to its
 * right: `at(along, side)` is `along` from the centre of `from` towards `to`,
 * and `side` further to the right (negative: to the left). In SVG y points
 * down, so turning the direction (x, y) into (-y, x) turns it clockwise on
 * screen: to the right, seen from `from`.
 */
function sideLine(from: Hex, to: Hex, offset: number) {
  const a = hexCentre(from);
  const b = hexCentre(to);
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const u = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
  const n = { x: -u.y, y: u.x };
  const at = (along: number, side = 0) => ({
    x: a.x + u.x * along + n.x * (side + offset),
    y: a.y + u.y * along + n.y * (side + offset),
  });
  return { length, at };
}

/**
 * How far along the line between two token centres a line `offset` to the
 * side of it crosses the edge of the token: a bit clockwise of the point
 * straight between the centres.
 */
function tokenEdge(offset: number): number {
  return Math.sqrt(TOKEN_RADIUS ** 2 - offset ** 2);
}

/**
 * A monster's attack in the preview: a thin line from token edge to token
 * edge, kept to its right like the players' attack arrows, with a small
 * arrowhead at the target so it's clear whose line it is when an attack
 * back the other way runs beside it.
 */
function previewAttackLine(from: Hex, to: Hex, className: string): SVGGElement {
  const { length, at } = sideLine(from, to, ATTACK_OFFSET);
  const tip = length - tokenEdge(ATTACK_OFFSET);
  const base = tip - HEX_SIZE * 0.25;
  const head = HEX_SIZE * 0.13;
  const s0 = at(tokenEdge(ATTACK_OFFSET));
  const s1 = at(base);
  const group = svgElement("g", { class: className });
  group.append(
    svgElement("line", { x1: s0.x, y1: s0.y, x2: s1.x, y2: s1.y }),
    svgElement("polygon", { class: "head", points: points(at(tip), at(base, head), at(base, -head)) }),
  );
  return group;
}

/** Points as the `points` attribute of an SVG polygon. */
function points(...ps: { x: number; y: number }[]): string {
  return ps.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
}

/**
 * A planned action as a thick arrow (design.md, Planning), from the hex where
 * the character will stand to the target hex. The shape says what it is, not
 * only the colour:
 *
 * - a move: a solid arrowhead on the empty hex it moves to;
 * - an attack: a red arrow with a burst at the tip, on the monster's edge;
 * - a heavy strike: like an attack, with a double shaft and a bigger burst;
 * - a charge: a long attack arrow along the whole run, from the character to
 *   the monster, with a chevron (">") on every hex it runs through;
 * - opening a door: a flat bar at the tip, like a door being pushed.
 *
 * Each arrow sits a little to the right of the line between the centres, so
 * an arrow back ("move there, then back") doesn't hide the one going out.
 * Attacks sit further to the right and run from token edge to token edge, so
 * a monster attacking back passes beside them (see `ATTACK_OFFSET`).
 * `number` is put in a small badge on the shaft; `classes` adds " mine" and
 * " cancelled" (see style.css).
 */
function planArrow(from: Hex, to: Hex, type: PlannedAction["type"], classes: string, number: string): SVGGElement {
  const isAttack = type === "attack" || type === "heavyStrike" || type === "charge";
  const heavy = type === "heavyStrike";
  const { length, at } = sideLine(from, to, isAttack ? ATTACK_OFFSET : ARROW_OFFSET);

  // The shaft starts at the edge of the token. A move ends near the centre
  // of its empty hex, a door at the edge of the hex. An attack runs from
  // token edge to token edge, with its burst against the monster's token,
  // which is drawn on top of it.
  const start = isAttack ? tokenEdge(ATTACK_OFFSET) : HEX_SIZE * 0.5;
  const burst = HEX_SIZE * (heavy ? 0.42 : 0.3);
  const tip = isAttack ? length - tokenEdge(ATTACK_OFFSET) - burst * 0.5 : length - HEX_SIZE * (type === "move" ? 0.1 : 0.3);
  const shaftEnd = type === "move" ? tip - HEX_SIZE * 0.4 : tip;

  const arrow = svgElement("g", { class: `plan-arrow ${type}${classes}` });
  // A heavy strike has a double shaft, like "⇒": between two neighbouring
  // tokens the shaft is short, and that still shows there.
  for (const side of type === "heavyStrike" ? [HEX_SIZE * 0.13, -HEX_SIZE * 0.13] : [0]) {
    const s0 = at(start, side);
    const s1 = at(shaftEnd, side);
    arrow.append(svgElement("line", { class: "shaft", x1: s0.x, y1: s0.y, x2: s1.x, y2: s1.y }));
  }

  if (type === "move") {
    const head = HEX_SIZE * 0.28;
    arrow.append(svgElement("polygon", { class: "head", points: points(at(tip, 0), at(shaftEnd, head), at(shaftEnd, -head)) }));
  } else if (isAttack) {
    // A burst: a star with 8 points around the tip, bigger for a heavy strike.
    const centre = at(tip, 0);
    const star: { x: number; y: number }[] = [];
    for (let i = 0; i < 16; i++) {
      const angle = (Math.PI / 8) * i;
      const radius = i % 2 === 0 ? burst : HEX_SIZE * (heavy ? 0.16 : 0.12);
      star.push({ x: centre.x + radius * Math.cos(angle), y: centre.y + radius * Math.sin(angle) });
    }
    arrow.append(svgElement("polygon", { class: "head", points: points(...star) }));
  } else {
    const bar = HEX_SIZE * 0.3;
    const p0 = at(tip, bar);
    const p1 = at(tip, -bar);
    arrow.append(svgElement("line", { class: "bar", x1: p0.x, y1: p0.y, x2: p1.x, y2: p1.y }));
  }

  if (type === "charge") {
    // A chevron on the centre of every hex of the run, pointing at the monster.
    const steps = distance(from, to);
    const size = HEX_SIZE * 0.2;
    for (let i = 1; i < steps; i++) {
      const along = (length * i) / steps;
      const ps = points(at(along - size, size * 1.3), at(along + size * 0.4, 0), at(along - size, -size * 1.3));
      arrow.append(svgElement("polyline", { class: "chevron", points: ps }));
    }
  }

  if (number) {
    // Beside the shaft rather than on it: between two tokens next to each
    // other, the visible part of an arrow is short.
    const middle = at((start + shaftEnd) / 2, HEX_SIZE * 0.42);
    const height = HEX_SIZE * 0.45;
    const width = Math.max(height, number.length * HEX_SIZE * 0.2 + HEX_SIZE * 0.2);
    const label = svgElement("text", { x: middle.x, y: middle.y });
    label.textContent = number;
    arrow.append(
      svgElement("rect", {
        class: "badge",
        x: middle.x - width / 2,
        y: middle.y - height / 2,
        width,
        height,
        rx: height / 2,
      }),
      label,
    );
  }
  if (classes.includes("cancelled")) {
    // A cross next to the tip, on the other side from the number. To the
    // left of an attack runs the line of an attack back, if there is one,
    // and the target's HP may be there: its cross goes to the right instead,
    // past the number.
    const cross = at(tip, HEX_SIZE * (isAttack ? 0.42 : -0.4));
    arrow.append(crossMark(cross.x, cross.y));
  }
  return arrow;
}

/** The numbers of the actions one arrow stands for: "2", "1,2", or "1–3" for three or more in a row. */
function numbersLabel(numbers: readonly number[]): string {
  const inARow = numbers.every((n, i) => i === 0 || n === numbers[i - 1]! + 1);
  return inARow && numbers.length > 2 ? `${numbers[0]}–${numbers.at(-1)}` : numbers.join(",");
}

/** The "×" that marks a planned action that won't go through. */
function crossMark(x: number, y: number): SVGTextElement {
  const cross = svgElement("text", { class: "cross", x, y });
  cross.textContent = "×";
  return cross;
}

/** What the playback queue holds: an event to show, or that an actor's part of the turn is done. */
type PlaybackItem = { kind: "event"; event: GameEvent } | { kind: "done"; actor: Actor };

/**
 * A resolved turn as playback items: its events, with a "done" after the
 * last event of the character and of each of its monsters, in the order they
 * act (see Playback above). Events without an actor of their own, such as a
 * death after an attack, belong to the actor before them. A monster that did
 * nothing is done right after the one before it. `state` is the state before
 * the turn, which says which monsters follow the character.
 */
function playbackItems(state: GameState, characterId: CharacterId, events: readonly GameEvent[]): PlaybackItem[] {
  const slot = state.track.find((s) => s.characterId === characterId);
  const actors: Actor[] = slot
    ? [{ kind: "character", id: characterId }, ...slot.monsterIds.map((id): Actor => ({ kind: "monster", id }))]
    : [];
  let owner: Actor = { kind: "character", id: characterId };
  const owners = events.map((event) => (owner = actorOf(event) ?? owner));

  // For each actor, the index of the event it is done after (-1: before all).
  // Never before the actor ahead of it, so the chips slide in turn order.
  let after = -1;
  const doneAfter = actors.map((actor) => {
    after = Math.max(after, owners.findLastIndex((o) => sameActor(o, actor)));
    return after;
  });

  const items: PlaybackItem[] = [];
  const pushDone = (index: number) =>
    actors.forEach((actor, i) => {
      if (doneAfter[i] === index) items.push({ kind: "done", actor });
    });
  pushDone(-1);
  events.forEach((event, index) => {
    items.push({ kind: "event", event });
    pushDone(index);
  });
  return items;
}

/** The key of a chip on the track: "c7" for character 7, "m3" for monster 3. */
function chipKey(actor: Actor): string {
  return `${actor.kind === "character" ? "c" : "m"}${actor.id}`;
}

function chipKeyOf(chip: HTMLElement): string {
  return chip.dataset.character !== undefined ? `c${chip.dataset.character}` : `m${chip.dataset.monster}`;
}

/** Where each chip on the track is on screen now, by chip (the "First" of FLIP). */
function chipPositions(track: HTMLElement): Map<Element, DOMRect> {
  return new Map([...track.children].map((chip) => [chip, chip.getBoundingClientRect()]));
}

/**
 * Slides every chip that moved from where it was (`before`) to where it is
 * now: the "Invert" and "Play" of FLIP. A chip that is still sliding is
 * measured where it is on screen, so a new slide carries on from there.
 */
function slideChips(track: HTMLElement, before: Map<Element, DOMRect>): void {
  for (const chip of track.children) for (const animation of chip.getAnimations()) animation.cancel();
  for (const chip of track.children) {
    const from = before.get(chip);
    if (!from) continue; // A new chip: it just appears.
    const to = chip.getBoundingClientRect();
    const dx = from.left - to.left;
    const dy = from.top - to.top;
    if (dx === 0 && dy === 0) continue;
    chip.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], {
      duration: SLIDE_MS,
      easing: "ease-in-out",
    });
  }
}

/** Who does something in an event, to highlight them while it is shown. */
function actorOf(event: GameEvent): Actor | undefined {
  switch (event.type) {
    case "placed":
    case "notPlaced":
    case "planCancelled":
    case "doorOpened":
      return { kind: "character", id: event.characterId };
    case "moved":
      return event.actor;
    case "attacked":
      return event.attacker;
    case "died":
    case "monstersWoke":
    case "xpGained":
    case "cooldownStarted":
    case "cooldownsAdvanced":
    case "gameEnded":
      return undefined;
  }
}

function sameActor(a: Actor | undefined, b: Actor | undefined): boolean {
  return a !== undefined && b !== undefined && a.kind === b.kind && a.id === b.id;
}
