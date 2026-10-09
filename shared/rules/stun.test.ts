import { test } from "node:test";
import assert from "node:assert/strict";
import {
  abilitiesOf,
  abilityProblem,
  abilityStats,
  planAbilityProblem,
  type AbilityId,
  type AbilityUpgradeCounts,
} from "./abilities.ts";
import type { DungeonMap } from "./dungeon-map.ts";
import { applyEvents } from "./events.ts";
import type { CharacterId, GameState, MonsterId } from "./game-state.ts";
import { fromOffset, neighbours, rectangle } from "./hex.ts";
import { previewCycle } from "./preview.ts";
import { baseStats } from "./stats.ts";
import { createTrack } from "./track.ts";
import { followUpPlan, newGameState, resolveTurn, type Plan, type PlannedAction } from "./turn.ts";

const A = 1;
const B = 2;


/** Where A stands: the middle of the room. */
const CENTRE = fromOffset(4, 4);
/** 2 hexes straight above A: close, but not next to it. */
const TWO_AWAY = fromOffset(4, 2);

/**
 * One room of 9 by 9 hexes. Monster 0 stands next to A, monster 1 two hexes
 * away, and monster 2 is a guard (on guard at the start), also next to A.
 */
const MAP: DungeonMap = {
  hexes: rectangle(9, 9),
  startHexes: [fromOffset(8, 8)],
  doors: [],
  monsters: [
    { type: "basic", position: neighbours(CENTRE)[3]! },
    { type: "basic", position: TWO_AWAY },
    { type: "guard", position: neighbours(CENTRE)[1]! },
  ],
};

/** Stun and attack monster 0, next to A. */
const stun0: PlannedAction = { type: "stun", target: MAP.monsters[0]!.position };
const attack0: PlannedAction = { type: "attack", target: MAP.monsters[0]!.position };

/**
 * A in the middle of the room, B off the map. A has every ability up to
 * stun unless `abilities` says otherwise. The monsters aren't on the track
 * unless `monstersOf` puts them there, so they never act.
 */
function game({
  abilities = ["heavyStrike", "charge", "cleave", "stun"],
  actions = 1,
  abilityUpgrades = {},
  monstersOf = new Map(),
}: {
  abilities?: readonly AbilityId[];
  actions?: number;
  abilityUpgrades?: AbilityUpgradeCounts;
  monstersOf?: ReadonlyMap<MonsterId, CharacterId>;
} = {}): GameState {
  const state = newGameState(
    MAP,
    [
      { id: A, stats: { ...baseStats(), actions }, abilities, abilityUpgrades },
      { id: B, stats: baseStats() },
    ],
    createTrack([A, B], monstersOf),
  );
  return {
    ...state,
    characters: state.characters.map((c) => (c.id === A ? { ...c, position: CENTRE } : c)),
  };
}

/** Resolves one turn of a character with the given plan, and checks that replaying the events gives the same state. */
function turn(state: GameState, characterId: CharacterId, ...plan: Plan) {
  const plans = new Map<CharacterId, Plan>(plan.length > 0 ? [[characterId, plan]] : []);
  const result = resolveTurn(state, characterId, plans);
  assert.deepEqual(applyEvents(state, result.events), result.newState, "replaying the events");
  return result;
}

function a(state: GameState) {
  return state.characters.find((c) => c.id === A)!;
}

function monster(state: GameState, id: MonsterId) {
  return state.monsters.find((m) => m.id === id)!;
}

/** Whether monster `id` did anything in these events. */
function acted(events: ReturnType<typeof turn>["events"], id: MonsterId): boolean {
  return events.some((e) => {
    const actor = e.type === "moved" ? e.actor : e.type === "attacked" ? e.attacker : undefined;
    return actor?.kind === "monster" && actor.id === id;
  });
}

// --- Who has it ---

test("adventurers get stun at rank 5", () => {
  assert.ok(!abilitiesOf("adventurer", 4).includes("stun"));
  assert.deepEqual(abilitiesOf("adventurer", 5), ["heavyStrike", "charge", "cleave", "stun"]);
});

test("the character page shows what stun does, and its cooldown with upgrades", () => {
  assert.deepEqual(abilityStats("stun", baseStats()), [
    { name: "Effect", value: "the monster skips its next turn" },
    { name: "Cooldown", value: "4 turns", upgrade: "cooldown" },
  ]);
  assert.deepEqual(abilityStats("stun", baseStats(), { stun: { cooldown: 3 } }).at(-1), {
    name: "Cooldown",
    value: "1 turn",
    upgrade: "cooldown",
  });
});

test("a rank 4 character can't stun", () => {
  const rank4 = game({ abilities: ["heavyStrike", "charge", "cleave"] });
  assert.equal(abilityProblem(a(rank4), "stun", []), "Needs a higher rank");
  assert.equal(planAbilityProblem(rank4, A, [stun0]), "Stun can't be planned: needs a higher rank.");
  // Sent anyway, the rules don't carry it out either.
  assert.deepEqual(turn(rank4, A, stun0).events, [
    { type: "planCancelled", characterId: A, action: 0, reason: "no ability" },
  ]);
});

// --- What it does ---

test("a stun does no damage, marks the monster as stunned and starts the cooldown", () => {
  const { newState, events } = turn(game(), A, stun0);
  assert.deepEqual(events, [
    { type: "stunned", characterId: A, monsterId: 0 },
    { type: "cooldownStarted", characterId: A, ability: "stun", turns: 4 },
  ]);
  assert.equal(monster(newState, 0).hp, monster(game(), 0).hp);
  assert.equal(monster(newState, 0).stunned, true);
});

