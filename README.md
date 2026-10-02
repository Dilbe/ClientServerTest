# Dungeon Crawler

A small co-op dungeon crawler, built as a learning project: an authoritative
Node.js server and a browser client, both in TypeScript.

- `design.md`: what the game does for the player.
- `architecture.md`: how it is built.
- `CLAUDE.md`: how we work on it.

## Folders

```
shared/   code used by both server and client (message schemas, later the game rules)
server/   the Node.js server
client/   what runs in the browser
dist/     build output (not in git)
```

## Requirements

Node.js 22.18 or newer. Node runs the server's TypeScript files directly
(it strips the types), so the server needs no build step.

## Install

```bash
npm ci
```

`npm ci` installs exactly the versions in `package-lock.json`. Use
`npm install <package>` only to add or update a package.

## Development

```bash
npm run dev
```

Then open http://localhost:3000. The server restarts when a file in `server/`
or `shared/` changes, and the page reloads when a client file changes.

By default only this computer can connect. To try it on a phone on the same
network, start it with `HOST=0.0.0.0` (PowerShell: `$env:HOST="0.0.0.0"; npm run dev`)
and open `http://<this computer's IP address>:3000` on the phone.

## Production

```bash
npm run build   # bundles the client into dist/client
npm start       # serves dist/client and the WebSocket
```

Settings come from environment variables: `PORT` (default 3000) and `HOST`
(default 127.0.0.1).

## Checks

```bash
npm run typecheck   # TypeScript type checking of server and client
npm test            # unit and integration tests (Node's built-in test runner)
```
