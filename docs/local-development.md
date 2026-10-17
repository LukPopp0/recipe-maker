# Local development

How to run, test and debug Recipe Maker on a development machine. To run it
on a server for other people, see [self-hosting.md](self-hosting.md). Every
environment variable is listed in [configuration.md](configuration.md).

## Prerequisites

- Node.js 22 or newer.
- pnpm 11. The repo pins `pnpm@11.11.0` in the `packageManager` field, so
  `corepack enable` gives you the right version.
- A Gemini API key (the free tier works): create a project at
  [aistudio.google.com](https://aistudio.google.com) and generate a key. Only
  the two ingest routes need it.

## Install

```bash
corepack enable
pnpm install
pnpm --filter server exec playwright install chromium
```

`pnpm install` also generates the ingredient asset manifest. The Chromium
download (about 115 MB) is only needed for URL ingestion of pages whose recipe
needs client-side JavaScript. To skip it, set `BROWSER_FALLBACK_ENABLED=false`
in `server/.env`; URL ingestion then uses static fetching only.

## Configure

```bash
cp server/.env.example server/.env
```

Edit `server/.env` and set `GEMINI_API_KEY=<your key>`. The server loads this
file itself. Without a key everything except `POST /api/ingest/url` and
`POST /api/ingest/manual` works, and the test suite runs fully because tests
mock Gemini and the network. All other settings have working defaults; see
[configuration.md](configuration.md).

## Run

```bash
pnpm dev
```

This regenerates the manifest and starts both dev servers:

- Web (Vite): http://localhost:5173/ (Vite prints the actual URL; it picks
  the next free port if 5173 is taken).
- API (Hono): port 8787 (`PORT`), for example
  `curl http://127.0.0.1:8787/api/health`.

Vite proxies `/api`, `/images` and `/ingredient-images` to the API, so there
is no CORS setup; open the Vite URL only. To run one half, use
`pnpm --filter web run dev` or `pnpm --filter server run dev` (watch mode;
`pnpm --filter server run start` runs once).

## Tests

```bash
pnpm typecheck
pnpm test
```

Both run across all workspace packages. `pnpm lint` runs ESLint. To run one
file:

```bash
pnpm --filter server exec vitest run src/docker-playwright-version.test.ts
pnpm --filter web exec vitest run src/<path>
```

Paths are relative to the package. The tests need no network, no API key and
no Chromium download.

Other scripts: `pnpm build` (manifest plus build of all packages),
`pnpm generate:manifest`, and `pnpm --filter <web|server> run <script>` for a
single package.

## Storage

By default recipes are JSON files, one per recipe, in `server/data/recipes/`,
and images are on disk in `server/data/images/` (all gitignored). To try the
SQLite store that production uses, start the server with:

```bash
RECIPE_STORE=sqlite pnpm --filter server run dev
```

or set `RECIPE_STORE=sqlite` in `server/.env`. The database is created at
`RECIPE_DB_PATH` (default `./data/db/recipes.db`, relative to `server/`); the
directory is created for you. The two stores do not share data: recipes saved
as JSON files do not show up in SQLite and vice versa. Delete `server/data/`
to start over.

## Auth locally

By default `AUTH_MODE=none`: every request runs as the user `local`, who is an
admin. There is no login, so nothing else is needed.

To test multi-user behavior (owners, "My recipes" versus "All", delete limited
to the owner or an admin), the server can trust the `Remote-User` header that a
reverse proxy sets in production. Start it with:

```bash
AUTH_MODE=header ADMIN_USERS=alice pnpm --filter server run dev
```

Then send the header yourself with `curl`:

```bash
curl -s -H 'Remote-User: alice' http://127.0.0.1:8787/api/me
# {"ok":true,"requestId":"...","user":{"username":"alice","isAdmin":true}}

curl -s -H 'Remote-User: bob' http://127.0.0.1:8787/api/me
# {"ok":true,"requestId":"...","user":{"username":"bob","isAdmin":false}}

curl -s -w '\n%{http_code}\n' http://127.0.0.1:8787/api/me
# {"ok":false,"requestId":"...","error":{"code":"UNAUTHENTICATED","message":"You are not logged in."}}
# 401
```

`/api/health` needs no header. The browser cannot send `Remote-User`, so to
use the web UI in this mode use a browser extension that adds the header, or
put a small local proxy in front. Never use `AUTH_MODE=header` with the port
reachable from other machines: anyone could claim to be any user.

## Docker image

The image bundles the API, the built web app and Chromium. Build and check it
locally:

```bash
docker build -t recipe-maker .
scripts/docker-smoke-test.sh recipe-maker
```

The smoke test starts the image with empty volumes, checks that it serves the
API and the web app, and prints `smoke test passed`. The build is large
(several GB, because of the Playwright base image) and slow the first time.

The published image on GHCR is `linux/arm64` only. On an x86 machine, build it
yourself as above; the build uses your machine's architecture. For running it
on a server, see [self-hosting.md](self-hosting.md).

### Playwright version coupling

The image takes Chromium from the Playwright base image, so `ARG
PLAYWRIGHT_VERSION` in the `Dockerfile` must equal the installed `playwright`
package version. When you upgrade `playwright`, change the Dockerfile too.
`server/src/docker-playwright-version.test.ts` compares the two and fails
`pnpm test` if they differ.
