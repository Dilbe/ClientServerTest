# Game design

What the game does for the player. How it is built belongs in
`architecture.md`.

## Vision

A co-op dungeon crawler for a small group of friends, also playable solo.
It starts very small on purpose and grows step by step, so early choices
should leave room for growth (see [Built to grow](#built-to-grow)).

- Played in the browser, and it **must work well on a phone**.
- **Deterministic: no randomness.** The same situation always plays out the
  same way. This is what makes it possible to preview what will happen.
- Progress comes from **XP, not gear**. There is no gear for now.

## Turns: the initiative track

The game is a cross between real time and turn based.

- An **initiative track** at the top of the screen shows every character
  (players and monsters) in turn order.
- Each player character gets one turn per **cycle of 60 seconds**. Player
  turns are spread evenly over the cycle: with 2 players, a player turn fires
  every 30 seconds. The player turns stay at this pace for the whole
  dungeon, because nobody can join after the game starts.
- **Each monster is linked to a player and acts directly after that player**,
  0 seconds later. The server resolves the player's action and the monster's
  action together in one step.
- Example with 2 players and 2 monsters:

  | Time | Acts |
  |---|---|
  | 30s | Player A, then directly Monster A |
  | 60s | Player B, then directly Monster B |
  | 90s | Player A, then directly Monster A |

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

## Dungeons

- The map is a grid of **hexagons**.
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

## Accounts

- Players **create an account with a username and password**. No email
  address: this keeps the personal data stored to a minimum.
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

- Accounts with username and password, one character per account.
- A lobby to form a party and start a game.
- One dungeon with one room on a hex grid, with monsters.
- The initiative track with 60-second cycles and monsters acting directly
  after their linked player.
- Planning with cancelled-if-invalid actions; doing nothing when no plan.
- Move 1, attack 1 (adjacent), 10 HP.
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

- **Linking monsters to players when the numbers differ.** With 1 player and
  3 monsters, do all 3 act after that player? With 3 players and 1 monster,
  does the monster act after only one of them? And which monster is linked to
  which player?
- **Move and attack in one turn?** Can a character both move 1 and attack in
  the same turn, or is it one action per turn?
- **When does the first turn fire?** At the start of the game or after one
  interval (the example above starts at 30s)?
- **How do monsters choose what to do?** Their behaviour must be
  deterministic, including tie-breaks (for example, two players equally
  close).
- **What does the client show when a turn resolves?** Only the end result, or
  each action one after another?
- **Sessions:** how players find each other and create or join a party. To be
  decided later.
