# Phase 5: Milestone 1 Frontend Completion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Milestone 1 Create workspace end-to-end in `apps/web`: URL / Manual / Load JSON ingestion tabs, a fully editable review panel (title, tags, time, ingredients with thumbnails, steps), a warnings/diagnostics area, a canonical JSON viewer with copy + deterministic-filename download, and an explicit Save Recipe action against the existing backend. The Library UI stays in Phase 6; recipe CRUD routes already exist server-side.

**Architecture:** A single-page React app with no router. `App.tsx` owns the one piece of global state — the current `CanonicalRecipe` (plus ingestion diagnostics and lifecycle status) — via plain `useState`; child components receive the recipe and patch callbacks as props. A thin typed API client (`src/api/client.ts`) wraps `fetch` against relative `/api/...` paths, with a Vite dev proxy forwarding `/api`, `/images`, and a new `/ingredient-images` mount to the backend on `localhost:8787` (no CORS anywhere). The backend gains exactly one change: statically serving `shared/assets/ingredients` at `/ingredient-images/*` so the review panel can render ingredient thumbnails from the bare catalog filenames stored in `ingredient.image` (Phase 4 decision 2 explicitly deferred this to Phase 5). All validation and types come from the `shared` package (`CanonicalRecipeSchema`, `TAG_VOCABULARY`, `INGREDIENT_IMAGE_MANIFEST`, `ApiResponse`, `ERROR_CODES`).

**Tech Stack:** React 19 + TypeScript + Vite 8 (existing), plain global CSS using the existing design tokens in `src/index.css` (no CSS modules/Tailwind), Zod via `shared`. New dev dependencies in `web` only: `jsdom`, `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`. No router, no state library, no syntax-highlighting library.

## Scope Decisions (confirmed with user)

