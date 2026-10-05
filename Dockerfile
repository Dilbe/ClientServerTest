# The container image of the game server (architecture.md, Releases → The
# container image). Built by the release workflow; to try it locally:
#
#   docker build -t dungeon-crawler .
#   docker run --rm -p 3000:3000 -v dungeon-data:/data dungeon-crawler
#
# The base image version is pinned, and Dependabot proposes updates. Debian
# "bookworm" is named too, so a new Debian release never arrives unannounced.
# "slim" is a smaller Debian without compilers and manuals. It is still glibc
# based, so the precompiled binaries of argon2 and better-sqlite3 work.
# Both stages use the same base image; Dependabot updates both lines.

# ---- Stage 1: build ---------------------------------------------------------
# Has all dependencies, including the development ones (Vite, TypeScript), and
# bundles the client into dist/client. Nothing of this stage ends up in the
# final image except the files copied out of it below.
FROM node:22.23.3-bookworm-slim AS build
WORKDIR /app

# Copy only the package files first and install. Docker caches every step, so
# as long as the package files don't change, the slow install is reused.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# The release workflow passes the version (like 0.2.0). Vite compiles it into
# the client and writes it into version.json.
ARG APP_VERSION
RUN test -n "$APP_VERSION" || (echo "Build with --build-arg APP_VERSION=<version>" && exit 1)
RUN APP_VERSION="$APP_VERSION" npm run build

# ---- Stage 2: runtime -------------------------------------------------------
FROM node:22.23.3-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server/ server/
COPY shared/ shared/
COPY --from=build /app/dist/client dist/client

# Fixed settings. Inside a container 127.0.0.1 can't be reached from outside,
# so listen on all interfaces. The volume with the database is mounted at /data.
ENV HOST=0.0.0.0 PORT=3000 DATA_DIR=/data
# /data is owned by the node user, so a new, empty volume mounted there is
# writable for the server too. (Docker copies the folder's owner onto an empty
# volume.)
RUN mkdir /data && chown node:node /data
VOLUME /data
EXPOSE 3000

# The version as a label: the container's version in "file properties".
# `docker image inspect` shows it.
ARG APP_VERSION
LABEL org.opencontainers.image.version="$APP_VERSION" \
      org.opencontainers.image.title="Dungeon Crawler" \
      org.opencontainers.image.source="https://github.com/Dilbe/ClientServerTest"

# Not root: someone who breaks into the server process can't change the image's
# files or install anything. The node user comes with the base image.
USER node

# node itself, not `npm start`: npm doesn't reliably pass SIGTERM on, and the
# server needs it to save the server time when a deploy stops it.
CMD ["node", "server/main.ts", "--production"]
