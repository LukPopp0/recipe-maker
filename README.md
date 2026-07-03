# Recipe Maker

Ingests recipes (URL or manual text+images) via Gemini, normalizes them into a
canonical JSON schema, lets you save/browse them, and renders a printable
two-page recipe card.

## Status

Phase 0 (repo cleanup), Phase 1 (core contracts and foundations), Phase 2
(Option A: URL ingestion), and Phase 3 (Option B: manual ingestion) are done.
Backend now boots, validates config, and exposes working recipe
save/list/get/delete/download/validate routes backed by a local JSON-file
`RecipeRepository`. `POST /api/ingest/url` is fully implemented: SSRF-guarded
fetch, HTML cleaning, Gemini extraction with retry, deterministic
post-processing (pantry routing, tag normalization, step compaction to
<=6 steps, sanitation), and local-disk image re-hosting served at
`/images/*`. `POST /api/ingest/manual` is also fully implemented: multipart
parsing of raw ingredients/steps text plus a main image and optional step
images, direct hosting of uploaded buffers (no SSRF path needed - they're
already local), a single Gemini normalization call (no retry, unlike Option
A), deterministic step-image assignment by sorted filename index, and reuse
of the same post-processing module as Option A. Ingredient image matching
(specs/08) is deferred to Phase 4 for both pipelines. No frontend ingestion
UI yet (Phase 5). See `plans/recipe-maker-implementation-plan.md` for the
full phase breakdown and `specs/` for per-feature specs.

## Architecture

This is a pnpm workspace with three sibling packages:

- `apps/web/` - frontend (React + TypeScript + Vite), package `web`.
- `server/` - backend API (Hono), package `server`. Boots via `pnpm --filter
  server run dev`, validates env/config and storage readiness on startup,
  exposes `/health` and `/api/*` routes.
- `shared/` - types, Zod schema validators, constants, and `assets/ingredients`
  (ingredient image library used by both frontend and backend), package
  `shared`.
- `plans/`, `specs/` - planning docs; read before changing scope.

## Setup

```bash
pnpm install
pnpm dev
```

`pnpm dev` and `pnpm build` automatically regenerate the ingredient asset
manifest (`shared/src/generated/ingredient-manifest.json`) before starting/building
- no manual step needed. `pnpm dev` only starts the frontend; run the backend
separately (see below).

To run the backend: copy `server/.env.example` to `server/.env`, then
`pnpm --filter server run dev` (starts on `PORT` from `.env`, default 8787).
A real `GEMINI_API_KEY` is required to exercise `POST /api/ingest/url` or
`POST /api/ingest/manual` end-to-end; without one, all other routes and the
test suite still work (tests mock the Gemini client and network calls).

## Scripts

- `pnpm dev` - regenerate the ingredient manifest, then start the `web` Vite dev server.
- `pnpm build` - regenerate the ingredient manifest, then build all workspace packages.
- `pnpm lint` - run ESLint across all workspace packages (`pnpm -r run lint`).
- `pnpm test` - run tests across all workspace packages (`pnpm -r run test`).
- `pnpm typecheck` - run TypeScript type checking across all workspace packages (`pnpm -r run typecheck`).
- `pnpm generate:manifest` - regenerate the ingredient asset manifest manually.
- `pnpm --filter web run dev|build|lint|preview|test` - run a script for the `web`
  package only.
- `pnpm --filter server run dev|start|test|lint|typecheck` - run a script for the
  `server` package only (`dev` watches, `start` runs once).

## Known Constraints

- English-only input for Milestone 1.
- Recipes are capped at 6 cooking steps (compaction runs automatically above that).
- Pantry allowlist and tag vocabulary are fixed lists, see `specs/12-shared-constants.md`.
- Recipe persistence is flat JSON files on disk (`server/data/recipes/`), not a database.
- Re-hosted recipe images are stored locally on disk (`server/data/images/`), not a cloud adapter.
- Single-user, no authentication (local-first).
