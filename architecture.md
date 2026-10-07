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
- Requirements for the provider:
  - The app runs **always on**. No tiers that put the app to sleep.
  - WebSockets are supported.
  - A **persistent volume** for data, which survives deploys.
  - HTTPS and a custom domain.
  - An EU region.
  - Deploying from GitHub.
- **SQLite needs a volume on a local disk.** Its file locking doesn't work
  reliably on a network share, and WAL mode doesn't work there at all. This
  rules out platforms whose persistent storage is a network share, such as
  Azure App Service and Container Apps (Azure Files).
- **The provider is [Hostim](https://hostim.dev)**: a small Docker hosting
  platform on bare-metal servers in Germany (Hetzner), with flat monthly
  prices. It runs a container image that we build ourselves, with a volume,
  HTTPS and a custom domain, and deploys can be started from a GitHub
  workflow with its CLI or API.
  - It was chosen over Fly.io, which met the requirements too but felt less
    pleasant to work with: a subjective choice, which is fine for a project
    this size. Azure was too expensive and too complex. Hetzner on its own is
    a bare server to manage, and Hostnet's hosting runs websites, not a
    process that keeps running.
  - **Hostim is a small, young company.** That risk is accepted: the game is
    one container plus one database file, so moving to another provider is
    small work.
  - **Checked on Hostim** while building the release pipeline:
    - The volume works for the non-root `node` user: the server creates the
      database there, and accounts, sessions and a running game survive a
      restart.
    - A restart sends SIGTERM, so the server time is saved.
  - **Still to verify on Hostim:**
    - The volume is a local disk, not network storage.
    - A deploy stops the old container before starting the new one, so two
      servers never use the database at the same time.
    - WebSocket connections stay open while a game is idle.
    - Its proxy adds the player's address at the end of `X-Forwarded-For`
      (see #47).
    - Whether volumes are backed up or can be snapshotted.
- **The app on Hostim**: one replica, HTTP port 3000 (the port inside the
  container that Hostim's proxy forwards to; the proxy itself handles HTTPS),
  health check path `/version.json`, and the volume mounted at `/data`.
- **The domain stays at Hostnet**, where it is registered. The game runs at
  `dungeoncrawl.dilbe.eu`, with an `A` record pointing to the IP address
  Hostim gives for custom domains; Hostim gets the HTTPS certificate (Let's
  Encrypt) for it.
  - An `A` record points to an IP address, not to a name (as a `CNAME` would),
    so if Hostim ever changes that address, the record at Hostnet has to be
    changed too.
  - Whoever controls the DNS can send players to another server and even get
    a valid certificate for it there, so the Hostnet account is protected
    with two-factor authentication.

## Releases

The release flow follows the one the developer knows from Azure DevOps at
work: a release branch creates numbered versions, and a button publishes one.

### Creating a version

- **A release starts with a branch named `releases/<major>.<minor>`**, for
  example `releases/1.1`, made from `main`.
- **Every push to a release branch runs the release workflow**:
  1. The same checks as CI: type check, tests and build. Nothing is released
     unless they pass.
  2. It finds the highest existing tag for that version and creates the next
     one: the first run on `releases/1.1` creates `v1.1.0`, the next `v1.1.1`,
     and so on.
  3. It builds the container image with that version and stores it in
     GitHub's container registry (GHCR), tagged `1.1.0`.
- **The image is public**, like the repository it is built from. It contains
  no settings or secrets (those are given when it runs), and Hostim can then
  fetch it without a GitHub token stored on its side.
- **Hotfixes** go through a pull request into the release branch, which
  creates the next patch version. The same fix also goes to `main`.
- Only the owner can create or push to `releases/*` branches (a branch
  protection rule).

### The version in the app

- The workflow sets `APP_VERSION` to the version (like `1.1.3`) for the build.
  Vite already compiles it into the client and writes it into `version.json`,
  which the server uses to tell old clients to reload (see Client version).
- **The version is shown in the game**, for example in a corner of the lobby,
  so players and the developer can see which release is running. Development
  builds show `dev`.
- The image also carries the version as a label, the container's equivalent
  of the version in a Windows executable's file properties.

### The container image

- **Two stages**, so build tools don't end up in production:
  1. Build: `npm ci` and `npm run build`.
  2. Runtime: `node:22-slim` with `npm ci --omit=dev`, `server/`, `shared/`
     and `dist/client`. Vite isn't needed at runtime; the server only loads it
     in development. The slim image is Debian-based, so the precompiled
     binaries of `argon2` and `better-sqlite3` work. Alpine would often need
     them compiled from source.
  - `npm ci` runs with `--ignore-scripts` in both stages: those precompiled
    binaries are loaded at runtime, so no package needs to run code while it
    is installed (npm would otherwise try to compile `better-sqlite3`, which
    needs Python and a compiler).
- **Runs as the non-root `node` user**, so someone who breaks into the process
  isn't root in the container.
- **Starts with `node server/main.ts --production`, not `npm start`.** npm
  doesn't reliably pass SIGTERM on to its child, and without it the shutdown
  handler doesn't run and the server time isn't saved during a deploy.
- Fixed settings in the image: `HOST=0.0.0.0` (inside a container,
  `127.0.0.1` can't be reached from outside) and `DATA_DIR=/data`, where the
  volume is mounted.
- **The base image version is pinned**, and Dependabot watches it too, so
  Node security updates arrive as pull requests.
- **CI builds and starts the image on every pull request**, without storing
  it. It checks that the game responds, that the database is created in the
  volume, and that the server stops cleanly on SIGTERM, so a broken Dockerfile
  shows up in the pull request instead of during a release.

### Publishing

- **The deploy is a separate job that waits for approval**: it uses a GitHub
  environment named `production` with the owner as required reviewer. After
  the version is built, the run shows a "Review deployments" button; this is
  the "publish now" button. Approving tells Hostim to run that exact image.
- **Deploying stops the old container before the new one starts**, so only
  one server ever uses the database. The game is down for a few seconds.
  That's fine: downtime pauses game time (see Turn timing), clients reconnect
  on their own, and open tabs reload to the new version.
- **The deploy job uses Hostim's CLI**: `hostim deploy game --docker-image
  ghcr.io/dilbe/clientservertest:<version>`. Hostim then pulls that image from
  GHCR itself. The CLI is pinned to a version and its download is checked
  against the published checksum, because it runs with the Hostim token.
- Before deploying, the job checks without logging in that the image exists,
  which also shows that it is public (as Hostim needs).
- After the deploy, the workflow checks that the game responds with the new
  version at its public address (from `/version.json`).

### Configuration and secrets

- `PUBLIC_ORIGIN`, `TRUST_PROXY` and `CONTACT_EMAIL` aren't secrets (the
  email address is shown on a public page anyway). They are set as the app's
  environment variables on Hostim, and the README lists the production
  values, so they stay reviewable.
- **The only secret is Hostim's API token.** It is stored as a secret of the
  `production` environment, so only the approved deploy job gets it.
  - A Hostim token seems to give access to the whole account, not just this
    app. So the account holds only this game, and a leaked token can't reach
    anything else.
- **Workflow permissions are split.** The repository is public, so anyone can
  open a pull request, and a workflow runs code from that pull request.
  - CI on pull requests stays read-only and gets no secrets.
  - Only the release workflow may create tags and store images, and it only
    runs on release branches.
  - Only the deploy job, after approval, gets the deploy token.

### Database updates

- **Migrations run when the server starts**, as they do now. With one
  instance that is the same moment as a separate "update the database" step
  in the release, and only the server's container can reach the volume.
- **Before running pending migrations, the server copies the database file**,
  for example to `game.db.before-1.2.0`, using SQLite's backup function (safe
  while the database is open).
- **Migrations only add** (tables, columns, indexes). They never rename or
  drop. Then the previous version still works on the newer database.

### Rolling back

- **Deploy the previous version again** with the manual "Run workflow" button
  of the deploy workflow, giving the version. Nothing is rebuilt: it is the
  exact image that ran before. Because migrations only add, this is usually
  all that's needed.
- **If the database itself must go back**, an admin script restores the copy
  made before the migration. Everything since the deploy (new accounts, game
  turns) is lost then, so it is for emergencies only.
- Unlike Entity Framework, there are no `Down()` migrations: for one SQLite
  file, restoring the copy is simpler and can't be wrong.

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

- **The rules layer is pure**: `resolveTurn(state, characterId, plans) → { newState, events }`,
  where `characterId` is the character whose turn fired.
  Given the same input it always gives the same output, and it has no
  dependencies on anything else. This makes it easy to test, and lets the
  client reuse it for the preview.
- The game manager uses the rules layer; the edges call the game manager. The
  rules layer never calls outward.

## Turn timing

- **The timer lives in the app.** No external scheduler.
- **The cycle length belongs to the game**: the turn duration its creator
  chose (design.md, Turns). It is saved in the game's `gameStarted` event,
  so a running game keeps its cycle even if the list of turn durations
  changes in a deploy. There is no server-wide setting for it any more;
  tests can give every game a short cycle instead, so they don't have to
  wait.
- **One central timer for all games.** It ticks every second, and on each tick
  resolves the turns that are due in every running game.
- **Turn scheduling is data.** Each game's next turn time follows from its
  stored state, so it doesn't depend on a timer that only exists in memory.
- **Downtime pauses the game clock.** While the server is down (deploy, crash),
  game time stands still. After a restart, every game continues where it was,
  with the same time left until the next turn as when the server stopped.
  - The server keeps a **server time**: how long it has been running,
    summed over all its runs. Each game keeps its own **game time** (the
    server time since its start), which therefore only advances while the
    server runs.
  - The server time is saved every 5 seconds (a heartbeat), with every
    game start and turn, and on a normal shutdown (SIGTERM or SIGINT).
    After a restart it continues from the saved value, so the downtime
    doesn't count. After a crash, the time since the last save is lost (at
    most 5 seconds); because it is saved with every turn, it never goes back
    to before a turn that was already resolved.
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
| Dungeons won per account | After a first win of a dungeon | Table |
| Characters | After each finished dungeon, and on the character page | Table, mostly JSON (see below) |
| Running games | Every turn and plan change | Event store |
| Server heartbeat | Every few seconds | A single row |

### Characters

Characters will hold a lot of nested data that keeps growing as stats, skills,
unlocks and objectives are added (compare the save data in Demo-game).

- **A `characters` table** with ordinary columns for what is looked up or
  filtered on (id, account, number within the account, timestamps), plus
  **one JSON column with the rest of the character**.
- **A character's name is in the JSON, and only when the player chose
  one.** Without it, the name shown is "<class> <number>", worked out by
  shared code (`shared/characters.ts`). Storing the default would be storing
  what follows from other facts: it would go stale if the class ever
  changed. Names aren't looked up or checked for uniqueness, so they need
  no column of their own.
- **In a game, characters are shown by name** next to the player's display
  name. Like the display name, the name isn't stored in the game's events:
  the server reads it from the character record when the game starts or is
  rebuilt. Renaming isn't possible during a game, so it can't change
  underneath one.
- **The JSON stores facts, not what follows from them**: class, rank, total
  XP, every upgrade bought with **what was paid for it**, and **how often it
  killed each monster** (per dungeon id, difficulty id and the monster's
  place in the dungeon's list; see `design.md`, Diminishing returns). Level, upgrade
  points left and current stats are worked out from those whenever they're
  needed, by shared code (`shared/rules`), so client and server agree.
  Storing the level or the points left as well would let them drift out of
  step with the XP; with one source of truth they can't. (Compare a computed
  property in .NET instead of a stored field that has to be kept in sync.)
- **Balance changes and existing characters:**
  - A change to the **upgrade costs** only affects upgrades bought after it.
    Upgrades already bought keep what was paid for them; that price is a
    fact from the moment of buying, which is why it's stored instead of
    worked out from today's costs.
  - A change to the **XP curve** applies at once, since the level is worked
    out from the total XP. A flatter curve can leave a character with more
    XP than its max level needs; the stored XP is kept as it is, so it is
    not checked against the max level when loaded.
  - **Safety net**: if a balance change ever leaves a character with more
    points spent than its level has earned (for example after a steeper XP
    curve lowered its level), its upgrades are **reset for free** when it's
    loaded: it keeps its level and gets all its points back to spend again.
- **The JSON has a version number.** When its shape changes, a small upgrade
  function converts older versions when they're loaded, the same way
  Demo-game converts old saves.
- **Character data is checked when loaded**, so a bad or outdated record is
  caught at once instead of causing odd behaviour later.
- **An account is in at most one running dungeon** (see `design.md`). The
  server checks this when an account joins a party; otherwise two dungeons
  would each start from the same character record and the last to finish
  would overwrite the other's rewards.
- **A running game refers to characters by their number within the game**
  (1, 2, 3, ..., in initiative order), never by account or database id.
  - The rules, the events and every message to clients use only these
    numbers. Database ids and account ids never leave the server, so other
    players can't recognise someone across games by an id.
  - The server keeps the link from each number to its character record and
    account. That link is used for the server's own checks (does this plan
    come from the character's player?) and for writing rewards at the end.
  - Each player's snapshot says which numbers are theirs.
  - Hiding ids is not a security control on its own: the server decides
    what a connection may do from its session, never from an id the client
    sends.
  - **A plan may have no more actions than the character's actions stat.**
    The message schema caps every plan at a fixed maximum, and the game
    manager checks the character's own stat. A modified client could
    otherwise store and show long plans to everyone, even though the rules
    would only carry out the first ones.
  - **Choosing characters happens in the lobby** (create, join, and change
    the choice until the start). The client sends the characters' numbers
    within the account; the server looks them up in the player's own
    account, so a number the account doesn't have is refused. The lobby
    checks the limits: 1 to 3 per player, and no more than the dungeon
    allows together. When the game starts, the chosen characters are read
    from the database again, and each gets its own number in the game.
- **Character page actions** (rename, buy an adventurer, upgrade a stat,
  reset upgrades, rank up) are **HTTP requests**, like the account actions: they
  aren't live, and nothing else needs to see them happen.
  - **The server checks every rule itself**: the characters belong to the
    account, the account isn't in a game, the stat can be upgraded, there are
    enough upgrade points or silver, the rank-up characters are at their max level. The client only
    shows what's possible; a modified client can send anything.
  - **The request names what it wants, never what it costs**: "upgrade
    attack damage of character 3", not "spend 15 points". The server works out
    the cost.
  - **Each action is one database transaction**, so a crash can never take
    the silver without adding the character, or remove one rank-up character
    without the other.
  - There is no technical cap on characters per account: each bought
    character costs more silver than the last, and silver only comes from
    winning dungeons, so a script can't create characters faster than it can
    win games.
- **Kill counts and the XP they leave** (issue #97):
  - The counts are facts, so they are stored; the XP a monster still gives
    follows from them and is worked out by shared code
    (`shared/rules/diminishing-returns.ts`), like the level from the XP.
  - When a game starts, each character's counts for that dungeon and
    difficulty are **copied into the game's state**, like the most XP it can
    gain. The rules give XP per kill from that copy, and the counts are
    added to the record when the game ends, with the XP.
  - **The party screen's XP percentage is worked out by the server** each
    time it sends the lobby, from the character records, and only for the
    player's own open game. The percentage is the only thing that leaves
    the server: other players in the party see it, but not the kill counts
    themselves. (Once the game starts, the game's state holds the counts of
    every character in it, as it holds their stats.)
- **During a dungeon, the character record isn't touched.** The dungeon's
  state (HP, cooldowns, buffs, the XP gained so far) lives in the game's
  event store. The record is only updated when the dungeon ends, with the
  rewards: the XP and the kills go to the character records and, after a
  win, the silver to the accounts and the one-time rewards to the players
  who won the dungeon for the first time, **in the same transaction as the turn that
  ended the game**. So a crash can't lose the rewards, and rebuilding the game
  after a restart (which only applies its events) never pays them twice.

### Dungeons won

- **A `dungeons_won` table**: one row per account, dungeon and difficulty
  it has won at least once. It decides who gets a dungeon's one-time rewards
  (see `design.md`, Rewards), and what a player can play (see `design.md`,
  Unlocking dungeons). Wins from before difficulties existed were moved to
  Normal by the migration.
- **Unlocks are never stored**: `shared/rules/difficulties.ts` works them out
  from the wins each time, on the server to check a host's choice and in the
  browser to draw the dungeon map. The same code on both sides, like the
  game rules. Storing "unlocked up to dungeon 3" as well would be a second
  copy of the truth that can drift from the wins, for example when a dungeon
  is added to the end of the list.
- **The server checks the host's choice** of dungeon and difficulty against
  the host's own wins (`lobby.ts`). The dungeon map only offers what the
  host can play, but a public server gets requests from any program, not
  only from our page, so a hidden or disabled button is never a check.
- **Each dungeon and difficulty has a fixed id** (`shared/rules/dungeon-map.ts`,
  `shared/rules/difficulties.ts`), and the table refers to them. **An id
  never changes or is reused once in use**; renaming a dungeon changes its
  name, not its id. (Like a primary key that other tables point to, except
  that the "table" of dungeons is code.)
- **Who wins it for the first time (on the game's difficulty) is decided
  when the game starts** and saved in the game's start event, as character
  numbers. That is safe because an account is in at most one game: nothing
  else can win the dungeon for it before the game ends. It also lets a
  player who comes back after a restart still see what they received.
- **The win and the rewards are written together**, in the transaction of
  the turn that ended the game (see Characters). Recording the win only
  inserts a row that isn't there yet, and the rewards are only given when
  it did, so even a bug can't give them twice.

### Event store for running games

- **One append-only table**: game id, sequence number, event type, event data
  (JSON) and timestamp. Game id and sequence number are unique together.
- **Events use game-local character numbers** (see Characters). A separate
  table links each game's numbers to character records and accounts; it is
  the only place that ties a stored game to people.
- **It stores results, not inputs**: "A attacked monster 2 for 1", not "A
  planned to attack". Replaying never runs the rules, so a rule change in a
  deploy can't change a running game's history.
- **Setting up the initiative track is an event** with the resulting order,
  not a random seed. It holds the whole state at the start and the time of
  each character's first turn.
- **Plan changes are events too**, so plans survive a restart.
- **Each turn is one event** with everything that happened in it, when
  the character that acted is due again, and its follow-up plan, if any
  (design.md, Keeping a monster targeted). The follow-up plan is a rule
  result like the rest, so it is stored instead of worked out again on
  replay.
- **Cooldowns are kept by events too** (design.md, Heavy strike): using an
  ability stores that its cooldown started and for how many turns, and
  every turn of a character with a cooldown running starts with an event
  that counts it down. So replaying needs neither the rules nor today's
  cooldown lengths.
- **Closing a game is an event**: when its last player has gone back to the
  lobby (or it broke). Closed games aren't loaded on startup. The link
  table also records which players have gone back to the lobby, so they
  aren't put back in the game after a restart.
- **Stored events are checked when they are loaded**, like character data.
  A game whose events don't pass is closed and logged, so it can't keep the
  server from starting.
- **When the shape of an event changes, an upgrade step converts the old
  shape on load** (`upgradeEvent` in `server/game-store.ts`), so a deploy
  doesn't end the games that are running. Rows are never rewritten: the
  upgrade happens in memory, every time a game is loaded.
- **In memory**, the server keeps each running game's current state. On
  startup it rebuilds that state by applying the game's events. The database
  is the source of truth; memory is the working copy. The lobby is filled
  again with the players of those games, so they find their game when they
  reconnect.
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

- **HTTP** for the client files, account actions (register, log in, log
  out, change display name) and character page actions (see Characters).
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
| Client → server | Set plan (a list of actions), clear plan, ask for a new snapshot, lobby actions (create, join, choose characters, choose dungeon, leave, start, ask for a new lobby) |
| Server → client | Snapshot (full state), turn resolved (events, next turn times and the follow-up plan of the character that acted), plan changed (another player's plan, sent live on every change), lobby updates |

### Keeping the client in sync

- **On every connect the client gets a full snapshot**: first load, reconnect
  and server restart all work the same way.
- After that only events arrive, each with the game's **sequence number**. If
  the client sees a gap, it asks for a new snapshot. That request names no
  game: the server sends the game of the logged-in account.
- **The preview runs in the client**, using the shared rules code on the
  snapshot and the current plans. The server isn't involved. It gives both
  what the monsters will do and which planned actions will be cancelled.
- **A finished game stays in memory**, its clock stopped, until the last
  player has gone back to the lobby. So a player who reconnects after the end
  still gets a snapshot with the result. Going back to the lobby is the same
  "leave" message as leaving an open game.
- **Turn times are sent as "next turn in N seconds"**, not as a clock time,
  because phone clocks can be off. The client counts down from that.
- **The lobby is simpler**: it is small, so after every change each player
  gets the whole lobby again instead of events. It lives only in memory; a
  server restart empties it, and players form their party again.
  Each player's copy also lists their own characters to choose from. Those
  can change on the character page, which is HTTP and pushes nothing, so the
  client asks for a new lobby when it comes back from that page.

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
| Characters (name, class, rank, XP, upgrades), silver and the dungeons won | Database |
| Game events, with game-local character numbers; linked to accounts only through the server's link table | Event store |
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
    characters, and removes its rows from the table that links games to
    characters. Its events in kept games then no longer point to anyone, so
    the events themselves don't need rewriting. Automating this is
    on the Later list.
- **A copy of a player's data** is given on request by email, within a month,
  using an admin script that exports the account as JSON.

## Later

Worked out later; written down so they aren't forgotten.

- **Database backups.** Everything lives in one file on one volume. The copy
  before each migration (see Releases) and whatever Hostim offers for volumes
  are the only backups for now. Options for better ones: a periodic copy to
  object storage, or continuous replication (Litestream).
- **Deleting marked accounts automatically**, for example a set number of
  days after the mark.
- **Retention of finished games**, especially when accounts can be deleted
  (the events are linked to accounts, so they are personal data).
- **Removing a finished game at once** (revisit with #23). For now a won or
  lost game stays in memory until its last player has gone back to the
  lobby, so a player who was offline at the end still sees the result. Once
  finished games are stored, the server could remove the game the moment it
  ends, free every account at once, and show a returning player their last
  result from the history instead (for example "Your last game: lost" in the
  lobby). The client would then keep showing the game until its player has
  seen the playback and the result.
