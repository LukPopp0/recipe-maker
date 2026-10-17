# CLAUDE.md

## Project
Recipe Maker: ingests recipes (URL or manual text+images) via Gemini, normalizes to a
canonical JSON schema (max 6 steps, pantry split, ingredient image matching), lets the
user save/browse recipes, and renders a printable two-page recipe card.

## Status
Phases 0-7 are done: repo cleanup, shared contracts, both ingestion pipelines
(`/api/ingest/url`, `/api/ingest/manual`), ingredient image matching, recipe CRUD
routes, Milestone 1 frontend (Create workspace with URL/Manual/Load JSON
tabs, editable review panel with thumbnails, JSON viewer/download, explicit Save),
Library UI (list/view read-only, download, delete, Open in Create), and
Milestone 2 card rendering (printable two-page letter-size recipe card, print/
save-PDF via `window.print`, Library "View as Card" and Create "Preview Card").
Phase 5.5 hardened URL ingestion: JSON-LD extraction, Playwright browser fallback,
explicit URL_FETCH_BLOCKED/URL_FETCH_FAILED errors (see plan addendum + docs/specs/04).
Phase 7.5 added the landscape (default) card orientation with a portrait
toggle and self-hosted Inter/D-DIN fonts (docs/specs/10 Landscape Variant).
Phase 8 (quality/testing/hardening) is done: RATE_LIMITED (429) in-memory
fixed-window rate limiter on `/api/ingest/*` only (`RATE_LIMIT_MAX`,
`RATE_LIMIT_WINDOW_MS`); per-stage structured logs via `logStage`
(fetch/extract/host-images/normalize/post-process/image-rehost), metrics
deferred; golden-fixture integration tests for URL (happy, JSON-LD, blocked,
non-recipe, timeout) and manual (with/without step images) flows, Load JSON
stays frontend-tested; `GEMINI_MAX_RETRIES` removed in favor of a fixed
single retry via `GEMINI_RETRY_MODEL`; CI (`.github/workflows/ci.yml`) runs
install/typecheck/test with Playwright mocked.
Phase 8.5 fix backlog from end-to-end testing:
`private/plans/mvp/phase-8.5-fixes-and-improvements.md` (check items off as fixed).
Phase 10 (docs/specs/14) is done: URL ingestion extracts step images (JSON-LD
HowToStep.image overlay + Gemini candidate mapping, prompt v4, re-hosted like
main_image), ingest responses return `imageNamespaceId`, `POST /api/image/step`
uploads a step image from the review panel (upload-only, per-step thumbnail),
and a "Copy image prompt" button copies a generation prompt for Gemini's web
UI (server-side AI image generation rejected - no API free tier).
Deployment and multi-user work (phases D1-D7) is planned in
`private/plans/deployment/` (start at `00-overview.md`; spec
`private/specs/deployment-and-multi-user.md`). Outstanding items that are not
in any plan: `private/plans/backlog.md`.
Deployment D1 (auth and users) is done: `AUTH_MODE`/`ADMIN_USERS` middleware on
`/api/*`, `GET /api/me`, UNAUTHENTICATED/FORBIDDEN errors, username in the header.
Deployment D2 (storage and ownership) is done: recipe owners, `PUT /api/recipe/:id`
(Save changes / Save as new), `RECIPE_STORE=json|sqlite` (`RECIPE_DB_PATH`), Library
My/All switch, delete limited to owner or admin.
Deployment D3 (images) is done: every stored image is normalized with sharp (max 1600 px,
JPEG 82, `.jpg` keys) via `ResizingStorageAdapter`, recipe delete removes images no other
recipe uses, and admins get an "Unused images" cleanup (`/api/admin/images/*`).
Deployment D4 (Gemini quota message) is done: Gemini 429/RESOURCE_EXHAUSTED errors surface as
`AI_QUOTA_EXCEEDED` (429), URL ingestion reports it only when the single retry also hits quota,
and image matching names the quota in its warning.
Deployment D5 (Docker image and CI) is done: `WEB_DIST_DIR` makes Hono serve the built web app,
the default recipe placeholder is shipped and served at `/images/placeholder-recipe.png`, the
`Dockerfile` (Playwright base, arm64) and `docker-compose.example.yml` exist, and the CI `image`
job (push to `main` only, skipped when only docs change) builds the image, runs `scripts/docker-smoke-test.sh`, and publishes
`ghcr.io/<owner>/recipe-maker` (`latest` + `sha-<7>`, last 10 versions kept).
Deployment D6 (server setup) is done: production runs the GHCR image behind tinyauth;
server notes (compose, nginx sites, backup, update/restore) in `private/deploy/`.
Deployment D7 (documentation) is done: short README, `docs/local-development.md`,
`docs/self-hosting.md`, `docs/configuration.md`, `docs/architecture.md`; deployment
phases D1-D7 done.
Phase 9 (server-side PDF) is deferred: the browser print dialog is sufficient
for now; revisit later. Phase 11 (automatic step image generation) is a
deferred new feature: needs brainstorming/spec and a cost decision first. Read
`private/plans/mvp/recipe-maker-implementation-plan.md` before writing any code - it has the
strict phase order.

