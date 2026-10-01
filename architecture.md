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

## Later

Worked out later; written down so they aren't forgotten.

- **Database backups.** Everything lives in one file on one volume. Options:
  a periodic copy to object storage, continuous replication (Litestream), or
  the provider's volume snapshots.
- **Retention of finished games**, especially when accounts can be deleted
  (the events are linked to accounts, so they are personal data).

## Still to discuss

- Shared rules code between client and server, and the client technology.
- Accounts and login.
- Communication between client and server (HTTP, WebSocket, reconnecting).
- Security for the public web.
- Privacy (GDPR): what personal data is stored and logged.
