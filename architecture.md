# Architecture

How the game is built: hosting, the server, storage, accounts, communication
and security. What the game does for the player belongs in `design.md`.

## Hosting

- **A platform service** runs the app and provides HTTPS and a domain. No
  self-managed server, and nothing hosted from home.
- **Packaged as a container** (Docker), so the app runs the same locally and in
  production and can move between providers.
- **Exactly one instance.** Running games and their turn timers live in that
  one server process. A second instance would fire the same turns twice.
  The server is stateful on purpose: a stateless design would allow scaling
  out, but that isn't expected to ever matter for this game.
- **The provider is chosen later**, unless another choice turns out to depend
  on it. Requirements for the provider:
  - The app runs **always on**. No tiers that put the app to sleep.
  - WebSockets are supported.
  - A **persistent volume** for data, which survives deploys.
  - HTTPS and a custom domain.
  - An EU region.
  - Deploying from GitHub.

## Server process

- **One Node.js process** runs everything: web pages, login, WebSockets and all
  running games.
- **Node runs all JavaScript on one thread.** Work is handled one item at a
  time, and other work can only run where the code `await`s (like `async` code
  on the WinForms UI thread). This means no locks are needed, but also:
  - **Never block the thread** with long CPU work or synchronous I/O, because
    every game and connection waits.
  - **Resolving a turn must not be split by an `await`.** Checking that a turn
    is due, resolving it and updating the in-memory state happen in one go, so
    no incoming plan or second timer tick can slip in between.

### Three layers

| Layer | Contains | Knows about network, database or time? |
|---|---|---|
| **Rules** | Resolving a turn, target selection, movement, hex maths | No. Pure functions only |
| **Game manager** | Running games, game clocks, the turn timer, accepting plans, writing events, sending updates | Yes |
| **Edges** | HTTP routes, WebSocket handling, database access | Yes |

- **The rules layer is pure**: `resolveTurn(state, plans) → { newState, events }`.
  Given the same input it always gives the same output, and it has no
  dependencies on anything else. This makes it easy to test, and lets the
  client reuse it for the preview.
- The game manager uses the rules layer; the edges call the game manager. The
  rules layer never calls outward.

## Turn timing

- **The timer lives in the app.** No external scheduler.
- **One central timer for all games.** It ticks every second, and on each tick
  resolves the turns that are due in every running game.
- **Turn scheduling is data.** Each game's next turn time follows from its
  stored state, so it doesn't depend on a timer that only exists in memory.
- **Downtime pauses the game clock.** While the server is down (deploy, crash),
  game time stands still. After a restart, every game continues where it was,
  with the same time left until the next turn as when the server stopped.
  - Each game keeps its own **game time**, which only advances while the
    server runs.
  - To know how long it was down, the server regularly records that it is
    still running (a heartbeat), and records the moment it stops on a normal
    shutdown. After a crash, the last heartbeat is used, so up to one
    heartbeat interval of game time may be lost or counted.
  - Clients get the new turn times when they reconnect.

## Storage

### Database

- **SQLite**: a single database file on the persistent volume. Real SQL with
  transactions, without a separate database server. It fits the single
  instance: SQLite is built for one process owning the file.
- **A synchronous library** (`better-sqlite3`). Writes to the local file take
  microseconds, so saving a turn needs no `await` (see Server process).
- Moving to PostgreSQL later stays possible, since both are SQL.

### What is stored where

| Data | How it changes | Stored as |
|---|---|---|
| Accounts | Rarely | Table |
| Characters | After each finished dungeon | Table, mostly JSON (see below) |
| Running games | Every turn and plan change | Event store |
| Server heartbeat | Every few seconds | A single row |

### Characters

Characters will hold a lot of nested data that keeps growing as stats, skills,
unlocks and objectives are added (compare the save data in Demo-game).

- **A `characters` table** with ordinary columns for what is looked up or
  filtered on (id, account, name, timestamps), plus **one JSON column with the
  rest of the character**.
- **The JSON has a version number.** When its shape changes, a small upgrade
  function converts older versions when they're loaded, the same way
  Demo-game converts old saves.
- **Character data is checked when loaded**, so a bad or outdated record is
  caught at once instead of causing odd behaviour later.
