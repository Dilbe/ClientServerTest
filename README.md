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

## Settings

Settings come from environment variables:

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | 3000 | Port to listen on |
| `HOST` | 127.0.0.1 | Address to listen on; `0.0.0.0` for all network interfaces |
| `DATA_DIR` | `data` | Folder for the SQLite database (`game.db`) |
| `PUBLIC_ORIGIN` | (none) | The address players use, like `https://game.example.com`. Requests from pages on any other address are refused. Set this in production. |
| `TRUST_PROXY` | (off) | `1` when running behind the hosting platform's proxy, so the player's address is read from `X-Forwarded-For`. Never set it without such a proxy: anyone could then fake their address. |
| `CONTACT_EMAIL` | (none) | Shown on the "what we store" page |

In production the session cookie is marked `Secure`, so browsers only send
it over HTTPS (and to `localhost`). In development it isn't, so logging in
also works from a phone over plain `http://` on your network.

## Checks

```bash
npm run typecheck   # TypeScript type checking of server and client
npm test            # unit and integration tests (Node's built-in test runner)
```

GitHub Actions runs `npm ci`, both checks and `npm run build` on every pull
request and every push to `main` (`.github/workflows/ci.yml`). The result
shows as a check on the pull request.
