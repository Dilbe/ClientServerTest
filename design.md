# Game design

What the game does for the player. How it is built belongs in
`architecture.md`.

## Vision

A co-op dungeon crawler for a small group of friends, also playable solo.
It starts very small on purpose and grows step by step, so early choices
should leave room for growth (see [Built to grow](#built-to-grow)).

- Played in the browser, and it **must work well on a phone**.
- **Deterministic.** The only randomness is the initiative order, decided once
  at the start of a game. After that the same situation always plays out the
  same way, which is what makes it possible to preview what will happen.
- Progress comes from **XP, not gear**. There is no gear for now.

## Turns: the initiative track

The game is a cross between real time and turn based.

- An **initiative track** at the top of the screen shows every character
  (players and monsters) in turn order.
- Each player character gets one turn per **cycle of 60 seconds**. Player
  turns are spread evenly over the cycle: with 2 players, a player turn fires
  every 30 seconds.
- **The first turn fires 1 minute after the game starts**, so everyone gets a
  full cycle to plan their first action.
- **Each monster is linked to a player and acts directly after that player**,
  0 seconds later. The server resolves the player's action and the monster
  actions after it together in one step.
- Example with 2 players and 2 monsters:

  | Time | Acts |
  |---|---|
  | 30s | Player A, then directly Monster A |
  | 60s | Player B, then directly Monster B |
  | 90s | Player A, then directly Monster A |

### Setting up the track

This is the only randomness in the game, and it happens once, at the start.

- The **players are shuffled** into a random order on the track.
- The **monsters are spread over the players as evenly as possible**, at random.
  For example, with 2 players and 3 monsters, one random player is followed by
  2 monsters and the other player by 1. With 3 players and 1 monster, the
  monster follows one random player.

### When a player dies

- A dead player is **removed from the initiative track**.
- This **never makes anyone act more often**: every character still acts once
  per minute. The remaining players keep their turn times, so the dead player's
  slot leaves a gap in the cycle.
- The monsters that followed the dead player **move to the player before them**
  on the track (wrapping around: if the first player dies, the last one). They
  go after the monsters that player already had. This keeps the order in which
  everyone acts exactly the same; the only change is that those monsters may
  act sooner in time once.
  - Example: the track is A, monster 1, B, monster 2, C. When B dies, it becomes
    A, monster 1, monster 2, C.
  - The monsters may then no longer be spread evenly; that's accepted.

### Actions

- On its turn a character does **one action: move or attack**, not both.
- Later, something like a speed or initiative stat may give a character more
  than one action per turn.

### Showing what happens

- When a turn resolves, the client shows **each move and attack one by one,
  slowly enough to follow**.
- The exact look and pace are decided by trying them out.

### Planning

- Between their turns, players **plan** what their character will do. The
  plan is carried out when their turn fires.
- **A plan that can no longer be carried out is cancelled**: for example
  when the target has moved or died, or the destination is taken. Playtesting
  will show whether this works well.
- **No plan means the character does nothing** on its turn. This is also what
  happens when a player is offline or disconnected. The game does not pause.
- Players can **see each other's plans**.
- Players can **see what the monsters will do** given the current plans.
  Because the game is deterministic, this preview is exact; it shows new
  players what experienced players already know.

## Characters

- An account has characters. **For now each account has one character**; later
  an account can have several.
- Characters have **stats** (like movement and attack damage), **skills**, and
  gain **XP**, roughly like the stats and skills in the Demo-game project.
- First version: every character can **move 1 hex**, **attack for 1 damage**
  an adjacent enemy, and has **10 hit points**.
- There is **no permanent death**.

## Monsters

Monsters follow fixed rules, like the monsters in many board games, so
players can predict them.

- On its turn a monster **attacks its target if it is adjacent, and otherwise
  moves 1 hex towards it**.
- **Choosing a target** works through a list of rules, in order, until only one
  player is left:
  1. The closest player: the one the monster can reach in the **fewest turns**.
     Once rooms have blocked hexes (rocks and so on), this can mean a longer
     path around them. It stays the same for monsters with ranged attacks,
     although ranged monsters may get their own targeting rules.
  2. The player with the fewest hit points.
  3. The first player after the monster on the initiative track.
- **Choosing a route**: when several moves get the monster equally close to its
  target, it checks the directions **clockwise, starting at straight up**, and
  takes the first of those moves it finds. Monsters move 1 hex per turn
  and choose again every turn, so only this first step matters.
- **When a monster can't reach any player** (every path is blocked), it picks
  the closest player **ignoring obstacles**, counted in hexes in a straight
  line, with the same tie-break rules. It then moves 1 hex closer to that
  player, choosing between equally good moves the same way as above. If no
  free hex brings it closer, it **doesn't move**.
- **Different monsters can have different rules** for targeting and movement.
  The rules are defined as data per monster type, and the game **shows the
  player each monster's rules**.

## Dungeons

- The map is a grid of **hexagons** with a flat side at the top. (The
  monster rules work with either orientation.)
- **Only one character can stand on a hex.**
- A dungeon consists of rooms. **The first version has a single room.**
- **Winning:** all monsters are dead. **Losing:** all players are dead. At worst,
  losing means getting no XP.
- **Within a dungeon** everything carries over between rooms: current HP,
  cooldowns, and buffs with their remaining duration (if buffs are added).
- **Between dungeons** nothing carries over: every dungeon starts with all
  characters at full HP. Winning a dungeon gives rewards: XP and/or unlocks.

## Parties and the lobby

- Players form a party in a **lobby** before the game starts.
- **Nobody can join after the game has started**; for a different group,
  create a new game.
- **An account can be in only one running dungeon at a time**, so each
  character is also in at most one. (The intent is one dungeon per player;
  the account is how the game tells players apart.)

## Accounts

- Players **create an account with an account name, a password and a display
  name**. No email address: this keeps the personal data stored to a minimum.
- **The account name is only for logging in**; other players never see it.
- **Other players only see the display name.** Display names are unique, so
  nobody can pose as another player.
- No self-service password reset: the game is meant for people the owner
  knows, and the owner can reset an account by hand. Revisit if the game is
  ever shared publicly.

## Mobile

- Everything must be playable by **tapping**, without a keyboard: tap a hex to
  plan a move or an attack.
- Connections on a phone drop often (screen lock, switching apps). Reconnecting
  must be a normal part of playing, not an error.

## Built to grow

These choices cost little now and much later, so the first version already
follows them:

- **One account, many characters**: the stored data is "an account has
  characters", even though the UI allows only one.
- **One dungeon, many rooms**: a dungeon run is a separate idea from a room,
  even with one room.
- **Stats and skills are defined as data**: each one is a config entry (base
  value, effect, and later cost), so adding one mostly means adding data.
  Movement, attack damage and hit points are stats from the start.
- **The turn cycle length (60s) is a setting**, not a hard-coded rule.

## First version scope

- Accounts with account name, password and display name, one character per
  account.
- A lobby to form a party and start a game.
- One dungeon with one room on a hex grid, with monsters.
- The initiative track with 60-second cycles and monsters acting directly
  after their linked player.
- Planning with cancelled-if-invalid actions; doing nothing when no plan.
- One action per turn: move 1 or attack 1 (adjacent). 10 HP.
- One monster type, using the targeting and movement rules above.
- Win when all monsters are dead, lose when all players are dead.
- Playable on a phone.

## Later ideas (parking lot)

Not planned yet; written down so they aren't lost.

- **Turn settings per game**, chosen when the game is created (like Board Game
  Arena): for example the cycle length.
- **End-turn button**: turns end when the player presses a button instead of
  on a timer. Could be one of the turn settings.
- Handling disconnects or players who leave in a better way than "does
  nothing".
- Several characters per account; several rooms per dungeon.
- XP spending, stats, skills and unlocks (along the lines of Demo-game).
- Buffs with durations.
- Gear: not planned, the game is XP based. Possibly reconsidered later.
- Password reset by email, if the game is ever shared publicly.

## Open questions

- **Sessions:** how players find each other and create or join a party. To be
  decided later.
