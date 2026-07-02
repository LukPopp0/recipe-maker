# Phase 1: Core Contracts and Foundations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Context
Phase 0 (repo cleanup) is done. No backend exists yet; the repo is a single Vite/React package at root. Per `plans/recipe-maker-implementation-plan.md`, Phase 1 lays the foundations everything else depends on: the canonical recipe schema/validators shared by frontend and backend, a standardized API error/envelope model, a Gemini config module (no live calls yet — that's Phase 2/3), a Hono backend skeleton, and a working `RecipeRepository` so recipes can actually be persisted. Getting this right now means Phases 2–8 (URL ingestion, manual ingestion, post-processing, frontend, library, card rendering, hardening) all build on stable, typed contracts instead of retrofitting them later.

Decisions made with the user before writing this plan (do not relitigate):
- Convert to a **pnpm workspace**: move the frontend into `apps/web/`, add `server/` and `shared/` as sibling packages (fully symmetric layout, no app code at root).
- **Zod** for runtime schema validation (shared + server), types derived via `z.infer` where practical.
- **`crypto.randomUUID()`** for recipe IDs — no new dependency.
- **Hono** for the backend (already an architecture decision in specs/01), Vitest per package.

This restructuring changes spec 01's documented repo layout, so this plan includes updating specs/01, the master plan, README, and CLAUDE.md alongside the code move (per CLAUDE.md's "update plans and specs together if scope changes" convention).

## Architecture
Three sibling packages under a pnpm workspace root (`pnpm-workspace.yaml`): `apps/web` (frontend, unchanged internals, just moved), `server` (Hono backend, new), `shared` (contracts/Zod schema/constants/ingredient assets, new). `shared` has no runtime dependency on the other two. `server` and `apps/web` depend on `shared` via `workspace:*`. `RecipeRepository` lives in `server/` (not `shared`) — it's a server-only persistence concern per specs/01, operating on the shared `CanonicalRecipe` type.

## Tech Stack
pnpm workspaces, React 19 + TS + Vite 8 (`apps/web`), Hono + `@hono/node-server` (`server`, new), Zod (`shared` + `server`, new), Vitest per package, Node ESM throughout.

## Global Constraints
- Node ESM only (`"type": "module"`) in every package.
- Follow specs/01, 02, 03, 06, 11, 13 exactly — no scope beyond the master plan's Phase 1 section.
- `server/data/recipes` created at startup, gitignored, never committed.
- No real Gemini API calls in this phase — the AI config module is shape/defaults only.
- Keep validation rules in one place (Zod schemas); derive types from them rather than hand-duplicating.

---

## Task 1: Convert Repository to a pnpm Workspace

**Files:** create `pnpm-workspace.yaml`; move `src/`, `index.html`, `public/`, `vite.config.ts`, `tsconfig.app.json`, `tsconfig.node.json` into `apps/web/`; add `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/vitest.config.ts`; rewrite root `package.json` and `tsconfig.json` to be workspace-orchestration-only; update `.gitignore`; update `specs/01-system-architecture.md`, `plans/recipe-maker-implementation-plan.md`, `README.md`, `CLAUDE.md` paths.

- [ ] Add `pnpm-workspace.yaml`:
  ```yaml
  packages:
    - apps/*
    - server
    - shared
  ```