1. **Design level: functional and clean, not polished.** Layout per spec 09 (header + nav, left input panel, right review panel, bottom JSON utility area) built from the existing token system. The visual refinement pass is Milestone 2 — do not spend tasks on aesthetics.
2. **Tag editor = vocabulary chips + custom input.** All 14 `TAG_VOCABULARY` entries render as clickable chips (toggle on/off); a free-text input adds custom tags. Hard cap of 5 tags (schema rule 2): adding is disabled at 5. Every applied tag is removable. Dedupe case-insensitively.
3. **Ingredient thumbnails are in scope.** The backend statically serves `shared/assets/ingredients` at `/ingredient-images/*` (new mount, Task 1). The review panel resolves each ingredient's bare filename against `INGREDIENT_IMAGE_MANIFEST`; unknown/missing filenames fall back to `INGREDIENT_NOT_FOUND.png`. `ingredient.image` values in the JSON stay bare filenames (portable export, per Phase 4 decision 2).
4. **Review panel supports full editing:** edit-in-place for title, time, tags, ingredient fields (`name`, `amount_text`, `unit`), step fields (`step_header`, `step_description`), PLUS add/remove ingredient rows and add/remove steps. Steps capped at 6 (add disabled at 6, remove disabled at 1); ingredients may go to zero (schema allows empty). Reordering is out of scope. `pantry_items` is read-only/derived. `metadata` is never user-edited. New ingredient rows get no `image` (thumbnail shows the not-found fallback); step `image` is not editable.
5. **Dev connectivity = Vite proxy, not CORS.** `vite.config.ts` proxies `/api`, `/images`, and `/ingredient-images` to `http://localhost:8787`. The frontend always calls relative paths. Rehosted image URLs coming back from the backend are absolute (`PUBLIC_BASE_URL`-based) and load fine in `<img>` tags without CORS.
6. **Frontend tests use RTL + jsdom** (the master plan's stated test stack for frontend, unused until now). `web`'s vitest environment switches from `node` to `jsdom` with a jest-dom setup file. TDD per repo convention; tests per component/hook where they carry weight (API client, tag editor, review-panel editing, validation guardrails, download filename), not snapshot noise.
7. **Stage-level status text is honest, not simulated.** Each ingestion is a single HTTP round trip, so the "stages" from spec 09 map to real client-side lifecycle points: `submitting` -> `processing` (with a hint that Gemini extraction can take up to ~1 minute) -> `complete`/`error`. No fake timed progress through backend-internal stages.
8. **JSON viewer = pretty-printed monospace with a minimal hand-rolled highlighter** (keys/strings/numbers/literals, tested) — satisfies spec 09's "syntax-highlighted" without a new dependency. Copy-to-clipboard uses `navigator.clipboard.writeText` with a fallback message.
9. **Download and Save both re-validate first** with `CanonicalRecipeSchema.safeParse` client-side (spec 09: "Validate recipe before download"). Validation errors block the action and render as field-level errors; warnings never block. Download filename: `recipe-{slug}-{YYYYMMDD}.json` (slugified title, local date).
10. **Client-side pre-submit guardrails mirror server limits:** Manual tab requires non-empty `ingredientsText`/`stepsText` and a main image; accepted image types `image/jpeg`, `image/png`, `image/webp` (mirrors `ALLOWED_CONTENT_TYPES` in `server/src/services/images/image-rehoster.ts`); per-image cap 8,000,000 bytes (`IMAGE_MAX_BYTES` default), total request cap 20,000,000 bytes (`MANUAL_REQUEST_MAX_BYTES` default). Constants are defined once in a frontend module with comments pointing at `server/src/env.ts`.
11. **Nav shows Create + Library; Library is a disabled placeholder** ("coming in Phase 6") toggled by local state — no router.
12. **Loading a new ingestion result or JSON file replaces the current review state** after an in-UI confirm when unsaved edits exist (simple `confirm()` is acceptable at this design level).

## Context

Phases 0-4 are done. The backend (`server`, Hono, port 8787) already exposes everything Phase 5 needs: `POST /api/ingest/url`, `POST /api/ingest/manual` (multipart), `POST /api/recipe/validate` (always 200; `{valid:false, errors:<zod flatten>}` or `{valid:true, recipe}`), `POST /api/recipe/save` (`{id}`, 422 on invalid), plus the full library CRUD (Phase 6 frontend will consume it). All responses use the envelope `{ ok, requestId, ... }` / `{ ok:false, requestId, error:{code,message,details?} }`. Re-hosted images are served at `/images/*`; ingredient catalog assets are NOT yet served — `ingredient.image` holds a bare filename like `broccoli.png`.

The frontend is an empty shell: `apps/web/src/App.tsx` is a placeholder, `src/index.css` has the full design-token system (colors, spacing, typography, radii, shadows, dark mode, focus-visible, print baseline). No components/hooks/api directories, no tests, vitest runs with `environment: 'node'` and `--passWithNoTests`.

The `shared` package exports (raw TS via workspace): `CanonicalRecipeSchema` + `CanonicalRecipe`/`Ingredient`/`Step`/`Metadata` types, `ERROR_CODES` + `ApiResponse`/`ApiErrorEnvelope` types, `TAG_VOCABULARY`, `PANTRY_ALLOWLIST`/`isPantryItem`, `INGREDIENT_IMAGE_MANIFEST` (215 sorted filenames incl. `INGREDIENT_NOT_FOUND.png`).

Planned frontend layout under `apps/web/src`:

```
src/
  api/client.ts                 typed fetch wrappers per endpoint
  lib/                          pure helpers (download filename, image URL, upload limits, json highlight)
  components/
    ErrorBanner.tsx             global error display with recovery actions
    ingest/                     UrlTab, ManualTab, LoadJsonTab, IngestTabs, StageStatus
    review/                     ReviewPanel, TagEditor, IngredientEditor, StepEditor, WarningsPanel
    json/JsonPanel.tsx          viewer + copy + download + Save Recipe
  App.tsx                       nav + workspace state + layout regions
  workspace.css                 component styles built on index.css tokens
```

## Global Constraints

- No scope beyond specs/02, 03, 09, 13 and the master plan's Phase 5 section. Library UI is Phase 6; card rendering is Milestone 2.
- All recipe/request/response types and runtime validation come from `shared` — never redefine schema shapes in `web`.
- No new runtime dependencies in `web`; only the four test dev-dependencies (decision 6).
- No `fetch` in components — all network access goes through `src/api/client.ts`.
- Every test mocks `fetch` (or uses fake props); no test hits the real backend or Gemini.
- Plain CSS on existing tokens; ASCII only, no emojis; targeted minimal diffs.
- Backend changes are limited to Task 1 (static mount + env var); no route or pipeline changes.

---

## Task 1: Serve Ingredient Catalog Assets from the Backend

**Files:** modify `server/src/env.ts` (+ `env.test.ts`), modify `server/src/app.ts` (+ `app.test.ts`), modify `server/.env.example`.

**Interfaces:**
- Produces: `GET /ingredient-images/:filename` serving files from `shared/assets/ingredients`; `ServerEnv.INGREDIENT_ASSET_DIR: string` (default `../shared/assets/ingredients`, resolved like the existing data-dir vars).

- [ ] Update `env.test.ts` first: `INGREDIENT_ASSET_DIR` defaults to `../shared/assets/ingredients` and accepts an override.
- [ ] Add `INGREDIENT_ASSET_DIR` to the env schema in `server/src/env.ts` following the `IMAGE_DATA_DIR`/`RECIPE_DATA_DIR` pattern; document it in `server/.env.example`.
- [ ] Update `app.test.ts` first: a request to `/ingredient-images/INGREDIENT_NOT_FOUND.png` returns 200 with an image content type (point the test env at a temp dir containing a fixture file, mirroring existing temp-dir test patterns); an unknown filename 404s through the standard `notFoundHandler`.
- [ ] Add a second `serveStatic` mount in `server/src/app.ts` directly below the existing `/images/*` mount: path `/ingredient-images/*`, `root: deps.env.INGREDIENT_ASSET_DIR`, `rewriteRequestPath` stripping the prefix — mirroring the `/images` mount exactly, with a comment noting this fulfills Phase 4 decision 2 ("static serving deferred to Phase 5").
- [ ] Verify: `pnpm --filter server run test && pnpm --filter server run typecheck`.
- [ ] Commit: `feat(server): serve shared ingredient catalog assets at /ingredient-images`.

## Task 2: Frontend Test Infrastructure and Dev Proxy

**Files:** modify `apps/web/package.json`, `apps/web/vitest.config.ts`, `apps/web/vite.config.ts`; create `apps/web/src/test/setup.ts`, `apps/web/src/App.test.tsx`.

**Interfaces:**
- Produces: RTL + jsdom test environment for `web`; Vite dev proxy for `/api`, `/images`, `/ingredient-images` -> `http://localhost:8787`.

- [ ] Add dev dependencies to `web`: `jsdom`, `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom` (`pnpm --filter web add -D ...`).
- [ ] Update `vitest.config.ts`: `environment: 'jsdom'`, `setupFiles: ['./src/test/setup.ts']`, keep explicit imports (no globals), matching server test style. Create `src/test/setup.ts` importing `@testing-library/jest-dom/vitest` and adding an `afterEach` cleanup.
- [ ] Update `vite.config.ts`: add `server.proxy` entries forwarding `/api`, `/images`, and `/ingredient-images` to `http://localhost:8787` (comment referencing `server/src/env.ts` PORT default).
- [ ] Write `src/App.test.tsx`: renders `App`, asserts the app title and the Create workspace region are present (drives the placeholder shell for now; extended in Task 4).
- [ ] Remove `--passWithNoTests` from the `web` test script now that tests exist.
- [ ] Verify: `pnpm --filter web run test && pnpm --filter web run typecheck && pnpm --filter web run lint`.
- [ ] Commit: `chore(web): add RTL/jsdom test setup and dev proxy to the backend`.

## Task 3: Typed API Client and Pure Helpers

**Files:** create `apps/web/src/api/client.ts` (+ `client.test.ts`), `apps/web/src/lib/download.ts` (+ `.test.ts`), `apps/web/src/lib/ingredient-image.ts` (+ `.test.ts`), `apps/web/src/lib/upload-limits.ts` (+ `.test.ts`).

**Interfaces:**
- Consumes: `shared` types (`CanonicalRecipe`, `ApiResponse`, `ApiError`, `INGREDIENT_IMAGE_MANIFEST`).
- Produces (api/client.ts):
  - `export interface IngestDiagnostics { extractor: string; model: string; durationMs: number }`
  - `export type IngestResult = { recipe: CanonicalRecipe; diagnostics: IngestDiagnostics }`
  - `export type ApiFailure = { code: string; message: string; details?: unknown; requestId?: string }`
  - `export type ClientResult<T> = { ok: true; value: T } | { ok: false; error: ApiFailure }`
  - `export async function ingestUrl(url: string): Promise<ClientResult<IngestResult>>`
  - `export async function ingestManual(fields: { ingredientsText: string; stepsText: string; mainImage: File; stepImages: File[] }): Promise<ClientResult<IngestResult>>` (builds `FormData`)
  - `export async function validateRecipe(candidate: unknown): Promise<ClientResult<{ valid: true; recipe: CanonicalRecipe } | { valid: false; errors: FlattenedErrors }>>`
  - `export async function saveRecipe(recipe: CanonicalRecipe): Promise<ClientResult<{ id: string }>>`
- Produces (lib):
  - `download.ts`: `slugifyTitle(title: string): string`, `buildRecipeFilename(title: string, date?: Date): string` (`recipe-{slug}-{YYYYMMDD}.json`), `downloadJson(filename: string, payload: unknown): void` (Blob + object URL + anchor click).
  - `ingredient-image.ts`: `INGREDIENT_NOT_FOUND_IMAGE` constant, `ingredientImageUrl(filename: string | undefined): string` — returns `/ingredient-images/{filename}` when the filename is in `INGREDIENT_IMAGE_MANIFEST` (Set built once), else the not-found URL.
  - `upload-limits.ts`: `ACCEPTED_IMAGE_TYPES` (`image/jpeg`, `image/png`, `image/webp`), `MAX_IMAGE_BYTES = 8_000_000`, `MAX_MANUAL_REQUEST_BYTES = 20_000_000` (comments referencing `server/src/env.ts` and `image-rehoster.ts`), `validateManualUpload(fields): string[]` returning human-readable errors (missing text, missing/oversized/wrong-type files, total-size overflow).

- [ ] Write `client.test.ts` first with `vi.stubGlobal('fetch', vi.fn())`: success envelopes unwrap to `ClientResult.value`; `ok:false` envelopes map `error.code/message/details` + `requestId` into `ApiFailure`; network failures (fetch rejects) and non-JSON responses map to a synthetic `NETWORK_ERROR` / `INTERNAL_ERROR` failure with an actionable message; `ingestManual` posts `FormData` with `ingredientsText`, `stepsText`, `mainImage`, repeated `stepImages` fields; all URLs are relative (`/api/...`).
- [ ] Implement `client.ts` with one private `request<T>` helper handling envelope unwrapping and error normalization; per-endpoint functions stay thin.
- [ ] Write lib tests first, then implement: filename determinism (`recipe-spicy-noodles-20260703.json` for a fixed date; slug lowercases, strips non-alphanumerics to hyphens, trims/collapses hyphens), manifest hit/miss behavior for `ingredientImageUrl`, each `validateManualUpload` rule produces its specific error and a clean payload produces `[]`.
- [ ] Verify: `pnpm --filter web run test && pnpm --filter web run typecheck`.
- [ ] Commit: `feat(web): add typed API client and pure helpers for download, thumbnails, upload limits`.

## Task 4: Workspace Shell, App State, and Error Banner

**Files:** modify `apps/web/src/App.tsx` (+ extend `App.test.tsx`), create `apps/web/src/components/ErrorBanner.tsx` (+ `.test.tsx`), `apps/web/src/workspace.css`, modify `apps/web/src/main.tsx` (import `workspace.css`), create `apps/web/src/workspace-types.ts`.

**Interfaces:**
- Produces (workspace-types.ts):
  - `export type IngestStatus = { phase: 'idle' } | { phase: 'submitting' } | { phase: 'processing'; message: string } | { phase: 'complete' } | { phase: 'error'; error: ApiFailure }`
  - `export type WorkspaceRecipeState = { recipe: CanonicalRecipe; diagnostics: IngestDiagnostics | null; savedId: string | null; dirty: boolean } | null`
- Produces (App.tsx): top-level state `recipeState` + setters passed down; `adoptRecipe(recipe, diagnostics)` callback (applies decision 12 confirm-on-replace); layout regions per spec 09 (header with app title + status indicator, nav with Create active and Library disabled, left input panel slot, right review panel slot, bottom JSON utility slot). Placeholder text in slots until Tasks 5-10 fill them.
- Produces (ErrorBanner.tsx): `ErrorBanner({ error, onRetry, onDismiss })` — renders `error.message`, error code, `requestId` when present, a per-code recovery hint (e.g. `INVALID_URL`/`URL_EXTRACTION_FAILED` -> "check the URL or use the Manual tab"; `NETWORK_ERROR` -> "is the backend running on port 8787?"), and Retry/Dismiss buttons.

- [ ] Extend `App.test.tsx` first: nav renders Create (active) and Library (disabled, "Phase 6" hint); the three layout regions exist (accessible roles/headings); with no recipe loaded, the review region shows an empty-state message.
- [ ] Write `ErrorBanner.test.tsx`: message + code + requestId render; Retry fires `onRetry`; recovery hint varies by code; unknown codes get a generic hint.
- [ ] Implement `App.tsx`, `workspace-types.ts`, `ErrorBanner.tsx`. Grid layout in `workspace.css` using existing tokens only (two columns + bottom row, stacking to one column under a media query — functional, not polished, per decision 1).
- [ ] Verify: `pnpm --filter web run test && pnpm --filter web run lint`. Boot both dev servers and eyeball the shell once (`pnpm --filter server run dev`, `pnpm --filter web run dev`).
- [ ] Commit: `feat(web): workspace shell with nav, app state, and error banner`.

## Task 5: URL Tab and Ingest Tab Container

**Files:** create `apps/web/src/components/ingest/IngestTabs.tsx`, `UrlTab.tsx` (+ `.test.tsx`), `StageStatus.tsx`; wire into `App.tsx`.

**Interfaces:**
- Consumes: `ingestUrl` (Task 3), `IngestStatus`/`adoptRecipe` (Task 4).
- Produces: `IngestTabs` — local-state tab switcher (URL / Manual / Load JSON; Manual and Load JSON slots filled in Tasks 6-7); `UrlTab({ onRecipe })` — URL input + "Extract Recipe" button; `StageStatus({ status })` — renders the lifecycle text per decision 7 (`Submitting...`, `Extracting and normalizing (this can take up to a minute)...`, `Complete.`), shared by all three tabs.

- [ ] Write `UrlTab.test.tsx` first (mock the api client module with `vi.mock`): empty/whitespace URL disables submit; obviously invalid URL (fails `URL` constructor or non-http(s)) shows an inline error without calling the client; happy path calls `ingestUrl` and fires `onRecipe(recipe, diagnostics)`; while pending, the button disables and `StageStatus` shows processing text; an `ApiFailure` renders the `ErrorBanner` with Retry re-submitting the same URL.
- [ ] Implement `UrlTab`, `StageStatus`, `IngestTabs`; mount `IngestTabs` in `App.tsx`'s left panel.
- [ ] Verify: `pnpm --filter web run test`. Manual smoke: real backend + real URL through the browser.
- [ ] Commit: `feat(web): URL ingestion tab with lifecycle status and error recovery`.

## Task 6: Manual Tab with Client-Side Guardrails

**Files:** create `apps/web/src/components/ingest/ManualTab.tsx` (+ `.test.tsx`); wire into `IngestTabs.tsx`.

**Interfaces:**
- Consumes: `ingestManual`, `validateManualUpload`, `ACCEPTED_IMAGE_TYPES` (Task 3), `StageStatus`/`ErrorBanner` (Tasks 4-5).
- Produces: `ManualTab({ onRecipe })` — ingredients textarea, steps textarea, main image file input (`accept` from `ACCEPTED_IMAGE_TYPES`), step images multi-file input, selected-file list with per-file size display and remove buttons, "Normalize Recipe" submit.

- [ ] Write `ManualTab.test.tsx` first: submit blocked with itemized errors when text fields are empty or main image missing (errors come from `validateManualUpload`, rendered inline, no API call made); an oversized or wrong-type file surfaces its specific limit error; valid input calls `ingestManual` with exactly the entered fields/files and fires `onRecipe`; pending state disables submit and shows `StageStatus`; API failure renders `ErrorBanner` with Retry preserving all entered fields.
- [ ] Implement `ManualTab`; note in a comment that step-image-to-step assignment is by sorted filename server-side (specs/05), so the file list is displayed sorted the same way to set expectations.
- [ ] Verify: `pnpm --filter web run test`. Manual smoke against the real backend with one image.
- [ ] Commit: `feat(web): manual ingestion tab with pre-submit validation mirroring server limits`.

## Task 7: Load JSON Tab

**Files:** create `apps/web/src/components/ingest/LoadJsonTab.tsx` (+ `.test.tsx`); wire into `IngestTabs.tsx`.

**Interfaces:**
- Consumes: `validateRecipe` (Task 3).
- Produces: `LoadJsonTab({ onRecipe })` — `.json` file picker + "Load Recipe" button. Reads the file client-side (`file.text()`), `JSON.parse` with a friendly parse-error path, POSTs the candidate to `/api/recipe/validate`; on `valid:true` fires `onRecipe(recipe, null)` (no diagnostics — not a fresh ingestion); on `valid:false` renders field-level errors from the flattened Zod payload (`fieldErrors` grouped by path, `formErrors` on top). Never auto-saves (spec 13).

- [ ] Write `LoadJsonTab.test.tsx` first: non-JSON file content shows a parse error without calling the API; `valid:false` response renders each field error under its field name; `valid:true` fires `onRecipe` with the normalized recipe from the response (not the raw file content); transport failure renders `ErrorBanner`.
- [ ] Implement `LoadJsonTab` plus a small shared field-error list renderer in `components/review/FieldErrors.tsx` if trivially shared with Task 10, else inline.
- [ ] Verify: `pnpm --filter web run test`. Manual smoke: download a recipe via the backend download route, load it back through the tab.
- [ ] Commit: `feat(web): Load JSON tab validating via /api/recipe/validate`.

## Task 8: Review Panel — Full Editing with Thumbnails

**Files:** create `apps/web/src/components/review/ReviewPanel.tsx` (+ `.test.tsx`), `IngredientEditor.tsx` (+ `.test.tsx`), `StepEditor.tsx` (+ `.test.tsx`), `WarningsPanel.tsx` (+ `.test.tsx`); wire into `App.tsx`.

**Interfaces:**
- Consumes: `CanonicalRecipe` state + an immutable-update `onChange(recipe)` from `App` (Task 4), `ingredientImageUrl` (Task 3).
- Produces:
  - `ReviewPanel({ recipe, diagnostics, onChange })` — title text input (140-char maxlength), time number input (nullable: empty string -> `null`, else integer minutes), tag editor slot (Task 9), ingredient section, steps section, read-only pantry section ("derived from the fixed pantry allowlist"), `WarningsPanel`, and a small diagnostics line (extractor/model/durationMs) when present.
  - `IngredientEditor` — one row per ingredient: thumbnail `<img>` (from `ingredientImageUrl`, `onError` falls back to the not-found image), editable `name`/`amount_text`/`unit` inputs, remove button; "Add ingredient" appends `{ name: '', amount_text: '', image: undefined }`.
  - `StepEditor` — one block per step: editable `step_header` input and `step_description` textarea (600 maxlength + live character count), read-only step image indicator when `image` is set, remove button (disabled at 1 step); "Add step" (disabled at 6, with a "max 6 steps" hint).
  - `WarningsPanel({ warnings })` — lists `recipe.metadata.warnings` as non-blocking notices, visually distinct (`--color-warning`) from errors; hidden when empty.

- [ ] Write tests first (this is the heart of the phase — be thorough): editing title/time/ingredient/step fields calls `onChange` with a correctly patched recipe and no mutation of the original; time input cleared -> `time: null`; add/remove ingredient rows works and new rows render the not-found thumbnail; step add disabled at 6, remove disabled at 1; description maxlength/counter at 600; pantry items render read-only with no inputs; warnings render each string and disappear when empty; thumbnails resolve manifest filenames to `/ingredient-images/...` and unknown filenames to the fallback.
- [ ] Implement the four components; all updates flow through `onChange` (single source of truth in `App`), which also sets `dirty: true` and clears `savedId` on the workspace state.
- [ ] Verify: `pnpm --filter web run test`. Manual smoke: ingest a URL, edit fields, confirm thumbnails render from the Task 1 mount.
- [ ] Commit: `feat(web): editable review panel with ingredient thumbnails, step caps, and warnings`.

## Task 9: Tag Editor

**Files:** create `apps/web/src/components/review/TagEditor.tsx` (+ `.test.tsx`); wire into `ReviewPanel.tsx`.

**Interfaces:**
- Consumes: `TAG_VOCABULARY` from `shared`; `tags: string[]` + `onChange(tags)` props.
- Produces: `TagEditor` — applied tags rendered as removable chips; all `TAG_VOCABULARY` entries rendered as toggle chips (pressed state when applied); free-text input + "Add" for custom tags (1-40 chars, trimmed); adding disabled at 5 tags with a visible "5 tag maximum" hint; case-insensitive dedupe on add.

- [ ] Write `TagEditor.test.tsx` first: clicking a vocabulary chip adds the tag; clicking an applied chip (or its remove control) removes it; custom tag adds via input + Enter; duplicate (case-insensitive) is rejected with a hint; 6th tag cannot be added (vocabulary chips and input both disabled at 5); empty/41-char custom input rejected; `onChange` always receives a fresh array.
- [ ] Implement `TagEditor` and mount it in `ReviewPanel` (replacing the Task 8 slot).
- [ ] Verify: `pnpm --filter web run test`.
- [ ] Commit: `feat(web): tag editor with vocabulary chips, custom tags, and 5-tag cap`.

## Task 10: JSON Panel — Viewer, Copy, Download, Save Recipe

**Files:** create `apps/web/src/components/json/JsonPanel.tsx` (+ `.test.tsx`), `apps/web/src/lib/json-highlight.ts` (+ `.test.ts`); wire into `App.tsx`.

**Interfaces:**
- Consumes: `CanonicalRecipeSchema` from `shared`, `saveRecipe` (Task 3), `buildRecipeFilename`/`downloadJson` (Task 3), workspace state (`recipe`, `savedId`, `dirty`).
- Produces:
  - `json-highlight.ts`: `highlightJson(json: string): HighlightToken[]` — tokenizes pretty-printed JSON into `key | string | number | literal | punctuation` spans (rendered as React elements, no `dangerouslySetInnerHTML`).
  - `JsonPanel({ recipe, savedId, onSaved })` — pretty-printed (`JSON.stringify(recipe, null, 2)`) highlighted viewer in a monospace `<pre>`; "Copy JSON" (clipboard + "Copied" confirmation); "Download JSON" — runs `CanonicalRecipeSchema.safeParse` first, blocks with field-level errors on failure, else downloads `recipe-{slug}-{YYYYMMDD}.json` containing exactly the current review state; "Save Recipe" — same client-side validation gate, then `saveRecipe`, on success shows `Saved (id: ...)` via `onSaved(id)`, on 422 renders the server's flattened issues, on other failures renders `ErrorBanner`. A subtle "unsaved changes" note when `dirty && savedId === null`.

- [ ] Write `json-highlight.test.ts` first: keys/strings/numbers/booleans/null tokenized correctly for a fixture; round-tripping token text reproduces the input string exactly.
- [ ] Write `JsonPanel.test.tsx` first: viewer reflects live edits (re-render with changed recipe changes output); copy writes the exact JSON string (mock `navigator.clipboard`); download on an invalid recipe (e.g. empty title) shows the failing field and does not call `downloadJson`; download on a valid recipe calls `downloadJson` with the deterministic filename and current state; save happy path posts the exact current recipe and shows the returned id; save 422 renders server issues; save never fires automatically on recipe adoption or edit.
- [ ] Implement `json-highlight.ts` and `JsonPanel.tsx`; wire into `App.tsx` bottom region, threading `onSaved` to set `savedId`/clear `dirty`.
- [ ] Verify: `pnpm --filter web run test && pnpm --filter web run lint && pnpm --filter web run typecheck`.
- [ ] Commit: `feat(web): JSON viewer with copy, deterministic download, and explicit Save Recipe`.

## Task 11: End-to-End Verification Pass and Documentation Updates

**Files:** modify `plans/recipe-maker-implementation-plan.md` (Phase 5 + Phase 6 sections), `README.md`, `CLAUDE.md` (Status paragraph only).

- [ ] Fresh install + full suite: `pnpm install && pnpm -r run test && pnpm -r run lint && pnpm -r run typecheck && pnpm -r run build`.
- [ ] Full manual walkthrough with a real `GEMINI_API_KEY` (both dev servers running):
  - URL flow: extract a real recipe, confirm stage status, thumbnails, warnings display, edit title/tags/ingredients/steps, download (check filename format), copy, save, confirm returned id, restart server, `GET /api/recipe/:id` returns the saved recipe.
  - Manual flow: text + main image + two step images; confirm guardrails fire on an oversized file first; confirm step images assigned by sorted filename.
  - Load JSON flow: load the downloaded file back, confirm identical review state, corrupt a field and confirm field-level validate errors.
  - Error paths: bad URL shows recovery banner; backend stopped shows the network-error hint.
- [ ] Update `plans/recipe-maker-implementation-plan.md`:
  - Add a Phase 5 Scope Note recording the confirmed decisions: ingredient assets now served at `/ingredient-images/*` (closing Phase 4 decision 2's deferral), tag editing via vocabulary chips + custom input, full-edit review panel (add/remove rows, no reorder), Vite dev proxy instead of CORS, RTL/jsdom test setup added, honest single-request stage status, client-side Zod validation gating download/save.
  - Add a Phase 6 Scope Note: the backend half of Phase 6 (tasks 1-2: CRUD routes, RECIPE_NOT_FOUND) already shipped in earlier phases; Phase 6 shrinks to the Library UI (task 3) reusing Phase 5's review/JSON components read-only.
- [ ] Update `README.md`: Status paragraph (Phases 4 and 5 done, frontend workspace usable end-to-end); frontend dev workflow section (run `pnpm --filter server run dev` and `pnpm --filter web run dev` in two terminals; Vite proxies `/api`, `/images`, `/ingredient-images` to port 8787; frontend tests use Vitest + RTL under jsdom).
- [ ] Update `CLAUDE.md` Status to reflect Phase 5 completion.
- [ ] Verify: re-read both docs for consistency with plan/spec conventions (plans and specs updated together per CLAUDE.md).
- [ ] Commit: `docs: record Phase 5 completion, scope decisions, and frontend dev workflow`.

---

## Acceptance Criteria (from master plan, Phase 5)

- [ ] User can complete all three flows (URL, Manual, Load JSON) without touching code — Tasks 5, 6, 7, walkthrough in Task 11.
- [ ] Final JSON download reflects all user edits — single-source-of-truth state (Task 4) + viewer/download reading live state (Tasks 8-10).
- [ ] Error and warning states are understandable and actionable — `ErrorBanner` recovery hints (Task 4), non-blocking `WarningsPanel` separate from errors (Task 8), field-level validation errors (Tasks 7, 10).
- [ ] Save Recipe persists the currently reviewed recipe and only that recipe — explicit save posting current state, never automatic (Task 10), restart check (Task 11).
- Spec 09 extras: stage-level loading states (Tasks 5-7), pantry_items shown as derived (Task 8), deterministic filename `recipe-{slug}-{YYYYMMDD}.json` (Tasks 3, 10), syntax-highlighted JSON + copy (Task 10), Library nav item present as Phase 6 placeholder (Task 4).

## Critical Files

- `apps/web/src/App.tsx`, `apps/web/vite.config.ts`, `apps/web/vitest.config.ts`
- `apps/web/src/api/client.ts`
- `apps/web/src/components/` (ingest/, review/, json/)
- `server/src/app.ts`, `server/src/env.ts`
- `plans/recipe-maker-implementation-plan.md`, `README.md`, `CLAUDE.md`

## Branch

Create `phase-5-milestone-1-frontend` off main (per squash-merge convention: granular commits on branch, squash to main at the end).
