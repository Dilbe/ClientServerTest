import { test } from "node:test";
import assert from "node:assert/strict";
import { baseStats } from "./classes.ts";
import type { DungeonMap } from "./dungeon-map.ts";
import { applyEvents, type GameEvent } from "./events.ts";
import type { CharacterId, GameState } from "./game-state.ts";
import { fromOffset, hex, hexesBetween, hexKey, rectangle, type Hex } from "./hex.ts";
import { inCharacterLineOfSight } from "./line-of-sight.ts";
import { previewCycle } from "./preview.ts";
import { planShotProblem, shoots, shotProblem } from "./shot.ts";
import { followUpPlan, newGameState, resolveTurn, type Plan, type PlannedAction } from "./turn.ts";

const R = 1;
const A = 2;

/** Where the ranger stands: the middle of a 13 by 13 room. */
const CENTRE = fromOffset(6, 6);
const up = (steps: number): Hex => hex(CENTRE.q, CENTRE.r - steps);
const down = (steps: number): Hex => hex(CENTRE.q, CENTRE.r + steps);
const downRight = (steps: number): Hex => hex(CENTRE.q + steps, CENTRE.r);

/** A pillar 2 hexes down of the ranger. */
const PILLAR = down(2);
const ROOM: Hex[] = rectangle(13, 13).filter((h) => hexKey(h) !== hexKey(PILLAR));

const attack = (target: Hex): PlannedAction => ({ type: "attack", target });

/**
 * A ranger in the middle of the room and the given monsters, all basic
 * monsters with 3 hit points; A, an adventurer, off the map unless placed.
 * The monsters never act unless `monsterSlot` puts them on the track.
 */
function game({
  monsters,
  attackDamage = 1,
  actions = 1,
  aAt = null,
  ranger = true,
  monsterSlot = false,
}: {
  monsters: Hex[];
  attackDamage?: number;
  actions?: number;
  aAt?: Hex | null;
  ranger?: boolean;
  monsterSlot?: boolean;
}): GameState {
  const map: DungeonMap = {
    hexes: ROOM,
    startHexes: [fromOffset(12, 12)],
    doors: [],
    monsters: monsters.map((position) => ({ type: "basic", position })),
  };
  const classId = ranger ? "ranger" : "adventurer";
  const state = newGameState(
    map,
    [
      { id: R, stats: { ...baseStats(classId), attackDamage, actions }, classId },
      { id: A, stats: baseStats("adventurer"), classId: "adventurer" },
    ],
    [
      { characterId: R, monsterIds: monsterSlot ? monsters.map((_, i) => i) : [] },
      { characterId: A, monsterIds: [] },
    ],
  );
  const at = new Map<CharacterId, Hex | null>([
    [R, CENTRE],
    [A, aAt],
  ]);
  return { ...state, characters: state.characters.map((c) => ({ ...c, position: at.get(c.id) ?? null })) };
}

function turn(state: GameState, characterId: CharacterId, ...plan: Plan) {
  const plans = new Map<CharacterId, Plan>(plan.length > 0 ? [[characterId, plan]] : []);
  const result = resolveTurn(state, characterId, plans);
  assert.deepEqual(applyEvents(state, result.events), result.newState, "replaying the events");
  return result;
}

const hp = (state: GameState) => state.monsters.map((m) => m.hp);
const cancelled = (events: readonly GameEvent[]) => events.flatMap((e) => (e.type === "planCancelled" ? [e.reason] : []));

// --- Range ---

test("a ranger shoots a monster 2 or 3 hexes away, for its attack damage", () => {
  for (const target of [up(2), up(3), downRight(3)]) {
    const { newState, events } = turn(game({ monsters: [target], attackDamage: 2 }), R, attack(target));
    assert.deepEqual(events[0], {
      type: "attacked",
      attacker: { kind: "character", id: R },
      target: { kind: "monster", id: 0 },
      damage: 2,
    });
    assert.deepEqual(hp(newState), [1]);
  }
});

test("a ranger can't shoot a monster next to it, nor one further than its range", () => {
  const close = turn(game({ monsters: [up(1)] }), R, attack(up(1)));
  assert.deepEqual(cancelled(close.events), ["too close"]);
  assert.deepEqual(hp(close.newState), [3]);
  const far = turn(game({ monsters: [up(4)] }), R, attack(up(4)));
  assert.deepEqual(cancelled(far.events), ["out of range"]);
  // A range upgrade adds 1 to the longest shot.
  const upgraded = game({ monsters: [up(4)] });
  const longer = { ...upgraded, characters: upgraded.characters.map((c) => (c.id === R ? { ...c, stats: { ...c.stats, range: 4 } } : c)) };
  assert.deepEqual(hp(turn(longer, R, attack(up(4))).newState), [2]);
});

test("other classes attack exactly as before: a monster next to them, and nothing further away", () => {
  assert.ok(!shoots(game({ monsters: [], ranger: false }).characters[0]!));
  const next = turn(game({ monsters: [up(1)], ranger: false }), R, attack(up(1)));
  assert.deepEqual(hp(next.newState), [2]);
  const further = turn(game({ monsters: [up(2)], ranger: false }), R, attack(up(2)));
  assert.deepEqual(cancelled(further.events), ["not a neighbour"]);
});

// --- Line of sight ---

