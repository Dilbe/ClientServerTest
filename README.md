# Dungeon Crawler (v0)

A throwaway co-op dungeon crawler test project. Authoritative Node.js/TypeScript
server over WebSockets, plain-JS canvas client running in the browser.

## What v0 does

- Server holds a 20x20 grid and every connected player's position in memory.
- Clients connect over WebSocket, send `move` commands (WASD / arrow keys).
- Server applies moves, clamps to the grid, and broadcasts the full player list
  to everyone 10 times/sec.
- Client renders the grid and all players as colored squares on a `<canvas>`;
  your own square gets a white outline.

No enemies, combat, or persistence yet — this just proves multiple players can
see each other move around in real time.

## Running it

```bash
npm install
npm run dev
```

Then open http://localhost:3000 in a couple of browser tabs (or have a friend
on the same network hit `http://<your-lan-ip>:3000`) to test co-op movement.

## Next steps

- Add a dumb enemy the server moves toward the nearest player each tick.
- Add basic HP + a simple attack command.
- Replace the open grid with actual dungeon walls/rooms.
- Persist a session so a page refresh doesn't spawn a new player.
