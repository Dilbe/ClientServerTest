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

## Turn timing

- **The timer lives in the app.** No external scheduler.
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

## Still to discuss

- The server process (Node.js, the event loop, how game logic is organised).
- Storage: what is stored and where (database, event store per game).
- Shared rules code between client and server, and the client technology.
- Accounts and login.
- Communication between client and server (HTTP, WebSocket, reconnecting).
- Security for the public web.
- Privacy (GDPR): what personal data is stored and logged.