## Key docs
- `private/plans/backlog.md` - outstanding work not yet in a plan; add items here
- `private/plans/deployment/00-overview.md` - deployment/multi-user phases D1-D7
- `private/specs/deployment-and-multi-user.md` - deployment/multi-user spec
- `private/plans/mvp/recipe-maker-implementation-plan.md` - phases, order, definition of done, risks
- `docs/local-development.md` - dev setup
- `docs/self-hosting.md` - Docker + nginx + tinyauth self-hosting guide
- `docs/configuration.md` - environment variables and defaults
- `docs/architecture.md` - architecture overview
- `docs/specs/01` through `docs/specs/14` - one spec per concern, referenced by phase in the plan
- `docs/specs/12-shared-constants.md` - pantry allowlist + tag vocabulary (actual values)
- `docs/specs/13-recipe-persistence-and-library.md` - RecipeRepository, save/library flow

## Tech decisions (do not relitigate without asking)
- Backend: Hono
- Tests: Vitest (unit/integration), React Testing Library (frontend)
- Recipe storage: behind a `RecipeRepository` interface. JSON files, one per recipe
  (`server/data/recipes/{id}.json`, gitignored) locally; SQLite in production
  (deployment phase D2, `RECIPE_STORE=sqlite`)
- Image storage: separate `StorageAdapter` interface, local disk first
- Save is an explicit user action, never automatic
- Auth: login happens in a reverse proxy (tinyauth + nginx); the app trusts the
  `Remote-User` header when `AUTH_MODE=header` and runs everyone as admin
  `local` when `AUTH_MODE=none` (default, local dev). No in-app accounts.
- Multi-user: every recipe has an owner; everyone can view and edit every
  recipe, only the owner or an admin (`ADMIN_USERS`) can delete
- Deployment: one Docker image (Playwright base, arm64, published to GHCR),
  self-hostable; server-specific config stays in `private/`

## Repo layout (pnpm workspace, per docs/specs/01)
- `/apps/web` - frontend (React + TS + Vite), package `web`
- `/server` - backend API (Hono), package `server`
- `/shared` - shared types, schema, constants, `assets/ingredients` (215 images); workspace package `shared`
- `/docs/specs` - public per-feature specs; `/private` (gitignored) - plans (`private/plans/<area>/`) and private specs

## Conventions
- Follow `private/plans/*` and `docs/specs/*` (plus `private/specs/*`) as source of truth; update both together if scope changes
- Ask before making architecture decisions not already covered above
- Prefer targeted, minimal edits over broad refactors
- No emojis, ASCII only in responses and comments
- This repo uses the superpowers skill set (`brainstorming`, `writing-plans`,
  `executing-plans`, `systematic-debugging`, etc.) - check for a relevant skill before
  starting new work
