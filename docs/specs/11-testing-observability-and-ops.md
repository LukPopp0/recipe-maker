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
| `WEB_DIST_DIR` | unset | Directory of the built web app. When set, the server serves its files and falls back to `index.html` for other GETs (never under `/api/`, `/images/`, `/ingredient-images/`, `/health`). Unset in local dev. The Docker image sets it to `/app/apps/web/dist`. |

The default recipe placeholder (`server/assets/placeholder-recipe.png`) is served at `/images/placeholder-recipe.png` and is the main-image default when `DEFAULT_MAIN_IMAGE_URL` is unset.

The Docker image defaults to `RECIPE_STORE=sqlite`, `RECIPE_DB_PATH=/app/data/db/recipes.db` and `IMAGE_DATA_DIR=/app/data/images`; mounted host directories must be writable by uid 1001 (`pwuser`). The base image tag must match the installed `playwright` version (`PLAYWRIGHT_VERSION` build arg). `docker-compose.example.yml` and `docker.env.example` show a deployment behind tinyauth.

`scripts/docker-smoke-test.sh <image>` starts the image with empty volumes and `AUTH_MODE=header` and checks `/api/health`, the web app at `/`, `/api/me` returning 401 without a header, admin identity via `Remote-User`, and an empty recipe list.

## CI Image Job
The `image` job in `.github/workflows/ci.yml` needs the `test` job and runs only on push to `main`, on `ubuntu-24.04-arm`. It builds `linux/arm64`, runs the smoke test against the built image, then pushes `ghcr.io/<owner>/recipe-maker:latest` and `:sha-<short>` with provenance disabled (one push is one GHCR version) and prunes the package to the last 10 versions. Tests themselves run on Node 22; the image ships Node 24.

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