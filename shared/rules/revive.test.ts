import { test } from "node:test";
import assert from "node:assert/strict";
import { abilitiesLine, abilitiesOf, abilityStats, planAbilityProblem } from "./abilities.ts";
import { baseStats } from "./classes.ts";
import type { DungeonMap } from "./dungeon-map.ts";
import { applyEvents } from "./events.ts";
import type { CharacterId, GameState, MonsterId } from "./game-state.ts";
import { fromOffset, hex, rectangle, type Hex } from "./hex.ts";
import { createTrack, returnCharacterToTrack } from "./track.ts";
import { followUpPlan, newGameState, resolveTurn, type Plan, type PlannedAction } from "./turn.ts";
import { abilityUpgradeCost, applyUpgrade, nextAbilityUpgradeCost, type Upgrade } from "./upgrades.ts";

const H = 1;
const A = 2;
const B = 3;
const CENTRE = fromOffset(4, 4);
const at = (dq: number, dr: number): Hex => hex(CENTRE.q + dq, CENTRE.r + dr);
const up = (steps: number) => at(0, -steps);
const down = (steps: number) => at(0, steps);

const revive = (target: CharacterId, h: Hex): PlannedAction => ({ type: "revive", target, hex: h });

/**
 * A rank 5 healer in the middle of a 9 by 9 room, with A dead (died right
 * below it) and B alive further up. Two monsters in the corners: monster 0
 * followed A, and moved to the healer when A died; monster 1 follows B.
 */
function game({ rank = 5, actions = 1 }: { rank?: number; actions?: number } = {}): GameState {
  const map: DungeonMap = {
    hexes: rectangle(9, 9),
    startHexes: [fromOffset(8, 0)],
    doors: [],
    monsters: [
      { type: "basic", position: fromOffset(0, 8) },
      { type: "basic", position: fromOffset(8, 8) },
    ],
  };
  const state = newGameState(
    map,
    [
      { id: H, stats: { ...baseStats("healer"), actions }, abilities: abilitiesOf("healer", rank), classId: "healer" },
      { id: A, stats: { ...baseStats("adventurer"), hitPoints: 9 }, abilities: abilitiesOf("adventurer", 3) },
      { id: B, stats: baseStats("adventurer") },
    ],
    createTrack([H, A, B], new Map<MonsterId, CharacterId>([[0, A], [1, B]])),
  );
  const positions: Record<CharacterId, Hex> = { [H]: CENTRE, [A]: down(1), [B]: up(3) };
  const placed = { ...state, characters: state.characters.map((c) => ({ ...c, position: positions[c.id]! })) };
  // A had used its charge, and protected B, when it died.
  const withHistory = {
    ...placed,
    characters: placed.characters.map((c) =>
      c.id === A ? { ...c, hp: 0, cooldowns: { charge: 2 }, renewTurns: 3, ward: { by: H, shield: 4 } } : c,
    ),
  };
  return applyEvents(withHistory, [{ type: "died", who: { kind: "character", id: A } }]);
}

/** The healer's turn, with only the healer's own events: monster 0 acts after it. */
function turn(state: GameState, ...plan: Plan) {
  const result = resolveTurn(state, H, new Map<CharacterId, Plan>([[H, plan]]));
  assert.deepEqual(applyEvents(state, result.events), result.newState, "replaying the events");
  const own = result.events.filter((e) => !("actor" in e && e.actor.kind === "monster"));
  return { ...result, events: own };
}

const of = (state: GameState, id: CharacterId) => state.characters.find((c) => c.id === id)!;

test("a rank 5 healer has revive, with 1 charge per game", () => {
  assert.deepEqual(abilitiesOf("healer", 5), ["healingTouch", "renew", "ward", "groupHeal", "revive"]);
  assert.deepEqual(abilityStats("revive", baseStats("healer")).map((r) => [r.name, r.value]), [
    ["Effect", "a dead character comes back next to the healer, with half its max hit points"],
    ["Charges", "1 per game"],
  ]);
  assert.equal(of(game(), H).spellCharges?.revive, 1);
});

test("revive brings a dead character back on a free hex next to the healer, with half its max hit points, rounded up", () => {
  const { events, newState } = turn(game(), revive(A, down(1)));
  assert.deepEqual(events, [
    { type: "revived", characterId: H, targetId: A, position: down(1), hp: 5 },
    { type: "chargeUsed", characterId: H, ability: "revive" },
  ]);
  assert.equal(of(newState, A).hp, 5);
  assert.deepEqual(of(newState, A).position, down(1));
  assert.equal(followUpPlan(newState, H, events), null);
});

