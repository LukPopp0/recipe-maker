# Recipe Maker

Ingests recipes (URL or manual text+images) via Gemini, normalizes them into a
canonical JSON schema, lets you save/browse them, and renders a printable
two-page recipe card.

## Status

Milestone 1 (ingestion + normalization + persistence) in progress. Milestone 2
(card rendering) not started. See `plans/recipe-maker-implementation-plan.md`
for the full phase breakdown and `specs/` for per-feature specs.

## Architecture

- `src/` - frontend (React + TypeScript + Vite).
- `server/` - backend API (Hono), added in Phase 1. Not present yet.
- `shared/` - types, schema validators, constants, and `assets/ingredients`
  (ingredient image library used by both frontend and backend).
- `plans/`, `specs/` - planning docs; read before changing scope.

## Setup

```bash
pnpm install
pnpm dev
```

`pnpm dev` and `pnpm build` automatically regenerate the ingredient asset
manifest (`shared/src/generated/ingredient-manifest.json`) via a `pre`
script - no manual step needed.

## Scripts

- `pnpm dev` - start the Vite dev server.
- `pnpm build` - type-check and build for production.
- `pnpm lint` - run ESLint.
- `pnpm test` - run Vitest.
- `pnpm generate:manifest` - regenerate the ingredient asset manifest manually.

## Known Constraints

- English-only input for Milestone 1.
- Recipes are capped at 6 cooking steps (compaction runs automatically above that).
- Pantry allowlist and tag vocabulary are fixed lists, see `specs/12-shared-constants.md`.
- Recipe persistence is flat JSON files on disk (`server/data/recipes/`), not a database.
- Single-user, no authentication (local-first).
