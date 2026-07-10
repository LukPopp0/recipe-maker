# Recipe Maker

Ingests recipes (URL or manual text+images) via Gemini, normalizes them into a canonical JSON schema, lets you save/browse them, and renders a printable two-page recipe card.

## Prerequisites

- Node.js 22 or newer
- pnpm 11 (the repo pins `pnpm@11.11.0` via the `packageManager` field, so `corepack enable` is enough to get the right version)
- A Gemini API key (free tier works): create a project at [aistudio.google.com](https://aistudio.google.com), then generate an API key

## Getting Started

1. Install dependencies (this also generates the ingredient asset manifest):

   ```bash
   pnpm install
   ```

2. Duplicate the backend env template and enter your Gemini API key:

   ```bash
   cp server/.env.example server/.env
   # edit server/.env and set GEMINI_API_KEY=<your key>
   ```

   Without a real key, all routes except `POST /api/ingest/url` and `POST /api/ingest/manual` still work, and the test suite runs fully (tests mock the Gemini client and network calls).

3. Start both dev servers with one command:

   ```bash
   pnpm dev   # regenerates the manifest, then runs web + server in parallel
   ```

   This runs the `web` Vite dev server and the `server` backend (port 8787, `PORT` from `server/.env`) together; the server loads `server/.env` via its own `--env-file`. To run just one, use `pnpm --filter web run dev` or `pnpm --filter server run dev`.

   Vite proxies `/api`, `/images`, and `/ingredient-images` to `http://localhost:8787`, so no CORS setup is needed. Open the printed Vite URL in your browser.

4. Optional: URL ingestion falls back to a headless Chromium (Playwright) for pages whose recipe content requires client-side JavaScript. This needs a one-time browser download:

   ```bash
   pnpm --filter server exec playwright install chromium
   ```

   Set `BROWSER_FALLBACK_ENABLED=false` in `server/.env` to skip the download and run URL ingestion with static fetching only.

## Architecture

This is a pnpm workspace with three sibling packages:

- `apps/web/` - frontend (React + TypeScript + Vite), package `web`.
- `server/` - backend API (Hono), package `server`. Boots via `pnpm --filter server run dev`, validates env/config and storage readiness on startup, exposes `/health` and `/api/*` routes.
- `shared/` - types, Zod schema validators, constants, and `assets/ingredients` (ingredient image library used by both frontend and backend), package `shared`.
- `plans/`, `specs/` - planning docs; read before changing scope.

## Scripts

- `pnpm dev` - regenerate the ingredient manifest, then start the `web` Vite dev server and the `server` backend in parallel.
- `pnpm build` - regenerate the ingredient manifest, then build all workspace packages.
- `pnpm lint` - run ESLint across all workspace packages (`pnpm -r run lint`).
- `pnpm test` - run tests across all workspace packages (`pnpm -r run test`).
- `pnpm typecheck` - run TypeScript type checking across all workspace packages (`pnpm -r run typecheck`).
- `pnpm generate:manifest` - regenerate the ingredient asset manifest manually.
- `pnpm --filter web run dev|build|lint|preview|test` - run a script for the `web` package only.
- `pnpm --filter server run dev|start|test|lint|typecheck` - run a script for the `server` package only (`dev` watches, `start` runs once).

## Known Constraints

- English-only input for Milestone 1.
- Recipes are capped at 6 cooking steps (compaction runs automatically above that).
- Pantry allowlist and tag vocabulary are fixed lists, see `specs/12-shared-constants.md`.
- Recipe persistence is flat JSON files on disk (`server/data/recipes/`), not a database.
- Re-hosted recipe images are stored locally on disk (`server/data/images/`), not a cloud adapter.
- Single-user, no authentication (local-first).

## Status

- [x] Phase 0: repository cleanup and baseline setup
- [x] Phase 1: core contracts, schema validators, backend skeleton, RecipeRepository
- [x] Phase 2: URL ingestion pipeline (`POST /api/ingest/url`) with SSRF guardrails and shared post-processing (pantry routing, tag normalization, step compaction, sanitation)
- [x] Phase 3: manual ingestion pipeline (`POST /api/ingest/manual`) with uploaded-image hosting and deterministic step-image assignment
- [x] Phase 4: Gemini-based ingredient image matching against the local catalog (215 assets, `INGREDIENT_NOT_FOUND.png` fallback)
- [x] Phase 5: Milestone 1 frontend - Create workspace (URL/Manual/Load JSON tabs), editable review panel, JSON viewer/download, explicit Save
- [x] Phase 5.5: URL ingestion hardening - JSON-LD extraction, Playwright browser fallback, explicit fetch-error codes
- [x] Phase 6: Library UI - list, read-only view, download, delete, Open in Create
- [x] Phase 7: Milestone 2 card rendering - printable two-page recipe card via browser print/Save-as-PDF
- [x] Phase 7.5: landscape card variant (default) with portrait toggle, self-hosted fonts
- [x] Phase 8: quality, testing, and hardening - golden-fixture integration tests, rate limiting, per-stage structured logs, CI workflow
- [ ] Phase 9: server-side PDF generation (future)

See `plans/recipe-maker-implementation-plan.md` for the full phase breakdown and `specs/` for per-feature specs.
