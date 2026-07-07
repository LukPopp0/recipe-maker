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
explicit URL_FETCH_BLOCKED/URL_FETCH_FAILED errors (see plan addendum + specs/04).
Phase 7.5 added the landscape (default) card orientation with a portrait
toggle and self-hosted Inter/D-DIN fonts (specs/10 Landscape Variant).
Next: Phase 8 quality/testing/hardening. Read
`plans/recipe-maker-implementation-plan.md` before writing any code - it has the
strict phase order.

## Key docs
- `plans/recipe-maker-implementation-plan.md` - phases, order, definition of done, risks
- `specs/01` through `specs/13` - one spec per concern, referenced by phase in the plan
- `specs/12-shared-constants.md` - pantry allowlist + tag vocabulary (actual values)
- `specs/13-recipe-persistence-and-library.md` - RecipeRepository, save/library flow

## Tech decisions (do not relitigate without asking)
- Backend: Hono
- Tests: Vitest (unit/integration), React Testing Library (frontend)
- Recipe storage: flat JSON files, one per recipe, behind a `RecipeRepository` interface
  (`server/data/recipes/{id}.json`, gitignored) - not a database
- Image storage: separate `StorageAdapter` interface, local disk first
- Save is an explicit user action, never automatic
- Single-user, no auth for now; access gate only if/when deployed
- Deployment: local-first, keep adapters pluggable for future hosting

## Repo layout (pnpm workspace, per specs/01)
- `/apps/web` - frontend (React + TS + Vite), package `web`
- `/server` - backend API, package `server` (not yet created)
- `/shared` - shared types, schema, constants, `assets/ingredients` (215 images, already
  in place); package `shared` (not yet an installable package - added in a later Phase 1 task)
- `/plans`, `/specs` - planning docs

## Conventions
- Follow `plans/*` and `specs/*` as source of truth; update both together if scope changes
- Ask before making architecture decisions not already covered above
- Prefer targeted, minimal edits over broad refactors
- No emojis, ASCII only in responses and comments
- This repo uses the superpowers skill set (`brainstorming`, `writing-plans`,
  `executing-plans`, `systematic-debugging`, etc.) - check for a relevant skill before
  starting new work
