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
- Every player character's chip shows its **planned actions against its
  actions stat**, for example `0/1`, `1/2` or `2/2`, for everyone's
  characters: plans are visible to everyone anyway.
- The player's **own chips show at a glance which characters still need a
  plan**, with the count as well, so colour is never the only signal:
  - **Still needs an action** (fewer planned actions than its actions
    stat): strong blue with a **double border**.
  - **Fully planned**: pale, faded blue with a normal border.

  Other players' chips keep their own colours.
- A character that isn't on the map yet says so in its chip: **`(not
  entered)`**. Text instead of a border style, so it also works on a phone
  and leaves the border free for the plan status.
- Each player character gets one turn per **cycle**. Player turns are spread
  evenly over the cycle: with a 60-second cycle and 2 players, a player turn
  fires every 30 seconds.
- **The cycle length is the game's turn duration**, chosen when the game is
  created (see Parties and the lobby) and fixed for the whole game:

  | Turn duration | Cycle |
  |---|---|
  | Quick | 10 seconds |
  | Normal (the default) | 30 seconds |
  | Slow | 60 seconds |
  | Crawl | 5 minutes |

  Quick is also handy for testing, so it doesn't mean a lot of waiting.
- **The first turn fires one full cycle after the game starts**, so everyone
  gets a full cycle to plan their first action.
- **Each monster is linked to a player and acts directly after that player**,
  0 seconds later. The server resolves the player's action and the monster
  actions after it together in one step.
- Example with a 60-second cycle, 2 players and 2 monsters:

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
  per cycle. The remaining players keep their turn times, so the dead player's
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

- An action is **place, move, attack or open a door** (see
  [Doors and sleeping rooms](#doors-and-sleeping-rooms)).
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
- A plan is built by **tapping highlighted hexes**: each tap adds an action,
  and when the plan is full a tap replaces its last action. **Undo** takes the
  last action back, **Clear plan** removes the whole plan.
- With more than one own character, the player **chooses which one to plan
  for** by tapping its chip on the initiative track, or **its token on the
  map**. The selected character is marked on both. Only characters on the
  map can be tapped there, not their planned positions: a planned placement
  can sit on a start hex that another unplaced character could still take,
  so unplaced characters are chosen on the track. Tapping other players'
  characters does nothing.
- **A monster can be attacked more than once in a turn**: tapping a monster
  the plan already attacks adds another attack while the plan has room. When
  the plan is full and ends with attacks on that monster, tapping it removes
  those last attacks; earlier attacks on it (before a move, for example) stay.
- **An action that can no longer be carried out is cancelled**: for example
  when the target has moved or died, or the destination is taken. Playtesting
  will show whether this works well.
- **No plan means the character does nothing** on its turn (except for
  placement and a follow-up plan, see above and below). This is also what
  happens when a player is offline or disconnected. The game does not pause.
- Players can **see each other's plans**, updated live as they change them.

### Keeping a monster targeted

Comes with issue #72.

- When the **last action a character carried out** on its turn was an
  **attack on a monster that is still alive**, its next plan starts out
  **filled with attacks on that monster**: as many as it takes to kill the
  monster at the character's attack damage, but no more than its actions
  stat. A character with 1 action and the base damage simply attacks again.
- Cancelled actions don't count: a plan of "attack, then move" whose move
  is cancelled still ends with the attack. An attack that was itself
  cancelled doesn't count either.
- The follow-up plan is a **normal plan**: everyone sees it, it shows in the
  preview, and the player can change, undo or clear it before the turn
  fires. If the monster moves away or dies in the meantime, the attacks are
  cancelled like any other attack.
- A character that died in the turn, or whose last action was a move or a
  placement, gets no follow-up plan: it does nothing next turn unless its
  player plans something.
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
  own turn on the initiative track, with its own linked monsters. A player
  can change the choice until the game starts. Everyone in the lobby sees
  each player's chosen characters, by name, under the player's display name.
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
  it can, and otherwise moves 1 hex towards it**. It can attack a target
  within its **range**: next to it for most monsters (range 1), or further
  away and in line of sight for monsters with a ranged attack (see
  [Ranged attacks](#ranged-attacks)). It **chooses its target again for every
  action**, so with 2 actions it can step next to a player and then attack.
- Monsters only consider players whose character **is on the map**. While no
  character has been placed, monsters don't move.
- **Choosing a target** works through a list of rules, in order, until only one
  player is left:
  1. The closest player: the one the monster can reach in the **fewest turns**.
     Once maps have walls or blocked hexes (rocks and so on), this can mean a longer
     path around them. It stays the same for monsters with ranged attacks:
     they too count the turns to get next to a player. Ranged monsters first
     use their own targeting rules, though (see [Ranged attacks](#ranged-attacks)).
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
- **The map and the initiative track show each monster's type** with a
  letter in front of its number: **M3** is monster 3 of the first type,
  **R3** a rat. The log and the preview use the full name, like "Rat 3".

### Monster types

All data, so a new type mostly means adding an entry.

| Type | Label | Hit points | Attack damage | Actions | Range | XP | Alert range | Targeting |
|---|---|---|---|---|---|---|---|---|
| Monster (the first type) | M | 3 | 1 | 1 | 1 | 5 | none | the rules above |
| **Rat** (issue #83) | R | 3 | 1 | **2** | 1 | 2 | none | the rules above |
| **Guard** (issue #84) | G | **15** | **2** | 1 | 1 | 8 | **3** | the rules above |
| **Archer** (issue #85) | A | **5** | 1 | 1 | **3** | 6 | none | **ranged** |
| **Brute** (issue #85) | B | **20** | **3** | 1 | 1 | 10 | none | the rules above |

- The **rat** is fast and weak: the first monster type with 2 actions, so it
  can step next to a character and attack it in the same turn.
- The **guard** is strong but patient: it waits at its post until a character
  comes close (see [Guards and alert range](#guards-and-alert-range)), so
  players can take guards on one at a time.
- The **archer** is weak, but shoots from up to 3 hexes away at whoever it
  can see (see [Ranged attacks](#ranged-attacks)).
- The **brute** is slow to kill and hits hard: it keeps the players away from
  the archers behind it.

### Ranged attacks

Built with issue #85.

- **Range** is a monster stat: how far away, in hexes in a straight line, the
  monster can attack. **Range 1 is next to it**, as for every monster before
  the archer. Beyond range 1 the target must also be in **line of sight**
  (see below). Characters have no range stat yet: they attack next to them.
- **Targeting rules are data per monster type.** Most monsters use the rules
  above. A monster with **ranged targeting** does this for each action:
  1. If one or more players are **within its range and in line of sight**, it
     **shoots** one of them, without moving. Of those players it chooses the
     one with the **fewest hit points**, then the **first after the monster on
     the initiative track**.
  2. Otherwise, it **moves 1 hex** as the normal rules say: towards the target
     the normal rules choose, even if that player is out of its sight.
- So an archer that can see anyone shoots, even a player right next to it,
  and it shoots the weakest player it can see rather than the closest.
- **The preview shows ranged attacks** like other attacks, with a dashed
  line across the hexes in between, and says the monster "shoots".
- **Tapping a monster with a ranged attack highlights the hexes it can hit
  right now**: within its range and in line of sight from where it stands.
  Tapping it again, or anywhere that doesn't plan anything, hides them.

#### Line of sight

- A target is **in line of sight** when the straight line from the centre of
  the monster's hex to the centre of the target's hex passes **no wall, no
  pillar, no closed door and no character** (a living one). **Monsters don't
  block it**, so archers can shoot past the brutes that protect them. The
  hexes at both ends don't count: the shooter and the target stand there.
  Neighbours always see each other.
- **Pillars and other characters give cover**: stand behind one, seen from
  the archer, and it can't shoot you.
- **The edge case**: sometimes the line runs **exactly along the border
  between two hexes**. It is then **blocked only if both of those hexes
  block it**. A line that just grazes a pillar or the wall at the edge of a
  room still gets through. The rule is fixed, so the result is always the
  same, and it works both ways: if a monster can see a character, the
  character's hex can see the monster's too.
- How it is worked out: the line is walked in as many equal steps as the two
  hexes are apart, and each point is rounded to the hex it lies in. A point
  exactly on a border is rounded both ways, which gives the two hexes of the
  edge case.

### Guards and alert range

Built with issue #84. How a monster wakes up is a rule per monster type, next
to the door rule of [Doors and sleeping rooms](#doors-and-sleeping-rooms).

- A monster type can have an **alert range** of *N* hexes. A monster of such
  a type starts **on guard**: it is on the initiative track, but skips its
  turns until it is alerted.
- It is alerted when **a character is within *N* hexes** in a straight line
  (walls, pillars and closed doors don't matter), checked **at the start of
  the monster's turn**, or **when it is attacked**, right after the attack.
  An alerted monster that follows the character whose turn it is acts in that
  same turn.
- Once alerted, it **stays awake for the rest of the game**, even if every
  character walks away.
- **Doors don't wake a monster on guard**: in a room behind a door that is
  opened, it keeps waiting for a character to come close.
- Monsters without an alert range are awake from the start, unless they are
  in a room behind a closed door.
- A monster on guard is **greyed out**, like a sleeping monster, with "(on
  guard)" on its chip on the initiative track. **Tapping it shows its alert
  range**: the hexes within range are highlighted; tapping it again, or
  anywhere that doesn't plan anything, hides them.

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

Built with issue #30.

- A **closed door** is a hex that blocks movement, for characters and
  monsters alike. An **open door** is a normal hex. A door never closes again.
- **Opening a door is an action** of a character next to it: **tapping a
  closed door** next to the character plans it. Monsters never open doors.
  Opening a door that is already open (for example by another character
  earlier in the cycle) is cancelled, like any action that can't be carried
  out.
- A **room** is everything that can be reached without passing a closed door.
  Monsters in a room behind a closed door (not in the room of the start
  hexes) are **asleep**: they are on the initiative track from the start, but
  skip their turns until a door into their room is opened. Then they **all
  wake up at once**; a woken monster that follows the character who opened
  the door acts in that same turn.
- Sleeping monsters are **visible**, and **greyed out** on the map and on the
  initiative track, so it's clear they won't act yet.
- **Winning needs all monsters dead**, including ones that never woke.

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
- **The hallway** (issues #29 and #30): a hallway of **2 by 3** below the
  middle of a room of **4 by 6**, opening onto it without a door, so its 2
  monsters are visible and act from the first turn. They stand on the two
  middle hexes of the room's top row. Only the **2 far (bottom) hexes of the
  hallway** are start hexes. A door in the middle of the room's far (top) wall
  leads to a second **4 by 6** room with 2 more monsters on the two middle
  hexes of its top row, asleep until the door opens (issue #30). With an even
  number of columns there is no single middle hex: the door sits in the
  second column, which is shifted half a hex down, so it touches 3 hexes of
  the first room and 1 of the second. At most 4 characters; 30 silver.
- **The Rat Warren** (issue #83): three rooms of **4 by 4** in a row, joined
  by open passages **one hex wide** (no doors), so every rat is awake from
  the start. Each passage touches the middle two hexes of the rooms' sides.
  - The **start hexes** are **3 hexes in the top left corner** of the first
    room. The corner hex itself only touches the other two start hexes, so a
    character there can't be attacked, but can't attack anyone either.
  - **8 rats**: 2 in the far corner of the first room and 3 in each of the
    other rooms.
  - At most 4 characters; 25 silver.
- **The Guard Post** (issue #84): one room of **10 by 6** with **pillars**:
  4 hexes inside the room that aren't part of the map, so they block the way
  like any wall. Monsters walk around them along the shortest way.
  - The **start hexes** are the middle 4 hexes of the left edge.
  - **3 guards** spread over the room, each with **1 or 2 rats** next to it:
    a guard with 1 rat near the start hexes at the top, a guard with 2 rats at
    the bottom in the middle, and a guard with 2 rats at the far end at the
    top. The rats are awake from the start.
  - Every guard is at least 4 hexes from every start hex, so entering the
    room doesn't alert one, and at least 5 hexes from the other guards, so a
    character next to one guard is out of the others' alert range.
  - At most 4 characters; 35 silver.
- **The Archers' Gallery** (issue #85): a **hallway of 2 by 3** leading up
  into the middle of a wide room of **10 by 6**, with a door to a small side
  room of **3 by 3** on the right.
  - The **start hexes** are the bottom 4 hexes of the hallway.
  - **4 archers** stand along the back (top) wall, and **2 brutes** in front
    of them, in the middle. Every start hex is out of the archers' range, so
    entering is safe; after that they come closer to shoot.
  - **4 pillars**, two pairs a little in front of the archers, left and right
    of the way up from the hallway, give cover.
  - The **door** is in the room's right wall, a little above the middle.
    Behind it, **3 rats** sleep in the side room until the door opens.
  - At most 4 characters; 50 silver.

### Difficulties

Every dungeon can be played on several **difficulties**. A harder difficulty
uses the same map, start hexes and monsters, but makes the monsters stronger
and worth more XP. Difficulties are data: a name and multipliers each.

| Difficulty | Monster actions | Monster attack damage | Monster hit points | Monster XP |
|---|---|---|---|---|
| Normal | × 1 | × 1 | × 1 | × 1 |
| Hard | × 2 | × 2 | × 3 | × 3 |
| Heroic | × 3 | × 3 | × 5 | × 5 |

- Everything else stays the same on every difficulty: range, alert range,
  targeting rules, max characters and the silver reward.
- The names and numbers are a first version, to balance by playtesting.

### Unlocking dungeons

The dungeons are cleared **one by one, in a fixed order**, the same for every
player: the order of the list in [The dungeons](#the-dungeons). Progress is
**per player** (on the account), not per character.

- A dungeon is **cleared** on a difficulty when the player has won it on
  that difficulty.
- **On a difficulty, a player can play** every dungeon they have cleared on
  it, plus **the first dungeon in the list they haven't cleared** on it yet.
  Replaying cleared dungeons is allowed; it just gives less XP (see
  [Diminishing returns](#diminishing-returns)).
- **A difficulty is unlocked** when the player has cleared **every dungeon**
  on the difficulty before it, **or has already cleared any dungeon on it**.
  Normal is always unlocked.
- Nothing about unlocks is stored apart from the wins: the game works it out
  from which dungeons the player has won on which difficulty. So **a new
  dungeon added to the end of the list** simply becomes the next one to clear
  on every difficulty, and the second rule keeps a difficulty that was
  already reached from locking again.
- Wins from before difficulties existed count as **cleared on Normal**.
- **In a party, only the host's progress counts** (see
  [Parties and the lobby](#parties-and-the-lobby)).

## Rewards

Built with issue #27. What XP and silver are used for is
described in [Advancement](#advancement).

- **XP for kills**: each monster type has an XP value, multiplied by the
  difficulty's XP multiplier (see [Difficulties](#difficulties)). When a
  monster dies, **every character in the game** gains that XP: alive or
  dead, placed or not. Killing the same monster again gives less (see
  [Diminishing returns](#diminishing-returns)).
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
  player only gets on their **very first win** of that dungeon **on each
  difficulty** (per player, not per character). The list is a dungeon stat
  and can hold several rewards of different types. For now every dungeon's
  one-time reward is **a new character**: a level 1, rank 1 adventurer, on
  every difficulty.
  - In a party, each player gets them on their own first win: a player who
    won the dungeon before only gets the silver.
  - Losing doesn't count as a win.
  - The lobby shows, for the chosen dungeon, whether the player has won it
    before and what its one-time rewards are; the dungeon list marks the
    dungeons they have won. The result screen lists the one-time rewards
    the player received.
- Starting values, all data: 5 XP per monster of the first type, 2 XP per
  rat, 8 XP per guard, 6 XP per archer and 10 XP per brute (see
  [Monster types](#monster-types)). The silver
  reward is a dungeon stat (see [The dungeons](#the-dungeons)).

### Diminishing returns

Doing the same dungeon over and over gives less and less XP, until it gives
nothing. This pushes players to take their stronger characters to harder
dungeons and difficulties.

- It is **per character**, and counted **per monster**: each monster in a
  dungeon's list, on each difficulty, is a separate monster. Rat 3 of the
  Rat Warren on Normal and the same rat on Hard are counted apart.
- **Every kill of a monster lowers its XP by 10% of its full XP** for each
  character that was in the game, for the next time:

  | Kills before | 0 | 1 | 2 | ... | 9 | 10 or more |
  |---|---|---|---|---|---|---|
  | XP of the full XP | 100% | 90% | 80% | ... | 10% | 0% |

  The full XP is the monster type's XP times the difficulty's multiplier.
  The result is rounded to the nearest whole XP.
- A kill counts for every character in the game, just like the XP it gives,
  also when the character gains nothing from it (at its max level, or
  after 10 kills).
- **XP is still given per kill**, during the game: leaving before the last
  monster dies doesn't help to avoid the penalty, and doesn't lose the XP
  already gained.
- A new character starts with no kills, so it gets full XP everywhere.
- **The party screen shows, for each chosen character, the XP it would get**
  from clearing the chosen dungeon on the chosen difficulty, as a
  **percentage of the full XP** of that dungeon: the XP of every monster in
  it at that character's kill counts, against the XP they would all give
  without any kills. For example, "Runner (Ann), 70% XP". A character at its
  max level shows "max level" instead.
- Kills are counted by a monster's place in the dungeon's list. If a
  dungeon's monsters are changed later, the counts of that dungeon may no
  longer match the new monsters; that is accepted.

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
- **The host chooses the turn duration when creating the game**, from a list
  with Normal preselected (see Turns). It can't be changed afterwards; the
  open games list and the party show it, so players know what they join.
- **The host chooses the dungeon and the difficulty**; everyone sees the
  choice live. **Only the host's progress counts**: the host can choose
  any dungeon and difficulty they can play (see
  [Unlocking dungeons](#unlocking-dungeons)), and anyone can join, whatever
  they have unlocked themselves.
- The choice is made on a **dungeon map**: the dungeons in their fixed
  order, each marked as cleared, next to clear, or locked, for the host on
  the chosen difficulty. The exact look is decided by trying it out.
- A new game starts with **the host's next dungeon to clear**, on the
  hardest difficulty they have unlocked (or the last dungeon on it, if they
  have cleared them all).
- **When the host leaves** and another player takes over, the choice stays
  if the new host can play it; otherwise it changes to the new host's next
  dungeon to clear, as for a new game.
- **A game has at most as many characters as the dungeon allows** (4 for every
  dungeon so far), for example two players with 2 characters each. A player
  can't join or change their choice if that would go over it, and the host
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
- **The turn durations are data**: a name and a cycle length each, so adding
  one mostly means adding data.
- **The difficulties are data**: a name and multipliers each, and the
  dungeon order is one list, so adding a dungeon or a difficulty mostly
  means adding data.

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