test("a stunned monster that follows the stunning character skips the rest of that turn, then acts again", () => {
  const state = game({ monstersOf: new Map([[0, A]]) });
  // Without the stun, it attacks A.
  assert.ok(acted(turn(state, A).events, 0));

  const stunned = turn(state, A, stun0);
  assert.deepEqual(stunned.events.at(-1), { type: "turnSkipped", monsterId: 0 });
  assert.ok(!acted(stunned.events, 0));
  assert.equal(monster(stunned.newState, 0).stunned, false);

  // Its next turn it acts as usual.
  const after = turn(stunned.newState, A);
  assert.ok(acted(after.events, 0));
});

test("a stunned monster that follows another character skips its turn after that character", () => {
  const state = turn(game({ monstersOf: new Map([[0, B]]) }), A, stun0).newState;
  // B enters the room first: it isn't on the map yet.
  const { newState, events } = turn(state, B);
  assert.deepEqual(events.at(-1), { type: "turnSkipped", monsterId: 0 });
  assert.ok(!acted(events, 0));
  assert.ok(acted(turn(newState, B).events, 0));
});

test("stunned twice before its turn, a monster still skips only one turn", () => {
  let state = turn(game({ monstersOf: new Map([[0, B]]) }), A, stun0).newState;
  // As if a second character stunned it too: A's stun is ready again.
  state = { ...state, characters: state.characters.map((c) => (c.id === A ? { ...c, cooldowns: {} } : c)) };
  state = turn(state, A, stun0).newState;
  const skipped = turn(state, B);
  assert.equal(skipped.events.filter((e) => e.type === "turnSkipped").length, 1);
  assert.ok(acted(turn(skipped.newState, B).events, 0));
});

test("a stun only reaches a monster next to the character; otherwise it is cancelled without a cooldown", () => {
  const far = turn(game(), A, { type: "stun", target: TWO_AWAY });
  assert.deepEqual(far.events, [{ type: "planCancelled", characterId: A, action: 0, reason: "not a neighbour" }]);
  assert.deepEqual(a(far.newState).cooldowns, {});

  const state = game();
  const dead = { ...state, monsters: state.monsters.map((m) => (m.id === 0 ? { ...m, hp: 0 } : m)) };
  assert.deepEqual(turn(dead, A, stun0).events, [
    { type: "planCancelled", characterId: A, action: 0, reason: "target gone" },
  ]);
});

test("a stunned guard is alerted, and then skips its next turn", () => {
  const state = game({ monstersOf: new Map([[2, A]]) });
  assert.ok(monster(state, 2).asleep);
  const { newState, events } = turn(state, A, { type: "stun", target: MAP.monsters[2]!.position });
  assert.deepEqual(events, [
    { type: "stunned", characterId: A, monsterId: 2 },
    { type: "cooldownStarted", characterId: A, ability: "stun", turns: 4 },
    { type: "monstersWoke", monsterIds: [2] },
    { type: "turnSkipped", monsterId: 2 },
  ]);
  assert.ok(!monster(newState, 2).asleep && !monster(newState, 2).stunned);
});

// --- Planning ---

test("a plan holds at most one stun, next to a heavy strike", () => {
  const state = game({ actions: 3 });
  assert.equal(planAbilityProblem(state, A, [stun0, { type: "heavyStrike", target: MAP.monsters[0]!.position }]), undefined);
  assert.equal(planAbilityProblem(state, A, [stun0, stun0]), "Stun can't be planned: already planned.");
  assert.equal(abilityProblem(a(state), "stun", [stun0]), "Already planned");
});

// --- Cooldown ---

test("used on turn 1, stun can't be used on turns 2 to 5 and is ready on turn 6", () => {
  let state = game();
  const results: boolean[] = [];
  for (let i = 0; i < 7; i++) {
    const { newState, events } = turn(state, A, stun0);
    results.push(events.some((e) => e.type === "stunned"));
    state = newState;
  }
  assert.deepEqual(results, [true, false, false, false, false, true, false]);
});

test("a stun with cooldown upgrades starts the shorter cooldown", () => {
  const { events } = turn(game({ abilityUpgrades: { stun: { cooldown: 2 } } }), A, stun0);
  assert.deepEqual(events.find((e) => e.type === "cooldownStarted"), {
    type: "cooldownStarted",
    characterId: A,
    ability: "stun",
    turns: 2,
  });
});

// --- Follow-up plans ---

test("after a stun there is no follow-up plan, also when an attack came before it", () => {
  const { newState, events } = turn(game({ actions: 2 }), A, attack0, stun0);
  assert.equal(followUpPlan(newState, A, events), null);
});

// --- Preview ---

test("the preview matches what happens, and says the stunned monster skips its turn", () => {
  const state = game({ monstersOf: new Map([[0, B]]) });
  const plans = new Map<CharacterId, Plan>([[A, [stun0]]]);
  const preview = previewCycle(state, [A, B], plans);
  assert.deepEqual(preview.turns[0], { characterId: A, events: resolveTurn(state, A, plans).events });
  assert.deepEqual(preview.monsters.get(0), { type: "stunned", after: B });
  assert.deepEqual(preview.cancellations, []);
});