- [ ] `git mv src apps/web/src && git mv index.html apps/web/index.html && git mv public apps/web/public && git mv vite.config.ts apps/web/vite.config.ts && git mv tsconfig.app.json apps/web/tsconfig.app.json && git mv tsconfig.node.json apps/web/tsconfig.node.json`
- [ ] Add `apps/web/package.json` (name `"web"`, keep existing `dependencies`/`devDependencies` from current root package.json, add `"shared": "workspace:*"`, scripts: `dev`, `build`, `lint`, `preview`, `test`).
- [ ] Add `apps/web/tsconfig.json` referencing `tsconfig.app.json` + `tsconfig.node.json` (same shape as current root tsconfig, scoped down).
- [ ] Add `apps/web/vitest.config.ts` (`environment: 'node'` for now, per Phase 0's note that jsdom lands with Phase 5/8 component tests).
- [ ] Rewrite root `package.json`: no app deps, just orchestration scripts —
  ```json
  {
    "name": "recipe-maker",
    "private": true,
    "version": "0.0.0",
    "type": "module",
    "scripts": {
      "dev": "pnpm --filter shared run generate:manifest && pnpm --filter web run dev",
      "build": "pnpm --filter shared run generate:manifest && pnpm -r run build",
      "lint": "pnpm -r run lint",
      "test": "pnpm -r run test",
      "generate:manifest": "pnpm --filter shared run generate:manifest"
    },
    "devDependencies": {
      "@eslint/js": "^10.0.1",
      "eslint": "^10.5.0",
      "eslint-plugin-react-hooks": "^7.1.1",
      "eslint-plugin-react-refresh": "^0.5.3",
      "globals": "^17.6.0",
      "typescript": "~6.0.2",
      "typescript-eslint": "^8.61.0"
    }
  }
  ```
- [ ] Rewrite root `tsconfig.json` to just reference the three packages (editor convenience only, not used by any build script).
- [ ] Add `server/data/recipes` to `.gitignore` (keep existing entries).
- [ ] Verify: `rm -rf node_modules && pnpm install && pnpm --filter web run lint && pnpm --filter web run dev`. Confirm ESLint's flat config resolves correctly when run from `apps/web` (it resolves upward from cwd, so the root `eslint.config.js` should apply); if not, add `apps/web/eslint.config.js` re-exporting the root config.
- [ ] Update `specs/01-system-architecture.md`'s "Repository Structure" section: `/apps/web` (frontend, package `web`), `/server` (package `server`), `/shared` (package `shared`); update "Frontend structure" paths from `/src/...` to `/apps/web/src/...`.
- [ ] Update `plans/recipe-maker-implementation-plan.md`: fix forward-looking `/src` references (leave Phase 0's already-completed task wording as historical record — don't rewrite what already happened).
- [ ] Update `README.md`'s Architecture/Setup/Scripts sections to the new paths and `pnpm -r`/`pnpm --filter` commands.
- [ ] Update `CLAUDE.md`'s "Repo layout" section to match.
- [ ] Commit: `chore: convert repo to pnpm workspace (apps/web, server, shared)`.

## Task 2: Scaffold the `shared` Package

**Files:** `shared/package.json`, `shared/tsconfig.json`, `shared/vitest.config.ts`; move `scripts/generate-ingredient-manifest.mjs` → `shared/scripts/generate-ingredient-manifest.mjs` and `scripts/lib/*` → `shared/scripts/lib/*` (assets and generated manifest are already under `shared/`, no move needed there).

- [ ] `git mv` the manifest scripts under `shared/scripts/`, remove now-empty root `scripts/` dir.
- [ ] Update the moved generator's relative paths (`../assets/ingredients`, `../src/generated/ingredient-manifest.json` — one directory shallower than before).
- [ ] Add `shared/package.json` (name `"shared"`, `main`/`types` pointing at `./src/index.ts`, deps: `zod`, devDeps: `typescript`, `vitest`, scripts: `generate:manifest`, `test`, `lint`).
- [ ] Add `shared/tsconfig.json` (`module`/`moduleResolution: nodenext`, `strict: true`, `noEmit: true`, `include: ["src"]`).
- [ ] Add `shared/vitest.config.ts` (`environment: 'node'`).
- [ ] Verify: `pnpm install && pnpm --filter shared run test && pnpm --filter shared run generate:manifest` — manifest regenerates 215 entries at the new location.
- [ ] Commit: `chore: scaffold shared package, move manifest generator under shared/`.

## Task 3: Shared Canonical Schema and Validators

**Files:** `shared/src/schema/canonical-recipe.ts` (+ `.test.ts`), `shared/src/schema/requests.ts`, `shared/src/contracts/canonical-recipe.ts`, `shared/src/contracts/envelope.ts`, `shared/src/contracts/recipe-repository.ts` (just the `RecipeSummary` wire type — the repository interface itself lives in `server/`), `shared/src/index.ts`.

- [ ] Write `shared/src/schema/canonical-recipe.ts`: Zod schemas for `Ingredient`, `Step` (`step_description` max 600), `Metadata`, and `CanonicalRecipeSchema` (title 1-140, tags max 5 × 1-40 chars, time 0-1440 nullable, steps length 1-6, `main_image` non-empty string) matching specs/02 exactly. Export `type CanonicalRecipe = z.infer<typeof CanonicalRecipeSchema>` and `applyMainImageFallback(candidate, fallbackUrl)` implementing spec 02 rule 8 (schema requires non-empty string; this helper applies the configured default before validation when the candidate is missing/blank).
- [ ] Write `shared/src/schema/canonical-recipe.test.ts`: valid recipe passes; step_description over 600 chars rejected; more than 6 steps rejected; empty `main_image` rejected; `applyMainImageFallback` returns candidate when present, fallback when missing/blank.
- [ ] Write `shared/src/contracts/envelope.ts`: `ERROR_CODES` (the specs/03 minimum set plus `NOT_IMPLEMENTED`, needed for Phase 1's ingest stubs), `ErrorCode`, `ApiError`, `ApiSuccessEnvelope<T>`, `ApiErrorEnvelope`, `ApiResponse<T>`.
- [ ] Write `shared/src/contracts/recipe-repository.ts`: `RecipeSummary` type (`id`, `title`, `tags`, `main_image`, `createdAt`) per specs/13 — this is the only repository-related thing that belongs in `shared` since both frontend and backend need this wire shape.
- [ ] Write `shared/src/contracts/canonical-recipe.ts`: re-export `CanonicalRecipe` type from the schema module (no duplicate hand-written type).
- [ ] Write `shared/src/schema/requests.ts`: `IngestUrlRequestSchema` (`{ url: string (valid URL) }`), `SaveRecipeRequestSchema = CanonicalRecipeSchema`.
- [ ] Write `shared/src/index.ts` re-exporting all of the above as the package's single entry point.
- [ ] Verify: `pnpm --filter shared run test && pnpm -r run lint && pnpm --filter web run build` (confirm the new package doesn't break the frontend build).
- [ ] Commit: `feat(shared): add canonical recipe contracts and Zod validators`.

## Task 4: Standardized Error Model

**Files:** `server/package.json` (minimal, expanded in Task 6), `server/tsconfig.json`, `server/vitest.config.ts`, `server/src/lib/errors.ts` (+ `.test.ts`), `server/src/lib/response.ts`.

- [ ] Add minimal `server/package.json` (deps: `shared` via `workspace:*`, `zod`; devDeps: `@types/node`, `typescript`, `vitest`; scripts `test`, `lint`).
- [ ] Add `server/tsconfig.json` (same shape as shared's) and `server/vitest.config.ts`.
- [ ] Write `server/src/lib/errors.ts`: `ERROR_STATUS_MAP: Record<ErrorCode, number>` (per specs/03's codes: `INVALID_INPUT`→400, `INVALID_URL`→400, `URL_FETCH_TIMEOUT`→504, `URL_EXTRACTION_FAILED`→422, `AI_NORMALIZATION_FAILED`→502, `SCHEMA_VALIDATION_FAILED`→422, `IMAGE_DOWNLOAD_FAILED`→502, `RECIPE_NOT_FOUND`→404, `INTERNAL_ERROR`→500, `NOT_IMPLEMENTED`→501); `AppError extends Error` (code, optional details, `status` getter); `serializeError(err)` that collapses any unknown thrown value to `INTERNAL_ERROR` with a generic message — never leak internals.
- [ ] Write `server/src/lib/errors.test.ts`: `AppError` round-trips code/message/details; unknown `Error` collapses to `INTERNAL_ERROR` without leaking its message.
- [ ] Write `server/src/lib/response.ts`: `ok(requestId, payload)` → `ApiSuccessEnvelope`; `fail(requestId, err)` → `{ envelope: ApiErrorEnvelope, status }` using `serializeError`.
- [ ] Verify: `pnpm install && pnpm --filter server run test`.
- [ ] Commit: `feat(server): add standardized error model and response envelope helpers`.

## Task 5: Gemini Model and Prompt Configuration Module

**Files:** `server/src/services/ai/config.ts` (+ `.test.ts`), `server/src/services/ai/prompt-version.ts`, `server/src/services/ai/prompts/README.md` (placeholder), `server/.env.example`.

- [ ] Write `server/src/services/ai/config.ts`: Zod-validated env loader `loadGeminiConfig(env)` for `GEMINI_API_KEY` (optional — not required until Phase 2/3 makes real calls), `GEMINI_PRIMARY_MODEL` (default `gemini-2.5-pro`), `GEMINI_RETRY_MODEL` (default `gemini-2.5-flash`), `GEMINI_TIMEOUT_MS` (default 20000), `GEMINI_TOKEN_BUDGET` (default 8000), `GEMINI_MAX_RETRIES` (default 1, max 3). Include deterministic `generationConfig` (temperature 0, topP 1, topK 1) for reproducibility per specs/11. No API calls anywhere in this task.
- [ ] Write `server/src/services/ai/prompt-version.ts`: `export const PROMPT_VERSION = 'v1'`.
- [ ] Write `server/src/services/ai/prompts/README.md`: placeholder noting actual prompt text lands in Phase 2 (specs/04) and Phase 3 (specs/05).
- [ ] Write `server/src/services/ai/config.test.ts`: defaults applied with empty env; overrides respected; invalid numeric env value throws.
- [ ] Add `server/.env.example`: `PORT`, `NODE_ENV`, `RECIPE_DATA_DIR`, `DEFAULT_MAIN_IMAGE_URL`, and the `GEMINI_*` vars above (all with sane defaults documented).
- [ ] Verify: `pnpm --filter server run test`.
- [ ] Commit: `feat(server): add Gemini config module with validated env defaults and prompt versioning`.

## Task 6: Bootstrap Backend Service Skeleton (Hono)

**Files:** `server/src/env.ts` (+ `.test.ts`), `server/src/middleware/request-id.ts`, `server/src/middleware/logger.ts`, `server/src/middleware/error-handler.ts`, `server/src/routes/health.ts`, `server/src/app.ts` (+ `.test.ts`), `server/src/index.ts`.

- [ ] `pnpm --filter server add hono @hono/node-server` (add `tsx` as a dev dependency for the `dev` script if using it — pick whichever dev-mode runner works cleanest with this Node version, `tsx` or `node --experimental-strip-types`).
- [ ] Write `server/src/env.ts`: `loadServerEnv(env)` — Zod-validated `PORT` (default 8787), `NODE_ENV` (enum, default development), `RECIPE_DATA_DIR` (default `./data/recipes`, resolved to absolute path), `DEFAULT_MAIN_IMAGE_URL`. Throws descriptively on invalid values.
- [ ] Write `server/src/env.test.ts`: defaults applied; invalid `NODE_ENV` throws.
- [ ] Write `server/src/middleware/request-id.ts`: reads `x-request-id` header or generates via `randomUUID()`, sets Hono context variable + response header.
- [ ] Write `server/src/middleware/logger.ts`: structured JSON log line per request (requestId, method, path, status, durationMs).
- [ ] Write `server/src/middleware/error-handler.ts`: `onError` handler using `fail()` from Task 4 to produce the envelope + status; `notFoundHandler` for unmatched routes.
- [ ] Write `server/src/routes/health.ts`: `GET /health` returning `ok(requestId, { status: 'ok', storage: ready ? 'ready' : 'unavailable' })` via an injected `checkStorageReady()` dependency.
- [ ] Write `server/src/app.ts`: `createApp(deps: AppDeps)` factory (deps: `env`, `checkStorageReady` for now — `recipeRepository` added in Task 8). Middleware order: requestId → logger → routes. Mount health under **both** `/health` (bare, for infra probes) and `/api/health` (spec-03 convention) pointing at the same handler. Register `onError`/`notFound`.
- [ ] Write `server/src/index.ts`: real entrypoint — `loadServerEnv()`, `mkdir(recipeDataDir, {recursive:true})` + `access(..., W_OK)` as the storage-readiness startup check (`process.exit(1)` on failure), `createApp(...)`, `serve({fetch: app.fetch, port})` via `@hono/node-server`.
- [ ] Write `server/src/app.test.ts`: `GET /api/health` returns `ok:true` + `requestId` echoed in both body and `x-request-id` header; storage-unavailable case reflected in response; unknown route returns a structured error envelope.
- [ ] Add `server/package.json` `dev`/`start` scripts using the chosen runner.
- [ ] Verify: `pnpm --filter server run test`; manually boot (`pnpm --filter server run dev` in background, `curl localhost:8787/api/health`, confirm `{"ok":true,...,"storage":"ready"}`, kill it).
- [ ] Commit: `feat(server): bootstrap Hono service skeleton with middleware, health check, startup validation`.

## Task 7: Bootstrap RecipeRepository

**Files:** `server/src/services/recipes/recipe-repository.ts`, `server/src/services/recipes/local-json-file-recipe-repository.ts` (+ `.test.ts`).

- [ ] Write `server/src/services/recipes/recipe-repository.ts`: `RecipeRepository` interface exactly per specs/13 (`save(recipe): Promise<{id}>`, `get(id): Promise<CanonicalRecipe|null>`, `list(): Promise<RecipeSummary[]>`, `delete(id): Promise<void>`) — server-only, not in `shared`, importing `CanonicalRecipe`/`RecipeSummary` from `shared`.
- [ ] Write `server/src/services/recipes/local-json-file-recipe-repository.ts`: `LocalJsonFileRecipeRepository` writing `{dataDir}/{id}.json` (id via `randomUUID()`, stored envelope `{id, createdAt, recipe}`). `save` creates the dir if missing. `get` returns `null` on `ENOENT`. `list` scans the dir, reads each file for its summary fields, sorts newest-first by `createdAt`. `delete` is idempotent (`ENOENT` swallowed).
- [ ] Write `.test.ts`: save→get round-trip; `get` returns null for unknown id; `list` returns summaries newest-first; `delete` removes so it no longer appears in `get`/`list`; delete is idempotent for unknown id; re-instantiating the repository against the same temp dir still finds saved recipes (restart simulation).
- [ ] Verify: `pnpm --filter server run test`.
- [ ] Commit: `feat(server): bootstrap RecipeRepository interface and local JSON file implementation`.

## Task 8: Wire Real Recipe Routes + Register Ingestion Stubs

**Files:** modify `server/src/app.ts` and `server/src/index.ts`; create `server/src/routes/recipe.ts` (+ `.test.ts`), `server/src/routes/ingest.ts` (+ `.test.ts`), `server/src/middleware/validate.ts`.

- [ ] Write `server/src/middleware/validate.ts`: `parseJsonBody(c, schema)` — parses the request JSON, throws `AppError('INVALID_INPUT', ..., {issues})` on malformed JSON or schema failure via `schema.safeParse`.
- [ ] Update `AppDeps` in `app.ts` to add `recipeRepository: RecipeRepository`; mount `recipeRoutes(deps)` and `ingestRoutes()` under `/api`.
- [ ] Write `server/src/routes/recipe.ts`:
  - `POST /recipe/validate`: parses body, runs `CanonicalRecipeSchema.safeParse`, returns `ok(requestId, {valid, recipe|errors})` — always 200, validity is in the payload (this is a "check" endpoint, not a mutating one).
  - `POST /recipe/save`: `parseJsonBody(c, SaveRecipeRequestSchema)`, on schema failure re-throw as `SCHEMA_VALIDATION_FAILED`; calls `recipeRepository.save`; returns `ok(requestId, {id})`.
  - `GET /recipes`: returns `ok(requestId, {recipes: await recipeRepository.list()})`.
  - `GET /recipe/:id`: `recipeRepository.get(id)`, throw `AppError('RECIPE_NOT_FOUND', undefined, {id})` if null, else `ok(requestId, {recipe})`.
  - `DELETE /recipe/:id`: same not-found check, then `recipeRepository.delete(id)`, `ok(requestId, {})`.
  - `GET /recipe/download/:id`: same not-found check, returns the recipe JSON as an attachment with a slugified-title filename (`Content-Disposition: attachment`).
- [ ] Write `server/src/routes/ingest.ts`: `POST /ingest/url` and `POST /ingest/manual` both throw `AppError('NOT_IMPLEMENTED', 'X ingestion is not implemented yet (lands in Phase N)')` — registered now so the route surface matches specs/03, real pipelines land in Phase 2/3.
- [ ] Update `server/src/index.ts`: instantiate `new LocalJsonFileRecipeRepository(env.recipeDataDir)`, pass into `createApp`.
- [ ] Write `server/src/routes/recipe.test.ts`: invalid `/recipe/save` payload → 400 `INVALID_INPUT`; full save→list→get→download→delete→get(404 `RECIPE_NOT_FOUND`) round trip through the HTTP layer against a temp-dir repository; `/recipe/validate` returns 200 with `valid:false` for a bad candidate (doesn't error the request).
- [ ] Write `server/src/routes/ingest.test.ts`: both stub routes return 501 + `NOT_IMPLEMENTED` in the standard envelope.
- [ ] Verify: `pnpm --filter server run test && pnpm --filter server run lint`.
- [ ] Commit: `feat(server): wire RecipeRepository into real recipe routes, register ingestion stubs`.

## Task 9: Workspace-Wide Verification Pass

- [ ] Fresh install + full suite from repo root: `rm -rf node_modules apps/web/node_modules server/node_modules shared/node_modules && pnpm install && pnpm -r run test && pnpm -r run lint`.
- [ ] `pnpm --filter shared run generate:manifest && pnpm --filter web run build`.
- [ ] Manual smoke test: boot `pnpm --filter server run dev` in background; `curl localhost:8787/api/health` (expect `ok:true`); `curl -X POST .../api/recipe/save -d '{"title":""}'` (expect `INVALID_INPUT`); `curl -X POST .../api/ingest/url -d '{"url":"https://example.com"}'` (expect `NOT_IMPLEMENTED`); kill the server.
- [ ] `git status --porcelain server/data` — confirm empty output (recipes dir untracked/ignored).
- [ ] Commit any fixups only if issues surfaced: `chore: fix workspace-wide lint/test/build issues from Phase 1 verification pass`.

---

## Acceptance Criteria (from master plan, Phase 1)
- [ ] Invalid payloads fail with typed, user-readable errors — `recipe.test.ts` + `errors.test.ts`.
- [ ] All route handlers return predictable success/error shape — every route test asserts the `{ok, requestId, ...}` / `{ok:false, requestId, error}` envelope, including the `NOT_IMPLEMENTED` stubs.
- [ ] Backend boots with validated config and returns health check response — `env.test.ts` + `app.test.ts` + `index.ts` startup checks.
- [ ] RecipeRepository save/get/list/delete round-trip correctly, covered by Vitest — repository unit test + HTTP-layer route test.

## Critical Files
- `shared/src/schema/canonical-recipe.ts`
- `server/src/lib/errors.ts`
- `server/src/app.ts`
- `server/src/services/recipes/local-json-file-recipe-repository.ts`
- `server/src/routes/recipe.ts`
- `pnpm-workspace.yaml`
