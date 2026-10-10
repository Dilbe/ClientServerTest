# Dungeon Crawler

A small co-op dungeon crawler, built as a learning project: an authoritative
Node.js server and a browser client, both in TypeScript.

- `design.md`: what the game does for the player.
- `architecture.md`: how it is built.
- `CLAUDE.md`: how we work on it.

## Folders

```
shared/   code used by both server and client (message schemas, game rules in shared/rules/)
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

## Container image

The game runs in production as a container (see `Dockerfile` and
`architecture.md`, Releases). To build and try the image locally, with
[Docker](https://www.docker.com/) installed:

```bash
docker build --build-arg APP_VERSION=0.0.0-local -t dungeon-crawler .
docker run --rm -p 3000:3000 -v dungeon-data:/data dungeon-crawler
```

Then open http://localhost:3000. The database lives in the Docker volume
`dungeon-data`, so it survives stopping the container. CI builds and starts
the image on every pull request too.

## Settings

Settings come from environment variables:

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | 3000 | Port to listen on |
| `HOST` | 127.0.0.1 | Address to listen on; `0.0.0.0` for all network interfaces |
| `DATA_DIR` | `data` | Folder for the SQLite database (`game.db`) |
| `PUBLIC_ORIGIN` | (none) | The address players use, like `https://game.example.com`. Requests from pages on any other address are refused. Set this in production. |
| `TRUST_PROXY` | (off) | `1` when running behind the hosting platform's proxy, so the player's address is read from `X-Forwarded-For`. Exactly one proxy is trusted: only the last address in that header (the one the proxy added) counts. Never set it without such a proxy: anyone could then fake their address. |
| `CONTACT_EMAIL` | (none) | Shown on the "what we store" page |
| `RESTORE_DATABASE` | (none) | Only for emergencies: a copy to restore on startup, like `game.db.before-step-9`. Remove it right after. See Restoring the database. |

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

## Releases

How it works and why is in `architecture.md` (Releases). In short: a push to a
release branch creates a numbered version, stores its container image in
GitHub's container registry (GHCR) and then waits for approval to publish it.

### Making a release

1. Create the release branch from `main` and push it, for example for 0.2:

   ```bash
   git switch main && git pull
   git switch -c releases/0.2
   git push -u origin releases/0.2
   ```

2. The push starts the **Release** workflow (GitHub → Actions). It runs the
   checks, creates the tag `v0.2.0` and stores the image
   `ghcr.io/dilbe/clientservertest:0.2.0`.
3. **Publishing:** the run then waits at the deploy job. Open the run and
   click **Review deployments** → `production` → **Approve and deploy**. Hostim
   then runs the new version, and the job checks that the game answers with
   it at its public address. Not approving (or rejecting) leaves the running
   version as it is; the image stays available to publish later.

### Hotfixes

Make the fix in a pull request into the release branch (like
`releases/0.2`). Merging it pushes to the branch, which creates the next patch
version (`v0.2.1`) and waits for approval again. Make the same fix in `main`
too, so the next release has it.

### Rolling back

GitHub → Actions → **Deploy** → **Run workflow**, enter the version to go back
to (like `0.2.0`) and approve it. Nothing is rebuilt: Hostim runs the image
that was stored for that version. All stored versions are listed under the
repository's **Packages**.

### Restoring the database

Only for emergencies: everything since the copy was made (new accounts, game
turns) is lost. Before the server runs migrations it copies the database to
the data folder, for example as `game.db.before-step-9`; the startup log names
the copy.

**On Hostim** an app can't be stopped, only restarted, so the server does the
restore itself when it starts, before it opens the database:

1. On the app, add the environment variable `RESTORE_DATABASE` with the name
   of the copy, like `game.db.before-step-9`.
2. Deploy the version from before the migration (see Rolling back above).
   That restart restores the copy. The log says `Restored the database from
   ...` and names the file the replaced database moved to,
   `game.db.replaced-<time>` (nothing is deleted). A newer version would run
   the migrations on the copy again.
3. Remove `RESTORE_DATABASE` again.

Forgetting step 3 can't lose data: a restore leaves a marker file
(`game.db.restored`), and a start that finds it while `RESTORE_DATABASE` is
still set refuses to start, with a message saying to remove the setting. The
first start without the setting removes the marker.

**Where the server can be stopped**, like on your own computer, the script
does the same:

```bash
node server/restore-database.ts game.db.before-step-9
```

Run it with the server stopped, from the folder with the code and with the
same `DATA_DIR` as the server.

### Production settings

The app on Hostim (project `hpr-6585dbb2`, app `dilbes-dungeon-crawl`):

- Image `ghcr.io/dilbe/clientservertest:<version>` (public, no registry
  credentials), 1 replica. Never more: a second copy would run every turn
  twice.
- HTTP port `3000`, health check path `/version.json`.
- A volume mounted at `/data`, which holds the database.
- Environment variables:

| Variable | Value |
|---|---|
| `PUBLIC_ORIGIN` | `https://dungeoncrawl.dilbe.eu` |
| `TRUST_PROXY` | `1` (Hostim's proxy is in front of the game) |
| `CONTACT_EMAIL` | `dontmailme@dilbe.eu` |

`HOST`, `PORT` and `DATA_DIR` are fixed in the image; don't set them on
Hostim. The deploy job also needs `PUBLIC_ORIGIN` (as a variable of the
`production` environment on GitHub) and the secret `HOSTIM_TOKEN` (a secret of
that environment).

The domain `dungeoncrawl.dilbe.eu` is an `A` record at Hostnet pointing to
the address shown on the app's Domains tab on Hostim.
