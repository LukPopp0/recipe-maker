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

## Storage Settings
| Variable | Default | Meaning |
|---|---|---|
| `RECIPE_STORE` | `json` | `json`: one file per recipe under `server/data/recipes`. `sqlite`: single SQLite database (spec 13). |
| `RECIPE_DB_PATH` | `./data/db/recipes.db` | SQLite database file, resolved to an absolute path. Only used when `RECIPE_STORE=sqlite`. The readiness check (`/api/health`) uses the selected store's directory. |

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