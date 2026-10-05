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
  every 30 seconds. In development the cycle is **10 seconds**, so testing
  doesn't mean a lot of waiting.
- **The first turn fires one full cycle after the game starts**, so everyone
  gets a full cycle to plan their first action.
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

- An action is **place, move, attack or open a door** (opening doors comes
  with issue #30).
- **Every character and monster has an actions stat**: the number of actions
  it does on its turn. It starts at **1** for everyone; higher values come
  later (for example from XP or from a monster type).
- **Place** is only possible, and only needed, for a character that isn't on
  the map yet (see [Entering the room](#entering-the-room)). **Placing uses
  one action**: with 2 actions, a character can enter the room and then
  move or attack in the same turn.
- **A character's actions are carried out in the order they were planned.**
  An action that can't be carried out is cancelled, and **the next action is
  still tried** on its own.
- When a character can't enter the room because no start hex is free, it
  does nothing else that turn.
- When the game is won halfway through a turn, nobody acts any more.

### Entering the room

- The monsters are already on the map when the game starts. **The players'
  characters are not**: each character's first action is **placing it on a
  free start hex** (see [Dungeons](#dungeons)).
- If two players plan the same start hex, the one who acts first gets it; the
  other placement is cancelled, as with any destination that is taken.
- **A character that has no placement planned when its first turn fires is placed
  on the first free start hex** (from the top), instead of doing nothing. That
  uses its first action. This
  way every character enters the room, even when its player is offline, and a
  game can always end.
- **When no start hex is free**, the character stays off the map and tries
  again on its next turn (with its plan, or by automatic placement). With few
  start hexes, players have to think about the order in which they enter.
- **Monsters never step on start hexes**, so start hexes can only be blocked by
  characters. Monsters can still attack a character on a start hex from next
  to it.

### Showing what happens

- When a turn resolves, the client shows **each move and attack one by one,
  slowly enough to follow**.
- The exact look and pace are decided by trying them out.

### Planning

- Between their turns, players **plan** what their character will do: **a
  list of actions, at most as many as its actions stat**. Each action is
  planned from where the actions before it leave the character. The plan is
  carried out when their turn fires.
- **An action that can no longer be carried out is cancelled**: for example
  when the target has moved or died, or the destination is taken. Playtesting
  will show whether this works well.
- **No plan means the character does nothing** on its turn (except for
  placement, see above). This is also what
  happens when a player is offline or disconnected. The game does not pause.
- Players can **see each other's plans**, updated live as they change them.
- Players can **see what the monsters will do** given the current plans.
  Because the game is deterministic, this preview is exact; it shows new
  players what experienced players already know.
- The same preview shows **which planned actions won't go through**, for
  every character: for example because another character will have stepped
  onto the hex first, or a monster will have moved there. The action is
  marked on the map and listed under it, with the reason.

## Characters

- An account has characters. **Every account starts with one**; more can be
  bought or won (see [Advancement](#advancement)).
- **Choosing characters**: in the lobby, each player chooses **1 to 3 of
  their characters** to bring into the game. Each chosen character gets its
  own turn on the initiative track, with its own linked monsters. Until
  then (issue #26), joining brings the character with the lowest number.
  The game itself refers to characters, not accounts.
- Every character has a **number within the account**: 1, 2, 3, ...
  **Numbers are never reused**: when characters are used up for a rank-up,
  the others keep their numbers and the new character gets the next one.
- **Every character has a name**, so a player can tell their builds apart
  at a glance. It isn't meant to make players attached to one character.
  - A new character is called **"<class> <number>"**, like "Adventurer 1".
  - The player can **rename** it on the character page, for example to
    "Runner" or "Tank 2". An empty name goes back to the default.
  - **Other players in the game see the name**, next to the player's display
    name: "Runner (Ann)". So names follow the same rules as display names:
    1 to 20 plain letters, digits, spaces, `_` or `-`.
  - Names **don't have to be unique**: telling them apart is up to the
    player.
- **There is no maximum number of characters per account.**
- Every character has a **class**, a **rank** and a **level**, and **stats**
  that can be upgraded (see [Advancement](#advancement)). Skills come later,
  roughly like the stats and skills in the Demo-game project.
- Base stats: every new character has **1 action** per turn, can **move 1
  hex**, **attacks for 1 damage** an adjacent enemy, and has **10 hit
  points**.
- There is **no permanent death**, and **characters can't be deleted**.

### The character page

A separate screen, opened from the lobby, that lists the player's characters.

- Each character shows its name (with an edit button), class, rank, level,
  XP (towards the next level), stats and unspent upgrade points.
- Actions on the page: **rename**, **buy an adventurer**, **upgrade a
  stat**, **reset upgrades** and **rank up** (see
  [Advancement](#advancement)).
- **These actions are only possible while the account isn't in a game**,
  open or running. The page can still be viewed.
- On a phone: one column, one card per character.

## Monsters

Monsters follow fixed rules, like the monsters in many board games, so
players can predict them.

- For each of its actions (its actions stat), a monster **attacks its target if
  it is adjacent, and otherwise moves 1 hex towards it**. It **chooses its
  target again for every action**, so with 2 actions it can step next to a
  player and then attack.
- Monsters only consider players whose character **is on the map**. While no
  character has been placed, monsters don't move.
- **Choosing a target** works through a list of rules, in order, until only one
  player is left:
  1. The closest player: the one the monster can reach in the **fewest turns**.
     Once maps have walls or blocked hexes (rocks and so on), this can mean a longer
     path around them. It stays the same for monsters with ranged attacks,
     although ranged monsters may get their own targeting rules.
  2. The player with the fewest hit points.
  3. The first player after the monster on the initiative track.
- **Other characters and monsters block the way** just like walls: a monster
  can't walk through them, so a path counts as blocked when they stand in it.
- **Choosing a route**: when several moves get the monster equally close to its
  target, it checks the directions **clockwise, starting at straight up**, and
  takes the first of those moves it finds. Monsters move 1 hex per action
  and choose again every action, so only this first step matters.
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
- **A dungeon is one connected map** of any shape: walls are simply hexes that
  aren't part of the map. **Rooms are named areas** of that map, joined by
  open passages or by doors. **The first version has a single room.**
- Each dungeon is defined as data, with these **dungeon stats**:
  - its name and its map;
  - its **start hexes**, where players may place their characters;
  - its **monsters with their positions**: the same dungeon always starts with
    the same monsters in the same places;
  - its **max characters**;
  - its **silver reward** and its **one-time rewards** (see
    [Rewards](#rewards)).
- **Winning:** all monsters in the dungeon are dead, including monsters that
  never woke up. **Losing:** all players are dead. Losing means no silver; the
  XP from kills is kept.
- **Between dungeons** nothing carries over: every dungeon starts with all
  characters at full HP.

### The end of a game

- **The game ends the moment it is won or lost**: nobody acts any more, and
  plans can no longer be set.
- **Every player sees a win or loss screen** once the playback reaches the
  end, with a button **back to the lobby**. A player who was offline when it
  ended sees the result when they come back.
- **Going back to the lobby frees the account** at once, to create or join a
  new game, even while others are still looking at the result. **The game is
  removed** when the last player has gone back.
- **The result screen shows the rewards**: the XP each character gained,
  and the silver every player earned (see [Rewards](#rewards)).

### Doors and sleeping rooms

Comes with issue #30.

- A **closed door** is a hex that blocks movement. An **open door** is a
  normal hex.
- **Opening a door is an action** of a character next to it. Monsters never
  open doors.
- Monsters in a room behind a closed door are **asleep**: they are on the
  initiative track from the start, but skip their turns until a door into
  their room is opened.
- Sleeping monsters are **visible**, and **greyed out** on the map and on the
  initiative track, so it's clear they won't act yet.

### The dungeons

All hex sizes are width by height. With flat-topped hexes, a rectangle has
straight left and right edges; every other column is shifted half a hex down,
so the top and bottom zigzag a little.

- **The first dungeon** (first version): one room of **6 by 4**.
  - The **start hexes** are the 4 hexes of the left column.
  - **2 monsters** stand in the right column, on its two middle hexes.
  - At most 4 characters; 10 silver.
- **The second dungeon**: one room of **6 by 8**.
  - The **start hexes** are the middle 4 hexes of the left column.
  - **4 monsters** are spread over the right column: on its top and bottom
    hexes, and two hexes in from each end.
  - At most 4 characters; 20 silver.
- **The hallway** (issues #29 and #30): a hallway of **2 by 3** opening onto a
  room of **4 by 6** without a door, so its 2 monsters are visible and act from
  the first turn. Only the **2 far hexes of the hallway** are start hexes. A
  door in the middle of the room's far wall leads to a second **4 by 6** room
  with 2 more monsters, asleep until the door opens. At most 4 characters;
  30 silver.

## Rewards

Built with issue #27. What XP and silver are used for is
described in [Advancement](#advancement).

- **XP for kills**: each monster type has an XP value. When a monster dies,
  **every character in the game** gains that XP: alive or dead, placed or not.
- **A character at its max level gains no more XP** (see
  [Levels](#levels)): XP beyond what the max level needs is lost.
- **XP is kept whether the dungeon is won or lost.**
- **Silver for winning**: each dungeon has a silver reward. When it is won,
  **every player** gets that silver once, on their account (not per
  character).
- **Shown to the player**: the XP gained when a monster dies (in the
  playback), each character's XP gained and the silver earned on the result
  screen, and the player's silver total next to their display name.
- **One-time rewards** (issue #31): each dungeon has a list of rewards that a
  player only gets on their **very first win** of that dungeon (per player, not
  per character). The list is a dungeon stat and can hold several rewards of
  different types. For now every dungeon's one-time reward is **a new
  character**: a level 1, rank 1 adventurer.
  - In a party, each player gets them on their own first win: a player who
    won the dungeon before only gets the silver.
  - Losing doesn't count as a win.
  - The lobby shows, for the chosen dungeon, whether the player has won it
    before and what its one-time rewards are; the dungeon list marks the
    dungeons they have won. The result screen lists the one-time rewards
    the player received.
- Starting values, all data: 5 XP per monster of the first type. The silver
  reward is a dungeon stat (see [The dungeons](#the-dungeons)).

## Advancement

Characters grow by gaining levels, which give upgrade points to spend on
stats. This is a first version to playtest with adventurers only: if it
isn't fun or is too grindy, the whole system may change.

### Levels

- Every character starts at **level 1**. Going from level *L* to *L* + 1 takes
  **10 × *L* XP**: 10 XP from level 1 to 2, 20 more from 2 to 3, 30 more from
  3 to 4.
- **The character keeps its total XP; the level follows from it.** XP left
  over after a level counts towards the next one. Reaching level *L* takes
  5 × *L* × (*L* − 1) XP in total:

  | Level | 2 | 3 | 4 | 5 | 10 | 20 | 50 |
  |---|---|---|---|---|---|---|---|
  | XP from the level before | 10 | 20 | 30 | 40 | 90 | 190 | 490 |
  | Total XP | 10 | 30 | 60 | 100 | 450 | 1,900 | 12,250 |

- **Max level = rank × 10.** A character at its max level gains no more XP.

### Upgrade points

- **Reaching level *L* gives *L* upgrade points**: 2 at level 2, 3 at level 3,
  and so on. A level 10 character has earned 2 + 3 + ... + 10 = 54 points.
- Upgrade points are spent on **stat upgrades**: each upgrade adds **1** to
  one stat. Skills come later.
- **Each stat has an upgrade cost** given by two values, both data: its
  **first upgrade cost** and its **cost exponent**. The *n*-th upgrade of a
  stat costs *first upgrade cost* × *n*<sup>*cost exponent*</sup>, rounded
  up. With an exponent of 0 every upgrade costs the same; with 1 the cost
  rises in equal steps; with 2 it rises faster and faster.
- **Upgrades are permanent.** The only way back is resetting all upgrades
  (below).
- **A change to the upgrade costs only affects later upgrades**: upgrades
  already bought keep what was paid for them. If a balance change ever
  leaves a character with more points spent than it has earned, its upgrades
  are reset for free, without losing a level.
- For now, points are only spent on the character page, outside a game.
  Spending them during a game comes later.
- Starting values, all data (next to the base stats), so they're easy to
  change for balance:

  | Stat | First upgrade cost | Cost exponent | Costs of the first upgrades |
  |---|---|---|---|
  | Hit points | 1 | 1 | 1, 2, 3, 4, ... |
  | Attack damage | 5 | 1.5 | 5, 15, 26, 40, ... |
  | Movement | 5 | 1.5 | 5, 15, 26, 40, ... |
  | Actions | 20 | 2 | 20, 80, 180, ... |

### Resetting upgrades

- A character of level 2 or higher can **reset all its upgrades**. It then:
  - **loses one level**: its XP goes back to the total needed for the level
    below, so XP towards the next level is lost too;
  - **loses all its upgrades**;
  - has the upgrade points of its new level to spend again.
- Example: a level 5 character with 120 XP resets. It is now level 4 with
  60 XP, no upgrades, and 2 + 3 + 4 = 9 upgrade points.

### Class and rank

- Every character has a **class**. For now there is one: **adventurer**.
- Every character has a **rank**, from **1 to 5**. The rank sets the max level
  (rank × 10), so the highest max level is 50.
- **Ranking up**: **two adventurers of the same rank, both at their max
  level**, are used up to make **one adventurer of the next rank**. The new
  adventurer starts at **level 1 with 0 XP and no upgrades**, and gets the
  next character number.
- Later, classes such as **healer** or **tank** may be made from **two rank 5
  adventurers** in a similar way. That waits until advancement has been playtested with
  adventurers.

### Getting more characters

- Every account starts with **one level 1, rank 1 adventurer**.
- **Buying**: a level 1, rank 1 adventurer costs **10 silver for every
  character the player has**: the second costs 10, the third 20, and so on.
  Characters used up for a rank-up no longer count.
- **Winning** a dungeon for the first time gives one (see
  [Rewards](#rewards)).

## Parties and the lobby

- Players form a party in a **lobby** before the game starts.
- **The lobby lists the open games** (not started yet) with their players,
  and updates live. Any logged-in player can **create** a game, or **join** or
  **leave** an open one.
- **The player who created the game starts it**, also when playing solo. If
  they leave before the start, the next player who joined takes over; the
  last player to leave removes the game.
- **The host chooses the dungeon**; everyone sees the choice live. A new game
  starts with the first dungeon.
- **A game has at most as many characters as the dungeon allows** (4 for every
  dungeon so far), for example two players with 2 characters each. The host
  can't choose a dungeon the party is already too big for.
- **Nobody can join after the game has started**; for a different group,
  create a new game. A started game disappears from the list.
- **An account can be in only one game at a time**, open or running, so each
  character is also in at most one. (The intent is one dungeon per player;
  the account is how the game tells players apart.)
- **Disconnecting doesn't leave the game.** The others see the player as
  offline until they're back.
- Invite codes or private games may come later, if the open list isn't enough.

## Accounts

- Players **create an account with an account name, a password and a display
  name**. No email address: this keeps the personal data stored to a minimum.
- **The account name is only for logging in**; other players never see it.
- **Other players only see the display name** (and, in a game, the names of
  the player's characters). Display names are unique, so nobody can pose as
  another player.
- **A player can change their display name once.**
- No self-service password reset: the game is meant for people the owner
  knows, and the owner can reset an account by hand. Revisit if the game is
  ever shared publicly.
- **The home page and the sign-up page say the game is meant only for people
  the owner knows.**
- **A "what we store" page** lists the personal data the game stores, why, for
  how long, and how to contact the owner (a dedicated email address). It is
  linked from the login and sign-up pages.
- **A player can mark their account for deletion** (confirmed with their
  password). It isn't deleted at once: until it is, they can change their
  mind and cancel. The owner deletes marked accounts by hand for now, within a
  month (the GDPR deadline); this may be automated later.
- **A copy of their data** can be requested by email.

## Mobile

- Everything must be playable by **tapping**, without a keyboard: tap a hex to
  plan a placement, a move or an attack.
- Connections on a phone drop often (screen lock, switching apps). Reconnecting
  must be a normal part of playing, not an error.

## Built to grow

These choices cost little now and much later, so the first version already
follows them:

- **One account, many characters**: the stored data is "an account has
  characters", even though the UI allows only one.
- **One dungeon, many rooms**: a dungeon is one map, and rooms are areas of
  it, even with one room.
- **Dungeons are data**: map, start hexes, monsters and dungeon stats, so a new
  dungeon mostly means adding data.
- **Stats and skills are defined as data**: each one is a config entry (base
  value, effect, upgrade cost), so adding one mostly means adding data.
  Actions, movement, attack damage and hit points are stats from the start.
- **The turn cycle length (60s, 10s in development) is a setting**, not a
  hard-coded rule.

## First version scope

- Accounts with account name, password and display name, one character per
  account.
- The "meant only for people the owner knows" notice, the "what we store"
  page, and marking an account for deletion.
- A lobby to form a party of up to 4 characters and start a game.
- One dungeon with one 6 by 4 room on a hex grid, with 2 monsters in fixed
  places and 4 start hexes.
- The initiative track with 60-second cycles (10 seconds in development) and
  monsters acting directly after their linked player.
- Planning with cancelled-if-invalid actions; doing nothing when no plan;
  automatic placement when there is no placement plan.
- One action per turn (the actions stat is 1): place, move 1 or attack 1
  (adjacent). 10 HP.
- One monster type, using the targeting and movement rules above.
- Win when all monsters are dead, lose when all players are dead. No rewards
  yet.
- Playable on a phone.

## Later ideas (parking lot)

Not planned yet; written down so they aren't lost.

- **Turn settings per game**, chosen when the game is created (like Board Game
  Arena): for example the cycle length.
- **End-turn button**: turns end when the player presses a button instead of
  on a timer. Could be one of the turn settings.
- Handling disconnects or players who leave in a better way than "does
  nothing".
- What silver is used for; unlocks as rewards.
- XP spending, stats, skills and unlocks (along the lines of Demo-game).
- Buffs with durations.
- Gear: not planned, the game is XP based. Possibly reconsidered later.
- Password reset by email, if the game is ever shared publicly.
- Other classes (healer, tank, ...) made from two rank 5 adventurers, after
  advancement has been playtested.
- Spending upgrade points during a game.

## Open questions

- Is advancement fun, or too grindy? Playtest with adventurers before adding
  classes; the numbers are all data and easy to change.