- **An account is in at most one running dungeon** (see `design.md`). The
  server checks this when an account joins a party; otherwise two dungeons
  would each start from the same character record and the last to finish
  would overwrite the other's rewards.
- **During a dungeon, the character record isn't touched.** The dungeon's
  state (HP, cooldowns, buffs) lives in the game's event store. The record is
  only updated when the dungeon ends, with the rewards.

### Event store for running games

- **One append-only table**: game id, sequence number, event type, event data
  (JSON) and timestamp. Game id and sequence number are unique together.
- **It stores results, not inputs**: "A attacked monster 2 for 1", not "A
  planned to attack". Replaying never runs the rules, so a rule change in a
  deploy can't change a running game's history.
- **Setting up the initiative track is an event** with the resulting order,
  not a random seed.
- **Plan changes are events too**, so plans survive a restart.
- **In memory**, the server keeps each running game's current state. On
  startup it rebuilds that state by applying the game's events. The database
  is the source of truth; memory is the working copy.
- **Finished games are kept for now** (replays, debugging, balancing).
  Retention is decided later; see Later.

### Saving a turn

1. The timer finds a due turn.
2. The rules layer resolves it, giving the new state and the events.
3. The events are written in one database transaction.
4. The in-memory state is updated.
5. The events are sent to the connected clients.

All of this runs without an `await`. If the server crashes before step 3, the
turn didn't happen and is resolved after the restart; nothing is half-saved.

## Client and shared code

- **TypeScript on both sides.** The rules layer is shared between server and
  client, so both are written in the same language.
- **Vite builds the client.** During development it serves the client and
  reloads it on every change; for production it bundles the client into
  static files that the Node server serves.
- **One repository, three folders:**

  ```
  shared/   rules layer: pure TypeScript, used by server and client
  server/   game manager and edges
  client/   what runs in the browser
  ```

- **The hex map is drawn with SVG.** Each hex is its own element, so it can be
  tapped directly, and SVG scales sharply on any screen size.
- **No UI framework** (React, Vue, ...) to start with. The rest of the screen
  (initiative track, plan buttons, lobby, login) is plain HTML and CSS. A
  framework is added only when the UI clearly needs one.

## Accounts and login

### Registration

- **Open registration**: anyone with the link can create an account. The game
  is meant for friends and the link isn't shared publicly.
- **Expect bots anyway.** Every HTTPS certificate is published in public
  Certificate Transparency logs, and scanners visit new domains within minutes.
  The rate limits and password rules are there for this; junk accounts can be
  disabled with an admin script. An invite code can be added later if needed.
- Creating accounts is **rate limited per address**, so a script can't create
  thousands of accounts.

### Account name and display name

