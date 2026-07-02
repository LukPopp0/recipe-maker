# Phase 2: Option A Pipeline (URL Import) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Scope Decisions (confirmed with user)

1. **Post-processing scope**: the master plan's Phase 2 task list includes pantry routing/step compaction/main_image fallback, while specs/12 and the Phase 4 section describe a "reusable module used by both pipelines." This plan builds the real, final post-processing module now (Task 6) rather than inline throwaway logic, so Option B (Phase 3) and Phase 4 just reuse it. Phase 4 is then scoped down to: ingredient image matching (specs/08) + final confidence-metadata/sanitation hardening.
2. **Ingredient image matching (specs/08)** is deferred to Phase 4, not built here. Option A output in this phase leaves `ingredient.image` unset (it's optional in the schema).
3. **URL security guardrails** use a hand-rolled Node-native approach (DNS resolution + private/loopback IP range checks + manual redirect following), no new dependency for that part.
4. **Gemini SDK**: `@google/genai` (current official Google GenAI SDK), added as a new dependency in Task 4.
5. **HTML cleaning**: `node-html-parser` (lightweight parser dependency), added as a new dependency in Task 3.

## Context
Phase 1 built the shared canonical schema/validators, the standardized error/envelope model, a Gemini config module (defaults only, no live calls), the Hono backend skeleton, and `RecipeRepository`. `POST /api/ingest/url` currently returns a `NOT_IMPLEMENTED` stub (`server/src/routes/ingest.ts`). Phase 2 replaces that stub with the real Option A pipeline per specs/04: validate and fetch a URL, run Gemini extraction with a retry path, post-process into canonical shape, re-host images, and return the recipe with diagnostics.

## Architecture
A `server`-only pipeline module (`server/src/services/ingestion/url-ingestion-pipeline.ts`) orchestrates: URL security check -> fetch+clean -> Gemini primary/retry call -> quality gate -> post-processing (pantry/tags/step-compaction/sanitation, reused later by Option B) -> image re-hosting -> canonical output. The `POST /api/ingest/url` route is a thin adapter that calls the pipeline and maps failures to the specs/03 error envelope. Pantry allowlist and tag vocabulary move into `shared/src/constants` (specs/12) so Phase 3/4 and the frontend can reuse them without duplication.

## Tech Stack
Hono (existing), Zod (existing), `@google/genai` (new), `node-html-parser` (new), Node built-in `fetch`/`dns`/`net` for URL guardrails, Vitest per package (existing).

## Global Constraints
- No scope beyond specs/03, 04, 06, 07, 08 (matching-only deferred), 12 and the master plan's Phase 2 section.
- Deterministic generation settings (temperature 0, topP 1, topK 1) from Phase 1's Gemini config module apply to every Gemini call in this phase.
- Every Gemini call must be mockable in tests — no test hits the real Gemini API.
- `PROMPT_VERSION` from Phase 1 (`server/src/services/ai/prompt-version.ts`) is bumped only if prompt text changes after this phase ships; within this phase, one fixed version for both primary and retry prompts.
- Images are stored under `server/data/images` (new, gitignored, mirrors `server/data/recipes` from Phase 1) and served back via a static route — no cloud adapter in this phase (per specs/06, local disk first).

---

## Task 1: Shared Pantry Allowlist and Tag Vocabulary

**Files:** `shared/src/constants/pantry-allowlist.ts` (+ `.test.ts`), `shared/src/constants/tag-vocabulary.ts`, update `shared/src/index.ts`.

- [ ] Write `shared/src/constants/pantry-allowlist.ts`: `PANTRY_ALLOWLIST: string[]` — the 7 entries from specs/12 (`salt`, `pepper`, `sugar`, `butter`, `oil (olive and vegetable)`, `milk`, `flour`) as a plain array; `isPantryItem(normalizedName: string): boolean` doing case-insensitive matching, with the `oil (olive and vegetable)` entry matching normalized names containing "olive oil" or "vegetable oil" specifically (not every oil).
- [ ] Write `shared/src/constants/pantry-allowlist.test.ts`: exact-match entries recognized case-insensitively; "sesame oil" is NOT matched; "olive oil" and "vegetable oil" ARE matched.
- [ ] Write `shared/src/constants/tag-vocabulary.ts`: `TAG_VOCABULARY: string[]` — the 14 entries from specs/12.
- [ ] Update `shared/src/index.ts` to re-export both.
- [ ] Verify: `pnpm --filter shared run test`.
- [ ] Commit: `feat(shared): add pantry allowlist and tag vocabulary constants (specs/12)`.

## Task 2: URL Intake and Security Guardrails

**Files:** `server/src/services/url-ingestion/url-security.ts` (+ `.test.ts`), `server/src/env.ts` (extend).

- [ ] Extend `server/src/env.ts`: add `URL_FETCH_TIMEOUT_MS` (default 8000), `URL_MAX_REDIRECTS` (default 3), `URL_MAX_RESPONSE_BYTES` (default 5_000_000).
- [ ] Write `server/src/services/url-ingestion/url-security.ts`:
  - `validateUrlSyntax(input: string): URL` — throws `AppError('INVALID_URL', ...)` on malformed input or non-`http`/`https` scheme.
  - `isBlockedAddress(ip: string): boolean` — true for loopback (127.0.0.0/8, ::1), private (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, fc00::/7), link-local (169.254.0.0/16, fe80::/10), and 0.0.0.0/unspecified.
  - `resolveAndCheckHost(hostname: string): Promise<void>` — `dns.promises.lookup` (all addresses), throws `AppError('INVALID_URL', 'URL resolves to a blocked network address')` if any resolved address is blocked, or if the hostname itself is a literal blocked IP.
  - `fetchWithGuardrails(url: URL, opts: {timeoutMs, maxRedirects, maxBytes}): Promise<{html: string, effectiveUrl: string}>` — uses `fetch` with `redirect: 'manual'`; on each 3xx response, re-runs `validateUrlSyntax` + `resolveAndCheckHost` on the `Location` header before following, up to `maxRedirects` (else throws `AppError('URL_FETCH_TIMEOUT', ...)` — reuse this code for "too many redirects" too, per specs/03's minimum error set); wraps the whole fetch in an `AbortController` timeout throwing `AppError('URL_FETCH_TIMEOUT', ...)`; reads the body via a streaming reader, aborting and throwing `AppError('INVALID_INPUT', 'Response too large')` if `maxBytes` is exceeded before the stream ends.
- [ ] Write `.test.ts`: rejects `ftp://`/malformed URLs; rejects `http://localhost`, `http://127.0.0.1`, `http://169.254.169.254` (cloud metadata endpoint), `http://10.0.0.5`; accepts a normal public hostname (mock `dns.promises.lookup` to return a public IP); redirect loop beyond max throws; oversized mocked response throws; timeout throws (fake timers or a slow mock fetch).
- [ ] Verify: `pnpm --filter server run test`.
- [ ] Commit: `feat(server): add URL intake security guardrails (scheme, private-network, redirect, size, timeout)`.

## Task 3: Fetch and Clean Source Content for Extraction

**Files:** `server/src/services/url-ingestion/html-cleaner.ts` (+ `.test.ts`).

- [ ] `pnpm --filter server add node-html-parser`.
- [ ] Write `server/src/services/url-ingestion/html-cleaner.ts`:
  - `cleanHtmlForExtraction(html: string, tokenBudgetChars: number): { cleanedText: string, candidateImageUrls: string[], titleHint: string | null }` — parses with `node-html-parser`, removes `script`/`style`/`noscript`/comment nodes, extracts visible text (collapsing whitespace), truncates to `tokenBudgetChars` favoring the largest contiguous text block (naive heuristic: prefer content inside `<article>`/`main`/the largest `<div>` by text length if present, else full body text) so the primary Gemini call stays within `GEMINI_TOKEN_BUDGET`'s rough character-budget proxy.
  - `candidateImageUrls`: collect `og:image`, `twitter:image` meta content, and `<img src>` values (absolute-resolved against the effective URL), deduplicated, capped at 10 — passed to Gemini as auxiliary context only (per master plan 5.a.2), not authoritative.
  - `titleHint`: `<title>` or `og:title` content, trimmed.
- [ ] Write `.test.ts`: strips script/style tags from output text; extracts `og:image` and relative `<img>` srcs resolved to absolute URLs; truncates long input to the budget; handles malformed/empty HTML without throwing.
- [ ] Verify: `pnpm --filter server run test`.
- [ ] Commit: `feat(server): add HTML cleaning and candidate-image extraction for URL ingestion`.

## Task 4: Gemini Client and URL Ingestion Prompts

**Files:** `server/src/services/ai/gemini-client.ts` (+ `.test.ts`), `server/src/services/ai/prompts/url-ingestion.ts` (+ `.test.ts`).

- [ ] `pnpm --filter server add @google/genai`.
- [ ] Write `server/src/services/ai/gemini-client.ts`: `GeminiClient` wrapping `@google/genai`'s client, constructed from `GeminiConfig` (Phase 1). `generateCanonicalRecipe({ model, prompt, timeoutMs }): Promise<unknown>` — calls the model with `responseMimeType: 'application/json'` and the deterministic `generationConfig`, enforces `timeoutMs` via `AbortController`, `JSON.parse`s the response text, throws `AppError('AI_NORMALIZATION_FAILED', ...)` on timeout, non-2xx, or unparseable JSON. Constructor accepts an injectable underlying SDK client so tests never hit the network.
- [ ] Write `server/src/services/ai/gemini-client.test.ts`: successful call returns parsed JSON; malformed JSON response throws `AI_NORMALIZATION_FAILED`; timeout throws `AI_NORMALIZATION_FAILED`.
- [ ] Write `server/src/services/ai/prompts/url-ingestion.ts`:
  - `buildUrlIngestionPrompt({ url, cleanedText, candidateImageUrls, titleHint }): string` — instructs the model per specs/04's "Gemini Prompting Requirements": output must conform to `CanonicalRecipe` field names exactly (embed a compact description of the shape, not the full Zod schema); preserve ingredient order; only merge/summarize steps if count > 6, otherwise leave step count as extracted (compaction is still deterministically re-verified in Task 6, this is a hint not a guarantee); keep each `step_description` under 600 chars; route fixed pantry-list items into `pantry_items` (embed `PANTRY_ALLOWLIST` from `shared`) and exclude them from `ingredients`; never hallucinate missing fields — use `null`/empty and add a note to `metadata.warnings` instead; select tags from `TAG_VOCABULARY` (embed the list) primarily, custom tags allowed; set `metadata.source_type: 'url'`, `metadata.source_url: url`, `metadata.language: 'en'`.
  - `buildUrlIngestionRetryPrompt({ url, reducedText, candidateImageUrls })` — same contract, shorter/focused content, explicit instruction that the first attempt failed schema validation and to be strict about required fields.
- [ ] Write `.test.ts` for the prompt builders: asserts required instruction fragments are present (pantry list embedded, 6-step/600-char/order-preservation instructions present, tag vocabulary embedded) — string-content assertions, not AI behavior.
- [ ] Verify: `pnpm --filter server run test`.
- [ ] Commit: `feat(server): add Gemini client wrapper and URL ingestion prompts`.

## Task 5: URL Ingestion Pipeline (Primary + Retry + Quality Gate)

**Files:** `server/src/services/ingestion/url-ingestion-pipeline.ts` (+ `.test.ts`).

- [ ] Write `server/src/services/ingestion/url-ingestion-pipeline.ts`: `runUrlIngestionPipeline({ url, geminiClient, geminiConfig, requestId }): Promise<{ recipeCandidate: unknown, diagnostics: { extractor: 'gemini-primary'|'gemini-retry', model: string, durationMs: number } }>`
  - Step 1-2: `validateUrlSyntax` + `resolveAndCheckHost` (Task 2).
  - Step 3: `fetchWithGuardrails` (Task 2) with env-configured timeout/redirects/size.
  - Step 4: `cleanHtmlForExtraction` (Task 3).
  - Step 5: minimum-content pre-check per specs/04 failure conditions — if `cleanedText` is empty/near-empty, throw `AppError('URL_EXTRACTION_FAILED', 'This page does not contain a recognizable recipe. Try another URL or use manual input.')` before even calling Gemini.
  - Step 6: call `geminiClient.generateCanonicalRecipe` with the primary prompt + `geminiConfig.primaryModel`; run a **light structural pre-check** (has non-empty title, at least one ingredient, at least one step — not full Zod validation yet, that's post-processing's job) on the parsed result.
  - Step 7: if the primary call throws or fails the pre-check, retry once with `buildUrlIngestionRetryPrompt` + `geminiConfig.retryModel` against a further-reduced content chunk (reuse `cleanHtmlForExtraction` with a smaller `tokenBudgetChars`); same pre-check.
  - Step 8: if retry also fails, throw `AppError('URL_EXTRACTION_FAILED', 'Could not extract a usable recipe from this URL.')` (mirrors specs/03's example error).
  - Track `extractor` (`gemini-primary` or `gemini-retry`), `model` used, and `durationMs` (wall clock from step 3 start) for diagnostics.
- [ ] Write `.test.ts` with a fake `GeminiClient`: primary success -> `extractor: 'gemini-primary'`; primary returns garbage/fails pre-check, retry succeeds -> `extractor: 'gemini-retry'`; both fail -> throws `URL_EXTRACTION_FAILED`; blocked URL throws `INVALID_URL` before any Gemini call; empty page content throws `URL_EXTRACTION_FAILED` without calling Gemini.
- [ ] Verify: `pnpm --filter server run test`.
- [ ] Commit: `feat(server): add URL ingestion pipeline with primary/retry Gemini calls and quality gate`.

## Task 6: Canonical Post-Processing Module (Pantry, Tags, Step Compaction, Sanitation)

**Files:** `server/src/services/post-processing/pantry-classifier.ts` (+ `.test.ts`), `tag-normalizer.ts` (+ `.test.ts`), `step-compaction.ts` (+ `.test.ts`), `sanitize.ts` (+ `.test.ts`), `index.ts` (+ `.test.ts`).

- [ ] Write `pantry-classifier.ts`: `classifyPantryItems(ingredients: RawIngredient[]): { ingredients: RawIngredient[], pantry_items: string[] }` — uses `isPantryItem` from `shared` (Task 1) against each normalized ingredient name; moves matches into `pantry_items` (deduplicated, display-cased per specs/02 rule "lowercase matching keys but preserve display form"), removes them from `ingredients`.
- [ ] Write `.test.ts`: pantry items routed and removed from ingredients; non-pantry oils stay in ingredients; dedup works when the same pantry item appears twice.
- [ ] Write `tag-normalizer.ts`: `normalizeTags(rawTags: string[]): string[]` — case-insensitive match against `TAG_VOCABULARY` (shared), preserves canonical casing from the vocabulary for matches, keeps unmatched tags as custom (trimmed, 1-40 chars), deduplicates case-insensitively, caps at 5 (vocabulary matches take priority over custom tags when trimming to 5).
- [ ] Write `.test.ts`: vocabulary match normalizes casing; custom tag preserved; over-5 list trimmed with vocabulary tags kept first; case-insensitive dedup.
- [ ] Write `step-compaction.ts`: `compactSteps(steps: {step_header, step_description}[]): {step_header, step_description}[]` implementing specs/07's deterministic algorithm — no-op if `steps.length <= 6`; else merge adjacent steps by grouping into exactly 6 groups (even-ish split preferring to merge shorter adjacent steps first, per spec: "prefer merging short adjacent steps," never reorder), concatenated description with `' '` join and cleaned-up transitions (strip duplicate whitespace), header = first grouped step's header if a group has 1 step, else a short joined summary (e.g. `"A / B"` capped at reasonable length) — re-index and return exactly 6.
- [ ] Write `.test.ts` per specs/07's test-case list: 6-step input unchanged; 7/8/10/12-step inputs each produce exactly 6 steps with original order preserved; a step containing a safety cue (e.g. "cook chicken to 74C") is never dropped from any merged description; identical input produces identical output (determinism check run twice).
- [ ] Write `sanitize.ts`: `finalSanitize(recipe: CanonicalRecipe, defaultMainImageUrl: string): CanonicalRecipe` — trims all strings, collapses multi-spaces, clamps each `step_description` to 600 chars (hard clamp as the final safety net even after compaction/prompt hints), applies `applyMainImageFallback` (from Phase 1's `shared` schema module) using `defaultMainImageUrl`, dedupes tags/pantry_items again as a final guarantee, then re-validates the whole object against `CanonicalRecipeSchema` — throws `AppError('SCHEMA_VALIDATION_FAILED', ...)` with the Zod issues in `details` if anything still doesn't conform.
- [ ] Write `.test.ts`: over-600-char description clamped; missing `main_image` gets the configured default; whitespace collapsed; a fully valid recipe passes through unchanged; a recipe that's still invalid after sanitation throws `SCHEMA_VALIDATION_FAILED` with issue details.
- [ ] Write `index.ts`: `applyPostProcessing(candidate: RawRecipeCandidate, { defaultMainImageUrl }): CanonicalRecipe` — runs pantry classification -> tag normalization -> step compaction -> final sanitize, in that order (matches specs/04 step 6's ordering).
- [ ] Write `index.test.ts`: an unsanitized 9-step, unrouted-pantry, over-budget-tags raw candidate comes out fully schema-valid after one `applyPostProcessing` call.
- [ ] Verify: `pnpm --filter server run test`.
- [ ] Commit: `feat(server): add reusable canonical post-processing module (pantry, tags, step compaction, sanitation)`.

## Task 7: Image Storage Adapter and Re-hosting

**Files:** `server/src/services/storage/storage-adapter.ts`, `local-disk-storage-adapter.ts` (+ `.test.ts`), `server/src/services/images/image-rehoster.ts` (+ `.test.ts`), `server/src/env.ts` (extend), `server/src/app.ts` (extend — static image route).

- [ ] Extend `server/src/env.ts`: `IMAGE_DATA_DIR` (default `./data/images`, resolved absolute, mirrors `RECIPE_DATA_DIR`), `IMAGE_MAX_BYTES` (default 8_000_000), `PUBLIC_BASE_URL` (default `http://localhost:{PORT}`, used to build absolute hosted image URLs).
- [ ] Write `storage-adapter.ts`: `StorageAdapter` interface — `put(fileBuffer: Buffer, key: string, contentType: string): Promise<string>` (returns public URL), `get(key: string): Promise<Buffer>`, `delete(key: string): Promise<void>`.
- [ ] Write `local-disk-storage-adapter.ts`: `LocalDiskStorageAdapter` implementing the above against `IMAGE_DATA_DIR`, keys namespaced `recipes/{recipeId}/{kind}-{index}.{ext}` per specs/06; `put` creates subdirs as needed and returns `${PUBLIC_BASE_URL}/images/${key}`; `get` throws a `AppError('INTERNAL_ERROR', ...)`-wrapped not-found for missing keys (only used internally, not exposed as its own route in this phase — static serving is via Hono's static middleware, not this method); `delete` idempotent.
- [ ] Write `.test.ts`: put then serving the returned URL path resolves to the same bytes on disk; delete removes the file; delete on missing key doesn't throw.
- [ ] Write `image-rehoster.ts`: `rehostRecipeImages(recipe, { recipeId, storageAdapter, maxBytes }): Promise<{ recipe: CanonicalRecipe, warnings: string[] }>` — downloads `recipe.main_image` (if it's a remote `http(s)` URL, i.e. came from Gemini/candidate extraction rather than already being the configured default), validates MIME (jpeg/png/webp only) and `maxBytes`, re-hosts via `storageAdapter.put`, replaces `main_image` with the hosted URL; on any failure (bad MIME, oversized, fetch error), does **not** throw — leaves `main_image` as-is for `finalSanitize`'s fallback to handle, and appends a warning string. No step images to process in this phase (Option A doesn't produce step images per specs/04; that's Option B/manual only) — the function accepts an optional `stepImages` param now so Task 6-of-Phase-3 can reuse it, but Phase 2 always passes an empty array.
- [ ] Write `.test.ts`: valid remote image re-hosted, URL replaced; invalid MIME produces a warning and leaves the field untouched; oversized image produces a warning and leaves the field untouched; already-default `main_image` (matches configured default) is not re-downloaded.
- [ ] Extend `server/src/app.ts`: serve `IMAGE_DATA_DIR` at `/images/*` via `@hono/node-server/serve-static` (or Hono's built-in static middleware), added to `AppDeps`.
- [ ] Verify: `pnpm --filter server run test`.
- [ ] Commit: `feat(server): add local disk storage adapter and image re-hosting for recipe images`.

## Task 8: Wire `POST /api/ingest/url` End-to-End

**Files:** modify `server/src/routes/ingest.ts`, `server/src/app.ts`, `server/src/index.ts`.

- [ ] Update `AppDeps` (`app.ts`) to add `geminiClient: GeminiClient`, `geminiConfig: GeminiConfig`, `storageAdapter: StorageAdapter`, `defaultMainImageUrl: string`.
- [ ] Rewrite `server/src/routes/ingest.ts`'s `POST /ingest/url` handler:
  1. `parseJsonBody(c, IngestUrlRequestSchema)` (Phase 1's `shared` schema).
  2. `runUrlIngestionPipeline` (Task 5) -> raw candidate + diagnostics.
  3. `applyPostProcessing` (Task 6) -> canonical recipe (still referencing original remote image URLs at this point).
  4. `rehostRecipeImages` (Task 7) using a fresh `randomUUID()` as the working `recipeId` (this is *not* a saved recipe id — save is a separate explicit action per Phase 1/master-plan; it's only used for the image storage key namespace) -> final recipe + image warnings.
  5. Merge image warnings into `recipe.metadata.warnings`.
  6. Return `ok(requestId, { recipe, diagnostics })` per specs/03's response shape.
  - Map thrown `AppError`s straight through the existing `error-handler` middleware (Phase 1) — no new error-mapping logic needed here since every layer already throws the correct `ErrorCode`.
- [ ] `POST /ingest/manual` stays the `NOT_IMPLEMENTED` stub (Phase 3's job).
- [ ] Update `server/src/index.ts`: construct `loadGeminiConfig(process.env)`, a real `GeminiClient`, `LocalDiskStorageAdapter`, pass into `createApp`.
- [ ] Write/extend `server/src/routes/ingest.test.ts`: full HTTP-layer round trip with a fake `GeminiClient` and mocked `fetch` (both the page-fetch and the image-download) returning a fixture recipe page HTML + a fixture image buffer — asserts final response is schema-valid, `diagnostics.extractor` present, image URL points at `/images/...`; blocked/private URL -> 400 `INVALID_URL`; page with no recognizable recipe content -> 422 `URL_EXTRACTION_FAILED`; manual route still returns 501.
- [ ] Verify: `pnpm --filter server run test && pnpm --filter server run lint`.
- [ ] Commit: `feat(server): wire POST /api/ingest/url to the real Option A pipeline`.

## Task 9: Workspace-Wide Verification Pass

- [ ] Fresh install + full suite: `pnpm install && pnpm -r run test && pnpm -r run lint`.
- [ ] Manual smoke test against a real public recipe URL (requires a real `GEMINI_API_KEY` in `server/.env` — not committed): boot `pnpm --filter server run dev`, `curl -X POST localhost:8787/api/ingest/url -d '{"url":"<a real recipe URL>"}' -H 'content-type: application/json'`, confirm a schema-valid recipe with a `/images/...` main image comes back; try `http://127.0.0.1` (expect `INVALID_URL`); try a non-recipe page like `https://example.com` (expect `URL_EXTRACTION_FAILED`); kill the server.
- [ ] `git status --porcelain server/data` — confirm empty (recipes and images dirs both untracked/ignored).
- [ ] Commit any fixups only if issues surfaced: `chore: fix workspace-wide lint/test/build issues from Phase 2 verification pass`.

---

## Acceptance Criteria (from master plan, Phase 2)
- [ ] Supported URL returns valid canonical recipe — Task 8/9 integration test + manual smoke test.
- [ ] Invalid/non-recipe URL returns explicit reason and guidance — `URL_EXTRACTION_FAILED`/`INVALID_URL` messages match specs/04's example wording.
- [ ] Same URL and promptVersion produce stable schema-valid output — deterministic `generationConfig` (Phase 1) + deterministic post-processing (Task 6) with mocked-Gemini tests asserting repeatable output.
- [ ] `main_image` is always present (original hosted URL or configured default) — `finalSanitize`'s `applyMainImageFallback` call (Task 6) is unconditional.

## Critical Files
- `server/src/services/ingestion/url-ingestion-pipeline.ts`
- `server/src/services/post-processing/index.ts`
- `server/src/services/url-ingestion/url-security.ts`
- `server/src/services/images/image-rehoster.ts`
- `server/src/routes/ingest.ts`
- `shared/src/constants/pantry-allowlist.ts`
