# Spec 11: Testing, Observability, and Operations

## Goal
Ensure reliability, debuggability, and safe operation for ingestion and rendering features.

## Test Strategy
Tooling: Vitest for unit/integration tests; React Testing Library for UI/component tests.

### Unit Tests
- Schema validation success/failure.
- Step compaction correctness.
- Pantry classifier behavior.
- Tag normalizer behavior.
- Ingredient image matching determinism.

### Integration Tests
- URL ingestion happy path.
- URL ingestion failure path.
- Manual ingestion with/without images.
- Image re-hosting behavior.
- End-to-end canonical output shape.

### UI Tests
- Tab switching and form submission.
- Error and warning display.
- JSON export includes edits.
- Card rendering with missing images.

## Observability
- Structured logs for each ingestion stage, via a `logStage` helper (stages:
  fetch, extract, host-images, normalize, post-process, image-rehost).
- requestId propagation frontend <-> backend (`x-request-id` header).
- Metrics: deferred - stage logs only for now; per-stage rates (extraction
  success, schema failure, image match fallback) are derivable from logs
  when needed rather than computed separately.

## Operational Guardrails
- External request timeouts.
- Retry policy for transient failures.
- Rate limits for ingest endpoints: in-memory fixed-window limiter on
  `/api/ingest/*` only, configured via `RATE_LIMIT_MAX` (default 10) and
  `RATE_LIMIT_WINDOW_MS` (default 60000); 429 responses use the
  `RATE_LIMITED` error code.
- Input size limits for text and files.

## Authentication Settings
| Variable | Default | Meaning |
|---|---|---|
| `AUTH_MODE` | `none` | `none`: every request is admin user `local`. `header`: trust the `Remote-User` header from the reverse proxy; 401 `UNAUTHENTICATED` without it (`/api/health` exempt). |
| `ADMIN_USERS` | empty | Comma-separated usernames (trimmed, lowercased) treated as admins in header mode. Empty means nobody is admin. |

With `NODE_ENV=production` and `AUTH_MODE=none` the server logs a startup warning (every request would run as admin `local`).

## Storage Settings
| Variable | Default | Meaning |
|---|---|---|
| `RECIPE_STORE` | `json` | `json`: one file per recipe under `RECIPE_DATA_DIR`. `sqlite`: single SQLite database (spec 13). |
| `RECIPE_DB_PATH` | `./data/db/recipes.db` | SQLite database file, resolved to an absolute path. Only used when `RECIPE_STORE=sqlite`. The readiness check (`/api/health`) uses the selected store's directory. |

Startup (and `/api/health`) creates and checks both the recipe storage directory and `IMAGE_DATA_DIR` for write access; the error log names the failing one.

## Web App Serving and Docker
| Variable | Default | Meaning |
|---|---|---|
| `WEB_DIST_DIR` | unset | Directory of the built web app. When set, the server serves its files and falls back to `index.html` for other GETs. Misses stay a JSON 404 for `/api`, `/images`, `/ingredient-images`, `/health` (the path or anything below it), `/assets/*`, and any path whose last segment has a file extension. Unset in local dev. The Docker image sets it to `/app/apps/web/dist`. |

The default recipe placeholder (`server/assets/placeholder-recipe.png`) is served at `/images/placeholder-recipe.png` and is the main-image default when `DEFAULT_MAIN_IMAGE_URL` is unset.

The Docker image defaults to `AUTH_MODE=header`, `RECIPE_STORE=sqlite`, `RECIPE_DB_PATH=/app/data/db/recipes.db` and `IMAGE_DATA_DIR=/app/data/images`; mounted host directories must be writable by uid 1001 (`pwuser`). The base image tag must match the installed `playwright` version (`PLAYWRIGHT_VERSION` build arg); `server/src/docker-playwright-version.test.ts` fails when they differ. The `HEALTHCHECK` is healthy only when `/api/health` reports `"storage":"ready"` (the route answers 200 either way) and prints the reason when a probe fails. `docker-compose.example.yml` and `docker.env.example` show a deployment behind tinyauth: the app gets an explicit `environment:` list (tinyauth's user hashes stay out of it), `init: true` and `stop_grace_period: 45s`; tinyauth is pinned to `v5.2.0` with `TINYAUTH_LABELPROVIDER: none` and a `tinyauth-data` named volume (sessions survive `docker compose down`).

`scripts/docker-smoke-test.sh <image>` starts the image with empty volumes and the image's default `AUTH_MODE`, waits for Docker's own `HEALTHCHECK` to report healthy, and checks `"storage":"ready"` from `/api/health`, the web app at `/` and a JS bundle it references, `/api/me` returning 401 without a header, admin identity via `Remote-User`, and an empty recipe list. Every curl has a 10 s timeout and a failing check prints its name and the response body.

## CI Image Job
The `image` job in `.github/workflows/ci.yml` needs the `test` job and runs only on push to `main`, on `ubuntu-24.04-arm`, and only when the push changes something besides docs: a small `changes` job diffs the push and skips the build when every changed file is under `docs/`, a top-level `*.md`, `LICENSE` or `.github/dependabot.yml` (any other or unknown file, or a failed diff, means a build). This keeps docs-only merges from publishing a GHCR version and pushing an older one out of the 10 kept. It builds `linux/arm64` into the local daemon (provenance disabled, so one push is one GHCR version), runs the smoke test against that image, pushes that same image as `ghcr.io/<owner>/recipe-maker:latest` and `:sha-<short>` with `docker push`, and prunes the package to the last 10 versions. The job has a 30-minute timeout and a concurrency group so publishes run one at a time. The workflow token is read-only except for the image job's `packages: write`; actions are pinned to commit SHAs and `.github/dependabot.yml` keeps them current with one grouped PR per month (one image build per batch). Tests themselves run on Node 22; the image ships Node 24.

## Gemini Usage Controls
- Configurable model selection.
- Token budget controls per request.
- Single fixed retry against `GEMINI_RETRY_MODEL` on failure/timeout (not a
  configurable retry count).

## Release Gates
- All critical tests passing.
- No blocker-level unresolved known issues.
- Performance thresholds deferred (no representative fixture set benchmark yet).

## Acceptance Criteria
- Reproducible test suite in CI.
- Actionable logs for all production errors.
- Stable ingestion behavior under expected load.