- **Account name**: used only to log in. **Other players never see it.**
  Unique, compared case-insensitively (`Bob` and `bob` can't both exist).
- **Display name**: entered when creating the account, and the only name other
  players see. **Also unique**, so nobody can pose as another player.
  - Compared case-insensitively, and restricted to a limited set of
    characters, so look-alikes (`Bob` / `BOB`, or letters from other alphabets
    that look the same) can't be used to imitate someone.
    Spaces, `_` and `-` are ignored in the comparison, so `Bob_` and `B-o-b`
    count as `Bob` too.
  - **Can be changed once.** The account records that it has been changed.
    The old name stays reserved, so nobody else can take it and pose as that
    player.

### Passwords

- Stored as an **argon2id** hash with a random salt per password: a slow,
  memory-heavy hash, so a leaked database doesn't reveal passwords and
  guessing them offline is expensive.
- **At least 10 characters**, no forced complexity rules (current NIST
  guidance: length helps, forced symbols mostly don't).
- **Failed logins are limited** per account name and per address: after a few
  failures, further attempts are delayed or briefly blocked. With one server
  instance, an in-memory counter is enough.

### Sessions

- Logging in creates a **session**: a long random token. The browser gets it
  as a cookie; the database stores only a hash of it, so a database leak
  doesn't hand out valid sessions.
- The cookie is `HttpOnly` (JavaScript can't read it), `Secure` (HTTPS only)
  and `SameSite` (not sent when another site makes the request).
- **Sessions last 30 days**, extended each time the player uses the game.
  Logging out ends the session; changing the password ends all other
  sessions.
- **WebSockets use the same cookie.** The session is checked when the socket
  opens, together with the `Origin` header (see Security).

### Admin tasks

- Done with **command-line scripts** run on the server (for example resetting
  a password), not an admin web page. A script can only be run by someone who
  already has access to the server; an admin page would be one more thing on
  the internet to attack.
- First scripts: reset a password, disable an account, delete marked
  accounts, export an account's data.

## Communication

- **HTTP** for the client files and account actions: register, log in, log
  out, change display name.
- **One WebSocket per player after login** for everything live: the lobby and
  the game.

### Messages

- **JSON with a `type` field**, checked against a **schema**. The schemas live
  in `shared/`, so client and server use the same definitions, and the
  TypeScript types are derived from them.
- The server **drops** messages that don't match their schema, are too large,
  or arrive too fast.

| Direction | Messages |
|---|---|
| Client → server | Set plan, clear plan, lobby actions (create, join, leave, start) |
| Server → client | Snapshot (full state), turn resolved (events and next turn times), plan changed (another player's plan, sent live on every change), lobby updates |

### Keeping the client in sync

- **On every connect the client gets a full snapshot**: first load, reconnect
  and server restart all work the same way.
- After that only events arrive, each with the game's **sequence number**. If
  the client sees a gap, it asks for a new snapshot.
- **The preview runs in the client**, using the shared rules code on the
  snapshot and the current plans. The server isn't involved.
- **Turn times are sent as "next turn in N seconds"**, not as a clock time,
  because phone clocks can be off. The client counts down from that.
- **The lobby is simpler**: it is small, so after every change each player
  gets the whole lobby again instead of events. It lives only in memory; a
  server restart empties it, and players form their party again.

### Dropped connections

- The client **reconnects automatically**, waiting a little longer after each
  failed attempt, and **at once** when the phone wakes up or the tab becomes
  visible again.
- The server **pings each connection** regularly, so connections that phones
  dropped silently are noticed and closed.

### Client version

- On connect the server sends its **version**. If the client's version
  differs (a tab left open across a deploy), the client **reloads itself**, so
  an old client never sends messages the new server doesn't understand.

### Hidden information

- Nothing is hidden yet, so every player may receive the full game state. If
  hidden information is ever added (fog of war, secret plans), the server must
  leave it out of what it sends each player: anything sent to a client can be
  read, whatever the screen shows.

## Security

Standard web security practices apply and aren't repeated here. Specific to
this project:

- **Dependabot is turned on with the first programming work**, so security
  updates for npm packages arrive as PRs.
- **Few dependencies, preferably well-known ones.** The lockfile is committed
  and installs use `npm ci`, so they are exactly reproducible.

## Privacy

The game stores little personal data on purpose (no email address). This is a
practical reading of the GDPR, not legal advice; revisit it if the game is
ever shared publicly.

| Data | Where |
|---|---|
| Account name, display name | Database |
| Password hash | Database |
| Session tokens (hashed) | Database |
| Game events, linked to accounts via characters | Event store |
| IP addresses | Only in memory, for rate limiting |

- **IP addresses are never stored in the database**, and our own logs leave
  them out. Rate limiting keeps them only in in-memory counters, which
  disappear on their own. (The hosting provider logs requests too; that is
  covered by their terms and is one reason for an EU region.)
- **A "what we store" page** lists the table above, why the data is stored,
  for how long, and the contact email address. It's linked from the login and
  sign-up pages. The email address is configuration, not part of the code.
- **Account deletion:**
  - The player **marks the account for deletion**, confirmed with their
    password. It stays usable until it's deleted, so they can cancel the mark.
  - The owner deletes marked accounts with an **admin script**, within a month
    of the mark (the GDPR deadline). Deleting removes the account and its
    characters and anonymises its events in kept games. Automating this is
    on the Later list.
- **A copy of a player's data** is given on request by email, within a month,
  using an admin script that exports the account as JSON.

## Later

Worked out later; written down so they aren't forgotten.

- **Database backups.** Everything lives in one file on one volume. Options:
  a periodic copy to object storage, continuous replication (Litestream), or
  the provider's volume snapshots.
- **Deleting marked accounts automatically**, for example a set number of
  days after the mark.
- **Retention of finished games**, especially when accounts can be deleted
  (the events are linked to accounts, so they are personal data).