test("living monsters block a shot; characters don't", () => {
  // A monster in front of another: the one behind has cover.
  const covered = turn(game({ monsters: [up(1), up(2)] }), R, attack(up(2)));
  assert.deepEqual(cancelled(covered.events), ["out of sight"]);
  // A dead monster gives no cover.
  const dead = game({ monsters: [up(1), up(2)] });
  const withDead = { ...dead, monsters: dead.monsters.map((m) => (m.id === 0 ? { ...m, hp: 0 } : m)) };
  assert.deepEqual(hp(turn(withDead, R, attack(up(2))).newState), [0, 2]);
  // An ally in front of the ranger doesn't block it.
  const pastAlly = turn(game({ monsters: [up(2)], aAt: up(1) }), R, attack(up(2)));
  assert.deepEqual(hp(pastAlly.newState), [2]);
});

test("walls and pillars block a shot", () => {
  const behindPillar = turn(game({ monsters: [down(3)] }), R, attack(down(3)));
  assert.deepEqual(cancelled(behindPillar.events), ["out of sight"]);
});

test("along a border a shot is only blocked when both hexes block it", () => {
  // Two hexes up and one to the right: the line runs along the border of the two hexes in between.
  const target = hex(CENTRE.q + 1, CENTRE.r - 2);
  const [border] = hexesBetween(CENTRE, target);
  assert.equal(border!.length, 2);
  const [one, other] = border!;
  // A monster on one of them: the shot still gets through.
  const grazing = game({ monsters: [target, one!] });
  assert.ok(inCharacterLineOfSight(grazing, CENTRE, target));
  assert.equal(hp(turn(grazing, R, attack(target)).newState)[0], 2);
  // Monsters on both: blocked.
  const blocked = game({ monsters: [target, one!, other!] });
  assert.deepEqual(cancelled(turn(blocked, R, attack(target)).events), ["out of sight"]);
  // An ally on one and a monster on the other: the ally doesn't block, so it gets through.
  const mixed = game({ monsters: [target, one!], aAt: other! });
  assert.equal(shotProblem(mixed, CENTRE, target, { shortest: 2, longest: 3 }), undefined);
});

// --- Targets a hex ---

test("a shot targets a hex: cancelled when no living monster stands there", () => {
  const empty = turn(game({ monsters: [up(3)] }), R, attack(up(2)));
  assert.deepEqual(cancelled(empty.events), ["target gone"]);
});

test("a shot is cancelled when the monster stepped next to the ranger first", () => {
  // The monster is 2 hexes away and acts first, in A's turn.
  const state = game({ monsters: [up(2)], aAt: fromOffset(0, 0) });
  const withSlot = { ...state, track: [{ characterId: A, monsterIds: [0] }, { characterId: R, monsterIds: [] }] };
  const plans = new Map<CharacterId, Plan>([[R, [attack(up(2))]]]);
  const preview = previewCycle(withSlot, [A, R], plans);
  // The monster moves next to the ranger: the shot at its old hex now passes it, and it blocks the view.
  assert.deepEqual(preview.cancellations.map((c) => c.reason), ["out of sight"]);
  // And a shot at its new hex, next to the ranger, would be too close.
  const after = resolveTurn(withSlot, A, new Map()).newState;
  assert.deepEqual(after.monsters[0]!.position, up(1));
  assert.deepEqual(cancelled(turn(after, R, attack(up(1))).events), ["too close"]);
});

// --- Follow-up plans ---

test("after a shot, the next plan starts with shots at the monster's hex", () => {
  const state = game({ monsters: [up(3)], actions: 2 });
  const { newState, events } = turn(state, R, attack(up(3)));
  // 2 hit points left, 1 damage a shot: two shots, at most its actions.
  assert.deepEqual(followUpPlan(newState, R, events), [attack(up(3)), attack(up(3))]);
  // With 2 damage a shot, one does.
  const strong = turn(game({ monsters: [up(3)], attackDamage: 2, actions: 2 }), R, attack(up(3)));
  assert.deepEqual(followUpPlan(strong.newState, R, strong.events), [attack(up(3))]);
});

test("a follow-up shot is cancelled like any shot, once the monster came too close", () => {
  const state = game({ monsters: [up(1)] });
  assert.deepEqual(cancelled(turn(state, R, attack(up(1))).events), ["too close"]);
});

// --- The server's check ---

test("the server refuses a shot at a hex outside the range, seen from where the plan places the ranger", () => {
  const state = game({ monsters: [up(2)], actions: 2 });
  assert.equal(planShotProblem(state, R, [attack(up(2))]), undefined);
  assert.equal(planShotProblem(state, R, [attack(up(3))]), undefined);
  // Even an empty hex out of sight is fine: that may change before the turn fires.
  assert.equal(planShotProblem(state, R, [attack(down(3))]), undefined);
  assert.equal(planShotProblem(state, R, [attack(up(1))]), "Attack can't be planned: the hex isn't 2 to 3 hexes away.");
  // A hex 10 hexes away: refused, though the client's menu never offers it.
  assert.equal(planShotProblem(state, R, [attack(hex(CENTRE.q, CENTRE.r - 10))]), "Attack can't be planned: the hex isn't 2 to 3 hexes away.");
  // After a move down, up 2 is 3 hexes away, and up 3 is 4.
  const move: PlannedAction = { type: "move", to: down(1) };
  assert.equal(planShotProblem(state, R, [move, attack(up(2))]), undefined);
  assert.equal(planShotProblem(state, R, [move, attack(up(3))]), "Attack can't be planned: the hex isn't 2 to 3 hexes away.");
  // Before it is on the map it can't shoot at all.
  const off = { ...state, characters: state.characters.map((c) => (c.id === R ? { ...c, position: null } : c)) };
  assert.equal(planShotProblem(off, R, [attack(up(2))]), "Attack can't be planned: the character isn't on the map yet.");
  // Other classes' attacks aren't checked here: they are cancelled when carried out.
  assert.equal(planShotProblem(game({ monsters: [], ranger: false }), R, [attack(up(5))]), undefined);
});
