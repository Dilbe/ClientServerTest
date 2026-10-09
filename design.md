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
- **The first chip is always the next player character to act**, with the
  time until its turn. After a player character's turn, its chip **moves to
  the end of the track**, together with the monsters linked to it (they act
  as one step). This only changes how the track is shown, not who acts after
  whom.
  - Example: the track is A, monster 1, B, monster 2, C. After A's turn it
    shows B, monster 2, C, A, monster 1.
- **The track moves together with the board** (see Showing what happens).
  While a character or monster acts on the board, its chip stays at the
  front; after its last move or attack, the chip slides to the end of the
  track (about half a second). The character goes first, then each of its
  monsters; a monster that does nothing slides right after the one before
  it. When the board is behind (more than one turn to show), the track is
  behind just as much. The countdowns don't wait: they always count down to
  the real next turns.
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
  [Doors and sleeping rooms](#doors-and-sleeping-rooms)), or an
  [ability](#abilities) such as heavy strike.
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
- The initiative track follows the same playback: each chip slides to the
  end when its character or monster is done (see Turns: the initiative
  track).
- When nobody is watching (the game is in a background tab) or the client
  starts over from the server's state, it skips the playback: the board and
  the track jump to where they are now.
- The exact look and pace are decided by trying them out.

### Planning

- Between their turns, players **plan** what their character will do: **a
  list of actions, at most as many as its actions stat**. Each action is
  planned from where the actions before it leave the character. The plan is
  carried out when their turn fires.
- A plan is built by **tapping highlighted hexes**: each tap adds an action,
  and when the plan is full a tap replaces its last action.
- **Tapping never takes an action back; only the buttons do.** **Undo last
  action** takes the last action back, **Clear all actions** removes the
  whole plan. They sit right under the map, so they are easy to find, also on
  a phone (issue #91).
- **Every planned action is visible on the map**, for every player
  character (issue #91):
  - A move, an attack or opening a door is a **big, thick arrow** from where
    the character will stand to the target hex. The shape tells them apart,
    not only the colour: a move has a solid arrowhead, an attack is a red
    arrow with a burst at the tip, opening a door ends in a flat bar.
  - With more than one planned action, the arrows are **numbered** (1, 2,
    ...). Several attacks on the same monster from the same hex share one
    arrow, with all their numbers.
  - A placement is a dashed ring on the start hex, labelled with the
    character, since there is no token yet to start an arrow from.
  - The monster preview's arrows are thinner, so the players' own plans
    stand out.
  - **Attack lines keep to their right** (issue #112): every attack line,
    the players' attacks and heavy strikes as well as the monster preview's
    attacks (melee and ranged), runs parallel to the line between the two
    tokens, shifted to its own right as seen from the attacker, from token
    edge to token edge. Two attacks between the same two tokens, one each
    way, then pass each other side by side instead of one hiding the other,
    and a line from below passes beside the HP under a token instead of
    through it. Moves and door openings keep their arrows close to the line
    between the centres.
  - The monster preview's attack lines have a **small arrowhead** at the
    target, so it's clear which of two side-by-side lines is the monster's.
- With more than one own character, the player **chooses which one to plan
  for** by tapping its chip on the initiative track, or **its token on the
  map**. The selected character is marked on both. Only characters on the
  map can be tapped there, not their planned positions: a planned placement
  can sit on a start hex that another unplaced character could still take,
  so unplaced characters are chosen on the track. Tapping other players'
  characters doesn't select them; it only shows them in the details card
  (see [The details card](#the-details-card)).
- **A monster can be attacked more than once in a turn**: tapping a monster
  the plan already attacks adds another attack while the plan has room. When
  the plan is full, that tap changes nothing, apart from a short hint such as
  "Already attacking Rat 3". (It used to take the attacks back, which players
  did by accident without noticing.)
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
  marked on the map (a dashed arrow or ring with a cross) and listed under
  it, with the reason.

### The details card

Comes with issue #126.

Every character's and monster's stats can be looked at during a game,
without a separate mode: **the map is for acting, the initiative track is
for looking**. A mode switch ("tap Attack, then tap the monster") was
rejected because it costs a tap for every action.

- A **details card** shows one character or monster at a time:
  - A **character**: its name (with the player's name for other players'
    characters), class, rank and level (which goes up during the game when
    the character gains a level), **HP as current/max**, actions,
    movement and attack damage, and its planned actions against its actions
    stat (`1/2`).
  - A **monster**: its name (with its number, unless it is a named monster),
    **HP as current/max**, actions, movement, attack damage and range, and
    whether it is awake, asleep or on guard. The full rules of its type stay
    in the monster rules further down.
- **By default it shows the selected character**, so a player's own stats
  are always in view. Selecting an own character, on the track or the map,
  shows it again.
- **Tapping any chip on the initiative track** shows that character or
  monster in the card, and marks it on the map. For the player's own
  characters this also selects them, as before; for monsters and other
  players' characters it does nothing else. Everything on the map is also on
  the track, so this always works, on every device. While the card shows
  anything other than the selected character, a dashed ring marks its token
  on the map and a dashed outline its chip.
- **On the map, every tap on a token also shows it in the card**, next to
  what the tap already does: a tap that plans an attack shows the target, so
  the player sees its HP; a tap that plans nothing (another player's
  character, a monster out of reach) only shows it, and still shows an
  archer's or guard's range as before.
- **Shortcuts**, never the only way:
  - **With a mouse**, hovering over a token shows it in the card while the
    pointer is over it; the card goes back when the pointer leaves.
  - **On a touch screen**, a **long press** on a token (holding it about half
    a second without moving) shows it in the card **without planning
    anything**. The phone's own long-press behaviour (text selection, a
    context menu) is turned off on the map.
- When the character or monster in the card dies, the card goes back to the
  selected character.
- The card sits **right above the planning buttons**: under the map on a
  phone, under the initiative track in the right column on a wide screen.

## Characters

- An account has characters. **Every account starts with one**; more can be
  bought or won (see [Advancement](#advancement)).
- **Choosing characters**: on "Find a game" or in the party, each player
  chooses **1 to 3 of their characters** to bring into the game. Each chosen character gets its
  own turn on the initiative track, with its own linked monsters. A player
  can change the choice until the game starts. Everyone in the party sees
  each player's chosen characters, by name, on the player's card.
  The game itself refers to characters, not accounts.
  The characters to choose from are listed in the same order as on the
  character page (see [The character page](#the-character-page)), and
  outside a party the first of them is chosen by default.
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
  that can be upgraded (see [Advancement](#advancement)). From rank 2 it
  also has **abilities** (see [Abilities](#abilities)). Skills come later,
  roughly like the stats and skills in the Demo-game project.
- Base stats: every new character has **1 action** per turn, can **move 1
  hex**, **attacks for 1 damage** an adjacent enemy, and has **10 hit
  points**.
- There is **no permanent death**, and **characters can't be deleted**.

### The character page

A separate screen, opened from the lobby, that lists the player's characters.

- The characters are sorted by **rank, highest first**, and within a rank by
  **level, highest first**. Characters with the same rank and level keep the
  order in which they were made.
- Each character shows its name (with an edit button), class, rank, level,
  XP (towards the next level), stats and unspent upgrade points.
- A character at its **max level** shows "(max)" next to its level, for
  example "level 10 (max)", and a short hint below it: *"This character
  can't gain more XP. To rank it up, combine it with another rank N
  adventurer that is also at max level."* (issue #130). Rank 5 characters
  can't rank up, so they show "(max)" without the hint.
- From rank 2 it also shows its **abilities** (see [Abilities](#abilities)),
  each with what it does and its stats: for heavy strike its **damage** (with
  the character's upgraded attack damage) and its **cooldown**, for charge
  also its **range**. A stat that can be upgraded has an upgrade button with
  its cost, like the character's stats, for example "−1 (10 points)" next to
  the cooldown; at its limit the button says "Max" (see
  [Ability upgrades](#ability-upgrades)). That a plan holds at most one use
  of each ability isn't shown: it is the same for every ability and can't be
  upgraded. A character without abilities shows no abilities section.
- Actions on the page: **rename**, **buy an adventurer**, **upgrade a
  stat**, **upgrade an ability**, **reset upgrades** and **rank up** (see
  [Advancement](#advancement)).
- **Buying** has one button per rank, 1 to 5, each showing the current
  price of that rank (see [Getting more characters](#getting-more-characters)).
  A rank the player can't afford is greyed out; the server refuses a
  purchase without enough silver with a clear message.
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
  short label in front of its number: **M3** is monster 3 of the first type,
  **R3** a rat. The log and the preview use the full name, like "Rat 3".
  Every type has a different label: one letter where it can, two where the
  letter is already taken (see [Monster types](#monster-types)).

### Monster types

All data, so a new type mostly means adding an entry.

| Type | Label | Hit points | Attack damage | Actions | Range | XP | Alert range | Targeting |
|---|---|---|---|---|---|---|---|---|
| Monster (the first type) | M | 3 | 1 | 1 | 1 | 10 | none | the rules above |
| **Rat** (issue #83) | R | 3 | 1 | **2** | 1 | 4 | none | the rules above |
| **Guard** (issue #84) | G | **15** | **2** | 1 | 1 | 16 | **3** | the rules above |
| **Archer** (issue #85) | A | **5** | 1 | 1 | **3** | 12 | none | **ranged** |
| **Brute** (issue #85) | B | **20** | **3** | 1 | 1 | 20 | none | the rules above |
| **Tessa** (the boss, issue #116) | T | **40** | **3** | **2** | 1 | **50** | none | the rules above |
| **Barbara** (minion, issue #116) | Ba | **20** | **2** | 1 | 1 | **24** | none | the rules above |
| **Mark** (minion, issue #116) | Ma | **8** | **2** | 1 | **3** | **24** | none | **ranged** |

- The **rat** is fast and weak: the first monster type with 2 actions, so it
  can step next to a character and attack it in the same turn.
- The **guard** is strong but patient: it waits at its post until a character
  comes close (see [Guards and alert range](#guards-and-alert-range)), so
  players can take guards on one at a time.
- The **archer** is weak, but shoots from up to 3 hexes away at whoever it
  can see (see [Ranged attacks](#ranged-attacks)).
- The **brute** is slow to kill and hits hard: it keeps the players away from
  the archers behind it.
- **Tessa** is the boss of [Tessa's Lair](#the-dungeons). Like a rat she can
  step next to a character and hit it in the same turn, but she hits as hard
  as a brute and has twice its hit points.
- **Barbara**, one of Tessa's minions, is a tough fighter who gets in the
  players' way. **Mark**, the other one, stays back and shoots, like a
  stronger archer.
- Every monster takes up one hex, Tessa included.
- **Labels**: B and M were already taken by the brute and the first monster
  type, so Barbara and Mark have two-letter labels. The rule is "a short
  label, different for every type".
- **Named monsters**: Tessa, Barbara and Mark are characters, not kinds of
  monster. The log, the preview and the monster info call them by their name
  alone ("Tessa"), without a number. The map and the initiative track still
  show the label with the monster number, like any other monster (for
  example **T3**), so they stay unique and short. Being named is a flag on
  the monster type.

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
  end, with a button **back to "Find a game"**. A player who was offline when it
  ended sees the result when they come back.
- **Going back to "Find a game" frees the account** at once, to create or join a
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
- **Tessa's Lair** (issue #116), the boss dungeon and the last in the list,
  so the last to clear on every difficulty: a **hallway of 2 by 3** leading
  up into the middle of a room of **8 by 8**.
  - The **start hexes** are the bottom 4 hexes of the hallway.
  - **Tessa** stands in the middle of the room's far (top) wall, **Barbara**
    in front of her on the left, and **Mark** on the right, behind a
    **pillar** that hides him from the way up, so he has to come out of cover
    to shoot. Every start hex is out of Mark's range.
  - No doors and no guards: everything is awake from the start.
  - At most 4 characters; 75 silver.
  - The name, the map and all numbers of Tessa's Lair and its monsters are
    a first version, to balance by playtesting.

### Difficulties

Built with issue #96.

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

Built with issue #96.

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
  - The party shows, for the chosen dungeon and difficulty, whether the
    player has won it there before and what its one-time rewards are; the
    host's dungeon map marks the dungeons they have cleared. The result
    screen lists the one-time rewards the player received.
- **One-time hints** (issue #130): popups on the result screen that explain
  levelling up and ranking up to new players. They show after a win or a
  loss, since XP is kept either way, and each shows **only once per
  player**, closed with an "OK" button.
  - **First level-up**: the first time any of the player's characters gains
    a level: *"Your character levelled up! Each level gives upgrade points,
    which you can spend on stats on the character page."*
  - **First max level**: the first time any of the player's characters
    reaches its max level: *"Your character reached its max level and can't
    gain more XP. To keep progressing, rank it up on the character page by
    combining it with another adventurer of the same rank that is also at
    max level."* Rank 5 doesn't count: it can't rank up.
  - When both happen in the same dungeon, both show, level-up first.
  - Which hints a player has seen is stored on their account, so it holds on
    every device. Accounts from before the hints start with none seen.
- Starting values, all data: 10 XP per monster of the first type, 4 XP per
  rat, 16 XP per guard, 12 XP per archer, 20 XP per brute, 50 XP for Tessa
  and 24 XP each for Barbara and Mark, doubled by issue #123 (see
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
  The result is **rounded up** to a whole XP, so a monster gives at least
  1 XP until its 10th kill. A rat's 4 XP, for example, gives 4, 4, 4, 3, 3,
  2, 2, 2, 1, 1 and then nothing (after 3 kills, 70% of 4 is 2.8, rounded
  up to 3).
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
  without any kills, rounded down (but never to 0% while some XP is left).
  It is shown next to the character's name, on its player's card: for
  example, "Runner 70% XP". A character at its max level shows
  "max level" instead.
- Kills are counted by a monster's place in the dungeon's list. If a
  dungeon's monsters are changed later, the counts of that dungeon may no
  longer match the new monsters; that is accepted.

## Advancement

Characters grow by gaining levels, which give upgrade points to spend on
stats. This is a first version to playtest with adventurers only: if it
isn't fun or is too grindy, the whole system may change.

### Levels

- Every character starts at **level 1**. Going from level *L* to *L* + 1 takes
  **5 × *L* XP**: 5 XP from level 1 to 2, 10 more from 2 to 3, 15 more from
  3 to 4.
- **The character keeps its total XP; the level follows from it.** XP left
  over after a level counts towards the next one. Reaching level *L* takes
  2.5 × *L* × (*L* − 1) XP in total:

  | Level | 2 | 3 | 4 | 5 | 10 | 20 | 50 |
  |---|---|---|---|---|---|---|---|
  | XP from the level before | 5 | 10 | 15 | 20 | 45 | 95 | 245 |
  | Total XP | 5 | 15 | 30 | 50 | 225 | 950 | 6,125 |

- **Max level = rank × 10.** A character at its max level gains no more XP.
- **A change to the XP curve applies to existing characters at once**: they
  keep their total XP and their level follows from it. When the XP per level
  was halved (issue #93), characters went up in level and got the upgrade
  points of their new level. A character that ends up with more XP than its
  max level needs keeps that XP, but stays at its max level and gains no
  more.

### Upgrade points

- **Reaching level *L* gives *L* upgrade points**: 2 at level 2, 3 at level 3,
  and so on. A level 10 character has earned 2 + 3 + ... + 10 = 54 points.
- Upgrade points are spent on **stat upgrades**: each upgrade adds **1** to
  one stat. From rank 2 they can also be spent on
  [ability upgrades](#ability-upgrades). Skills come later.
- **Movement can't be upgraded yet.** Characters always move 1 hex per
  move action, so a movement upgrade would do nothing. The character page
  doesn't offer it and the server refuses it. Movement stays a stat (base 1,
  monsters have it too), so it can become upgradable again once it is used.
  Characters that upgraded movement before got those upgrades removed and
  the points back; their other upgrades stayed.
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
  | Actions | 20 | 2 | 20, 80, 180, ... |

### Resetting upgrades

- A character of level 2 or higher can **reset all its upgrades**. It then:
  - **loses one level**: its XP goes back to the total needed for the level
    below, so XP towards the next level is lost too;
  - **loses all its upgrades**;
  - has the upgrade points of its new level to spend again.
- Example: a level 5 character with 60 XP resets. It is now level 4 with
  30 XP, no upgrades, and 2 + 3 + 4 = 9 upgrade points.

### Class and rank

- Every character has a **class**. For now there is one: **adventurer**.
- Every character has a **rank**, from **1 to 5**. The rank sets the max level
  (rank × 10), so the highest max level is 50.
- **Ranking up**: **two adventurers of the same rank, both at their max
  level**, are used up to make **one adventurer of the next rank**. The new
  adventurer starts at **level 1 with 0 XP and no upgrades**, and gets the
  next character number. An adventurer of any rank can also be **bought
  with silver** (see [Getting more characters](#getting-more-characters)).
- Later, classes such as **healer** or **tank** may be made from **two rank 5
  adventurers** in a similar way. That waits until advancement has been playtested with
  adventurers.

### Abilities

A higher rank also gives something new: an **ability**, an action a lower
rank can't do. Abilities are data per class: which rank gets them, what they
do and their cooldown, so a later ability (for example at rank 3) mostly
means adding an entry.

#### Heavy strike

Comes with issue #108.

Adventurers of **rank 2 and higher** have **heavy strike**.

- A heavy strike is **an attack on an adjacent monster for double the
  character's attack damage** (2 at the base attack damage of 1). It follows
  attack damage upgrades.
- It is **one action**, like a normal attack, and **a plan holds at most one
  heavy strike**, whatever the character's actions stat.
- **Cooldown**: after a heavy strike, the character **can't use it on its
  next 4 turns**. Used on turn 1, it can't be used on turns 2 to 5, and is
  ready again on turn 6.
  - Only the **character's own turns** count, also turns in which it is dead
    or not on the map.
  - Every game starts with heavy strike ready.
  - **A cancelled heavy strike doesn't start the cooldown**, for example
    when the monster moved away or died first: it wasn't carried out.
- **Planning**: a **"Heavy strike" button** under the map, next to Undo and
  Clear, only for characters that have it. Tapping it **arms** it (it is
  shown as active); the next tap on an adjacent monster then plans a heavy
  strike instead of a normal attack, and the button goes back to normal.
  Tapping the button again disarms it. Normal tapping stays exactly as it
  was, so a normal attack costs no extra tap.
  - While it is on cooldown, or the plan already holds one, the button is
    greyed out and says why, for example **"Ready in 2 turns"**.
- **On the map** a planned heavy strike has its own arrow shape, not only
  its own colour, for example a red arrow with a double shaft and a bigger
  burst. The preview and the log show it like any other attack.
- **Follow-up plans** (see [Keeping a monster targeted](#keeping-a-monster-targeted))
  only use normal attacks, also when the last action was a heavy strike.
- **The server checks** that the character has heavy strike and that it is
  ready, and refuses the plan otherwise. A client can send any plan it
  likes, so the button being hidden is not a check.
- **Upgrading it**: its damage grows through attack damage upgrades, and
  its cooldown can be shortened (see [Ability upgrades](#ability-upgrades)).

#### Charge

Comes with issue #138.

Adventurers of **rank 3 and higher** have **charge**: a run in a straight
line that ends in an attack.

- A charge targets a **monster 2 to 4 hexes away in a straight line**, along
  one of the 6 hex directions. The character **runs along that line to the
  hex next to the monster**, then attacks it for its **normal attack
  damage**. A 1-hex charge would just be a normal attack, so it isn't one.
- Straight lines along the hex directions are deliberately simpler than
  [line of sight](#line-of-sight): the player can see at a glance which
  monsters are in line.
- It is **one action** for both the run and the attack, and **a plan holds
  at most one charge**. A plan can hold a charge and a heavy strike
  together.
- Every hex of the run, including the one the character stops on, must be
  **free**: no wall, pillar, closed door, character or monster.
- **All or nothing**: if the monster is no longer in that line or range, or
  the path is blocked when the turn fires, the whole charge is cancelled: no
  move and no attack. That is easier to predict than a charge that runs
  partway.
- **Cooldown**: the character **can't charge on its next 4 turns**, with the
  same rules as heavy strike: only its own turns count (also while dead or
  off the map), every game starts with charge ready, and **a cancelled
  charge doesn't start the cooldown**.
- A guard that is charged is alerted, as with any attack.
- **Follow-up plans**: a charge counts as an attack, so if the monster
  survives, the next plan starts out with normal attacks on it (see
  [Keeping a monster targeted](#keeping-a-monster-targeted)).
- **Planning**: a **"Charge" button** under the map that works like the
  heavy strike button. Tapping it arms it and **highlights the monsters the
  character can charge** from where the plan places it; tapping one of them
  plans the charge. While a charge can't be planned the button is greyed
  out with the reason, for example "Ready in 2 turns".
- **On the map** a charge has its own arrow shape: a long arrow along the
  run that ends in an attack burst. The preview, playback and log show the
  run and then the attack, named as a charge.
- **The server checks** the rank, the cooldown, at most one per plan, and
  that the target is in a straight line 2 to 4 hexes away with a free path.

#### Cleave

Comes with issue #139.

Adventurers of **rank 4 and higher** have **cleave**: one swing that hits
every adjacent monster.

- A cleave attacks **every monster next to the character** at the moment it
  is carried out, each for the character's **normal attack damage**. The
  hits land at the same time; each kill gives XP as usual, and every monster
  hit is alerted.
- It is **one action**, and **a plan holds at most one cleave**.
- **If no monster is adjacent** when it is carried out, it is cancelled.
- **Cooldown**: 4 of the character's own turns, with the same rules as heavy
  strike. A cancelled cleave doesn't start it. Like every ability, its
  cooldown can be shortened (see [Ability upgrades](#ability-upgrades)).
- **Follow-up plans**: none after a cleave, since there is no single monster
  to keep targeting.
- **Planning**: a **"Cleave" button** under the map. It needs no target, so
  **one tap plans it** from where the plan places the character. Greyed out
  with the reason while it can't be planned.
- **On the map** a planned cleave is a ring or sweep around the hex the
  character will stand on, with its action number. The preview shows which
  monsters it will hit; the log names it as a cleave.
- **The server checks** the rank, the cooldown and at most one per plan.
- **Watch in playtesting**: next to several monsters a cleave can do a lot
  of damage at once, so its cooldown may need to be longer. With heavy
  strike, charge and cleave, a rank 4 character has five buttons under the
  map; check that this still fits on a small phone.

#### Ability upgrades

Comes with issue #141.

Upgrade points can also make an ability better. The upgrades are data per
ability, next to the ability itself, so a later ability mostly means adding
its entries.

- **Cooldown, for every ability**: each upgrade takes **1 turn** off the
  cooldown, **down to 1 turn**: 4 → 3 → 2 → 1, so at most 3 upgrades. With
  a cooldown of 0 an ability could be used every turn and would replace the
  normal action, so 1 is the floor.
- **Range, for charge only**: each upgrade adds **1** to the longest charge,
  **up to 6 hexes**: 4 → 5 → 6, so at most 2 upgrades. The shortest charge
  stays 2 hexes.
- Heavy strike gets no upgrade of its own besides the cooldown: its damage
  already grows with attack damage. Cleave gets the cooldown upgrade when it
  is built (issue #139).
- **How many uses a plan holds can't be upgraded**: it stays at most one of
  each ability.
- **Costs** use the same formula as stat upgrades, *first upgrade cost* ×
  *n*<sup>*cost exponent*</sup>, rounded up. Each ability counts its own
  upgrades: shortening heavy strike's cooldown doesn't make charge's dearer.
  Starting values, all data:

  | Upgrade | First upgrade cost | Cost exponent | Costs | Limit |
  |---|---|---|---|---|
  | Cooldown (any ability) | 10 | 2 | 10, 40, 90 | 3 upgrades (cooldown 1) |
  | Charge range | 5 | 1.5 | 5, 15 | 2 upgrades (6 hexes) |

- Like stat upgrades, they are **permanent**, keep what was paid for them,
  and go with the others when a character
  [resets its upgrades](#resetting-upgrades). A ranked-up or bought
  character starts without any.
- **A change to a limit** only matters from then on: if a limit is ever
  lowered, upgrades beyond it stay bought but do nothing.
- **The server checks** that the character's rank gives it the ability, that
  the ability has that upgrade, that the limit isn't reached and that there
  are enough points. The request names the ability and the upgrade, never
  the cost.
- **In a game**, the shorter cooldown and the longer range are what the
  rules, the plan check, the map highlights and the planning text use.

### Getting more characters

- Every account starts with **one level 1, rank 1 adventurer**.
- **Buying**: the player can buy an adventurer of **any rank, 1 to 5**.
  - **Each rank counts only its own purchases.** The price is the rank's
    **base price × (the number of adventurers of that rank the player has
    bought + 1)**:

    | Rank | 1 | 2 | 3 | 4 | 5 |
    |---|---|---|---|---|---|
    | Base price = 1st purchase | 10 | 90 | 450 | 1000 | 2,500 |
    | 2nd purchase of that rank | 20 | 180 | 900 | 2,000 | 5,000 |
    | 3rd purchase of that rank | 30 | 270 | 1,350 | 3,000 | 7,500 |

  - **Only purchases count.** The starting character, reward characters and
    rank-ups never change a price, and buying one rank never changes the
    price of another, so the order of buying doesn't matter. Something
    meant to be good, like a reward, should never also make something
    more expensive.
  - The base prices are balance numbers, kept with the others in
    `shared/rules/advancement.ts`.
  - A bought adventurer starts at **level 1 with 0 XP and no upgrades**,
    like a ranked-up one, and gets the next character number. From rank 2
    it has the abilities of its rank (heavy strike, and from rank 3
    charge, from rank 4 cleave).
  - Purchases weren't counted before this rule (issue #113), so for
    accounts from before it every count started at 0.
- **Winning** a dungeon for the first time gives one (see
  [Rewards](#rewards)).

## Parties and the lobby

- Players form a party before the game starts. The lobby has two screens,
  named so players can tell at a glance where they are (the code still
  calls them both the lobby):
  - **"Find a game"**: a simple list of the open games, with the "Create a
    game" button.
  - **"Party"**: the player's own game before the start, made to look like
    a room getting ready for a game: the chosen dungeon and difficulty
    large at the top, the dungeon map under it (only for the host), **one
    card per player** with their chosen characters and each character's XP
    percentage, and a large **"Start the game"** button for the host, with
    a smaller "Leave" under it.
- **"Find a game" lists the open games** (not started yet) with their players,
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
- **Each dungeon on the map shows its full XP** on the chosen difficulty
  (issue #122): the XP a character gets from killing every monster in it
  with no earlier kills (see [Diminishing returns](#diminishing-returns)),
  for example "Up to 120 XP".
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
- **The map area has the same size for every dungeon**: on a phone, the full
  width, as tall as it is wide, but never taller than 70% of the screen
  height. The dungeon is zoomed and moved inside it, so a wide, low dungeon
  doesn't become a thin strip. Zoomed in, the dungeon fills the whole area;
  only along a side where all of it is in view is there empty space around
  it. Rotating the phone or resizing the window resizes the area and keeps
  the zoom and position as well as possible.
- **On a wide screen the map gets most of it.** From about 1024 pixels wide
  (a computer, a tablet held sideways), the game screen fills the window
  exactly: the map takes everything to the left of a column about 350 pixels
  wide on the right, from under the header down to the bottom of the window.
  The right column holds the rest of the game screen in the same order as on
  a phone: the result and the initiative track at the top, then the details
  card, the planning buttons, the legend, the log, "What will happen", the monster rules, the
  players and "Leave the game". When the column is longer than the window,
  only the part under the track scrolls, so the map and the track stay in
  view. The lobby and the other screens keep the narrow column of a phone,
  which is easier to read. Narrower windows, including every phone, keep the
  layout above.
- **The map zooms on its own.** Pinching on the map zooms only the map, around
  the point between the fingers, and dragging with one finger moves it; the
  rest of the page stays where it is. On a computer, the mouse wheel over the
  map zooms and dragging moves it.
  - A tap still plans, but a drag or a pinch never does: a touch that moves
    more than a few pixels is a drag.
  - Zooming out stops at the whole dungeon, zooming in at about five hexes
    across. The map can't be dragged out of view.
  - A **"Fit"** button above the map shows the whole dungeon again.
  - A new game starts with the whole dungeon in view if its hexes are then at
    least about 60 pixels across (the minimum tap size is 44). Otherwise it
    starts zoomed in to that size, with the start hexes in view, and the
    player drags to see the rest.
  - Pinching outside the map still zooms the page as usual: page zoom stays on,
    for players who need everything bigger.
  - Zoom and position live only in the player's own browser.
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
- Monster pictures instead of the labels on the map, starting with a
  hand-drawn picture of Tessa.

## Open questions

- Is advancement fun, or too grindy? Playtest with adventurers before adding
  classes; the numbers are all data and easy to change.
- What does rank 5 give? Charge and cleave cover ranks 3 and 4; rank 5
  still has no ability of its own.