test("it gets its old slot on the track back, and the monsters that moved when it died stay where they are", () => {
  assert.deepEqual(game().track, [
    { characterId: H, monsterIds: [0] },
    { characterId: B, monsterIds: [1] },
  ]);
  assert.deepEqual(turn(game(), revive(A, down(1))).newState.track, [
    { characterId: H, monsterIds: [0] },
    { characterId: A, monsterIds: [] },
    { characterId: B, monsterIds: [1] },
  ]);
  // The first character goes back to the front, the last one to the end.
  const track = [{ characterId: 2, monsterIds: [5, 6] }];
  assert.deepEqual(returnCharacterToTrack(track, [1, 2, 3], 1), [{ characterId: 1, monsterIds: [] }, ...track]);
  assert.deepEqual(returnCharacterToTrack(track, [1, 2, 3], 3), [...track, { characterId: 3, monsterIds: [] }]);
});

test("its cooldowns and charges are as they were; renew, ward and protect stayed lost", () => {
  const revived = of(turn(game(), revive(A, down(1))).newState, A);
  assert.deepEqual(revived.cooldowns, { charge: 2 });
  assert.equal(revived.renewTurns, 0);
  assert.equal(revived.ward, undefined);
  assert.equal(revived.protectedBy, undefined);
});

test("revive is cancelled when the hex is taken, or the character isn't dead any more, without using the charge", () => {
  const taken = game();
  taken.characters[2] = { ...taken.characters[2]!, position: down(1) };
  assert.deepEqual(turn(taken, revive(A, down(1))).events, [
    { type: "planCancelled", characterId: H, action: 0, reason: "hex taken" },
  ]);
  const alive = applyEvents(game(), [{ type: "revived", characterId: H, targetId: A, position: down(1), hp: 5 }]);
  const { events, newState } = turn(alive, revive(A, up(1)));
  assert.deepEqual(events, [{ type: "planCancelled", characterId: H, action: 0, reason: "not dead" }]);
  assert.equal(of(newState, H).spellCharges?.revive, 1);
  assert.deepEqual(turn(game(), revive(A, down(2))).events, [
    { type: "planCancelled", characterId: H, action: 0, reason: "not a neighbour" },
  ]);
});

test("the charge: once per game, unless upgraded once (50 points) for a second", () => {
  const used = turn(game(), revive(A, down(1))).newState;
  assert.equal(of(used, H).spellCharges?.revive, 0);
  assert.match(abilitiesLine(of(used, H), [])!, /Revive 0\/1$/);
  const deadAgain = applyEvents(used, [
    { type: "attacked", attacker: { kind: "monster", id: 1 }, target: { kind: "character", id: A }, damage: 5 },
    { type: "died", who: { kind: "character", id: A } },
  ]);
  assert.equal(planAbilityProblem(deadAgain, H, [revive(A, down(1))]), "Revive can't be planned: no charges left.");
  assert.deepEqual(turn(deadAgain, revive(A, down(1))).events, [
    { type: "planCancelled", characterId: H, action: 0, reason: "no charges" },
  ]);
  assert.equal(abilityUpgradeCost("revive", "charges", 1), 50);
  const once: Upgrade[] = [{ ability: "revive", upgrade: "charges", paid: 50 }];
  assert.equal(nextAbilityUpgradeCost(once, "revive", "charges"), undefined);
  const upgraded = applyUpgrade(deadAgain, H, "healer", { ability: "revive", upgrade: "charges" });
  assert.equal(planAbilityProblem(upgraded, H, [revive(A, down(1))]), undefined);
});

test("the server checks the rank, that the hex is next to the planned position, and that the character is dead", () => {
  assert.equal(planAbilityProblem(game(), H, [revive(A, down(1))]), undefined);
  // Taken now: that may change before the turn fires.
  assert.equal(planAbilityProblem(game(), H, [revive(A, up(1))]), undefined);
  assert.equal(planAbilityProblem(game(), H, [revive(A, down(2))]), "Revive can't be planned: the hex isn't next to the character.");
  assert.equal(
    planAbilityProblem(game({ actions: 2 }), H, [{ type: "move", to: down(1) }, revive(A, down(2))]),
    undefined,
  );
  assert.equal(planAbilityProblem(game(), H, [revive(B, down(1))]), "Revive can't be planned: that character isn't dead.");
  assert.equal(planAbilityProblem(game({ rank: 4 }), H, [revive(A, down(1))]), "Revive can't be planned: needs a higher rank.");
});

test("the revived character acts again on its own turns", () => {
  const revived = turn(game(), revive(A, down(1))).newState;
  const result = resolveTurn(revived, A, new Map([[A, [{ type: "move", to: down(2) }]]]));
  assert.deepEqual(of(result.newState, A).position, down(2));
});
