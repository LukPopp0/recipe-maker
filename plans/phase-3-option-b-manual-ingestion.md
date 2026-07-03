# Phase 3: Option B Pipeline (Manual Input) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Scope Decisions (confirmed with user)

1. **Backend only, no frontend form.** Master plan's Phase 3 task list mentions "build manual input form," but that overlaps with Phase 5 ("Milestone 1 Frontend Completion"), which owns the URL/Manual/Load JSON tabs UI. This plan mirrors Phase 2's pattern: it ships `POST /api/ingest/manual` end-to-end (multipart parsing, Gemini normalization, step-image assignment, reused post-processing/image-hosting) with no React UI. The manual-entry form is built in Phase 5.
2. **No Gemini retry path for manual ingestion.** Unlike Option A (specs/04), specs/05 does not describe a retry-on-quality-gate-failure flow for manual input — raw user text is much lower-risk of "no recipe found" than a scraped page. This plan makes exactly one Gemini call per request; if it fails or fails the structural pre-check, the request fails with `AI_NORMALIZATION_FAILED` (no retry, no second prompt). If real-world testing later shows this is too brittle, a retry can be added without changing the route contract.
3. **Ingredient image matching stays deferred to Phase 4.** Same as Option A: `ingredient.image` is left unset by this pipeline. Only *step* images (user-uploaded, assigned by filename order) are wired up here, per specs/05's "Step Image Assignment" section.
4. **Step image assignment is a deterministic backend rule, not a Gemini task.** specs/05 lists "Step Image Assignment" as its own section, separate from "Gemini Normalization," and its rule ("map images to parsed steps by index") only needs the *count and order* of steps Gemini returns — not the image bytes themselves. So: Gemini receives text only (no image binaries), returns a normalized `steps` array; this backend then zips sorted step-image URLs onto that array by index, before handing off to the existing post-processing module (compaction, sanitation, etc.) from Phase 2, which already treats `RawStep.image` as a pass-through field (see `server/src/services/post-processing/step-compaction.ts:6-7`).
5. **Uploaded images are hosted directly, not "downloaded."** Option A's `rehostRecipeImages` downloads a *remote URL* through the SSRF-guarded fetch path. Manual uploads are already local buffers (from multipart parsing) — there is nothing to fetch. This plan adds a small sibling module, `upload-image-hoster.ts`, that validates an uploaded buffer's MIME/size and calls `StorageAdapter.put` directly, reusing the `ALLOWED_CONTENT_TYPES` map from `image-rehoster.ts` (exported for reuse rather than duplicated).
6. **Request-size guardrail (specs/03 "Max request size for manual uploads")** is implemented with Hono's built-in `bodyLimit` middleware mounted only on `/ingest/manual`, using a new `MANUAL_REQUEST_MAX_BYTES` env var. Per-file MIME/size validation (`IMAGE_MAX_BYTES`, already defined in Phase 2) happens afterward, in the upload hoster.
7. **Tags are fully user-set for manual ingestion, not Gemini-assigned.** Unlike Option A, where Gemini picks tags from `TAG_VOCABULARY` (specs/12), the manual-ingestion prompt does not ask Gemini to produce `tags` at all - the field is omitted from the requested output shape, same treatment as `main_image`. The pipeline always sets `candidate.tags = []` after the Gemini call, before handing off to Phase 2's post-processing module (whose tag-normalizer step becomes a no-op passthrough for an empty array). The user assigns tags entirely in the review UI; that UI wiring is out of scope for this phase and lands in Phase 5.

## Context
Phase 2 built the reusable canonical post-processing module (pantry classification, tag normalization, step compaction, final sanitation — `server/src/services/post-processing/`), the `GeminiClient` wrapper, the `LocalDiskStorageAdapter`/`StorageAdapter` interface, and wired `POST /api/ingest/url` end-to-end. `POST /api/ingest/manual` currently throws a `NOT_IMPLEMENTED` stub (`server/src/routes/ingest.ts:73-75`). Phase 3 replaces that stub with the real Option B pipeline per specs/05: parse the multipart form, validate/host the uploaded images, run a single Gemini normalization call over the raw text, assign step images by sorted-filename index, then reuse Phase 2's post-processing module unchanged.

## Architecture
A new `server/src/services/ingestion/manual-ingestion-pipeline.ts` orchestrates: multipart parse+validate -> upload-host main/step images -> single Gemini call over raw text -> structural pre-check -> step-image assignment by index -> `applyPostProcessing` (Phase 2, unmodified) -> final canonical recipe. `POST /api/ingest/manual` becomes a thin adapter, mirroring `POST /api/ingest/url`'s existing shape in `server/src/routes/ingest.ts`.

## Tech Stack
Hono's built-in multipart body parsing (`c.req.parseBody`) and `hono/body-limit` middleware (both already available via the existing `hono` dependency — no new packages), plus everything Phase 2 already added (`@google/genai`, Zod, Vitest).

## Global Constraints
- No scope beyond specs/03, 05, 06, 07 (compaction reused unmodified) and the master plan's Phase 3 section.
- Deterministic generation settings (temperature 0, topP 1, topK 1) from Phase 1's Gemini config module apply to the manual-ingestion Gemini call, same as Option A.
- Every Gemini call must be mockable in tests — no test hits the real Gemini API.
- `PROMPT_VERSION` (`server/src/services/ai/prompt-version.ts`) is reused as-is; this phase does not bump it.
- Uploaded images are stored under the same `IMAGE_DATA_DIR` used by Option A (`server/data/images`), keyed `recipes/{recipeId}/main-0.{ext}` and `recipes/{recipeId}/step-{index}.{ext}` per specs/06.
- `english input only for milestone 1` — no language handling beyond `metadata.language: 'en'`.

---

## Task 1: Export Shared Image-Validation Constants

**Files:** modify `server/src/services/images/image-rehoster.ts`, create `server/src/services/images/image-rehoster.test.ts` assertion addition (if not already covering this — check existing test file first and only add what's missing).

- [x] In `server/src/services/images/image-rehoster.ts`, change `const ALLOWED_CONTENT_TYPES` to `export const ALLOWED_CONTENT_TYPES` (no behavior change — this is the same map Option A already uses: `image/jpeg` -> `jpg`, `image/png` -> `png`, `image/webp` -> `webp`).
- [x] Run the existing `image-rehoster.test.ts` suite to confirm the export change didn't break anything: `pnpm --filter server run test -- image-rehoster`.
- [x] Commit: `refactor(server): export ALLOWED_CONTENT_TYPES for reuse by manual-ingestion image hosting`.

## Task 2: Uploaded-Image Hosting (Main + Step Images)

**Files:** `server/src/services/images/upload-image-hoster.ts` (+ `.test.ts`).

- [x] Write `server/src/services/images/upload-image-hoster.ts`:
  - `export interface UploadedFile { buffer: Buffer; contentType: string; filename: string }`
  - `export interface HostUploadedImageOptions { recipeId: string; storageAdapter: StorageAdapter; maxBytes: number; kind: 'main' | 'step'; index: number }`
  - `export async function hostUploadedImage(file: UploadedFile, options: HostUploadedImageOptions): Promise<{ url: string } | { warning: string }>` — validates `file.contentType` against `ALLOWED_CONTENT_TYPES` (imported from `image-rehoster.ts`, Task 1); validates `file.buffer.length <= maxBytes`; on either failure, returns `{ warning: <message naming file.filename and the reason> }` (never throws — mirrors `rehostRecipeImages`'s non-critical-failure contract from specs/06); on success, calls `storageAdapter.put(file.buffer, \`recipes/${options.recipeId}/${options.kind}-${options.index}.${ext}\`, file.contentType)` and returns `{ url: hostedUrl }`.
- [x] Write `.test.ts` with a fake `StorageAdapter` (`put` returns a deterministic fake URL): valid jpeg/png/webp buffer hosts successfully and returns the expected key shape; unsupported MIME (e.g. `image/gif`) returns a warning, does not call `put`; oversized buffer (length > `maxBytes`) returns a warning, does not call `put`; `kind`/`index` are reflected correctly in the storage key for both `main` and `step` kinds.
- [x] Verify: `pnpm --filter server run test -- upload-image-hoster`.
- [x] Commit: `feat(server): add uploaded-image hosting for manual ingestion (main + step images)`.

## Task 3: Step Image Sorting and Index Assignment

**Files:** `server/src/services/manual-ingestion/step-image-assigner.ts` (+ `.test.ts`).

- [x] Write `server/src/services/manual-ingestion/step-image-assigner.ts`:
  - `export interface StepImageAssignmentResult { stepImageUrls: (string | undefined)[]; warnings: string[] }`
  - `export function sortStepImageFilenames<T extends { filename: string }>(files: T[]): T[]` — returns a new array sorted ascending by `filename`, case-insensitive **and numeric-aware** ("natural sort"): use `filename.localeCompare(other.filename, undefined, { numeric: true, sensitivity: 'base' })` so `step2.jpg` sorts before `step10.jpg` (not `step10` before `step2`, which plain lexicographic compare would produce).
  - `export function assignStepImageUrls(hostedStepImageUrls: string[], stepCount: number): StepImageAssignmentResult` — takes the *already-sorted, already-hosted* step image URLs (hosting happens in Task 2, sorting order is decided by this module before hosting is called by the pipeline — see Task 6) and `stepCount` (the number of steps Gemini returned); returns `stepImageUrls` of length `stepCount` where index `i` gets `hostedStepImageUrls[i]` if it exists, else `undefined`; if `hostedStepImageUrls.length > stepCount`, appends one warning: `` `${hostedStepImageUrls.length - stepCount} step image(s) were ignored: more images were uploaded than recipe steps.` ``.
- [x] Write `.test.ts`: `sortStepImageFilenames` sorts `['file10.jpg', 'file2.jpg', 'FILE1.jpg']` to `['FILE1.jpg', 'file2.jpg', 'file10.jpg']` (numeric-aware: `file2` before `file10`, not lexicographic `file10` before `file2`), and case-insensitivity is asserted separately with `['STEP-b.jpg', 'step-a.jpg']` -> `['step-a.jpg', 'STEP-b.jpg']`; `assignStepImageUrls` with 3 images and 3 steps maps 1:1 with no warnings; with 2 images and 3 steps, step index 2 gets `undefined`, no warning; with 4 images and 2 steps, only the first 2 are assigned and one warning is produced naming the ignored count.
- [x] Verify: `pnpm --filter server run test -- step-image-assigner`.
- [x] Commit: `feat(server): add step-image filename sorting and index-based assignment (specs/05)`.

## Task 4: Multipart Request Parsing and Validation

**Files:** `server/src/services/manual-ingestion/manual-upload-parser.ts` (+ `.test.ts`), `server/src/env.ts` (extend).

- [x] Extend `server/src/env.ts`: add `MANUAL_REQUEST_MAX_BYTES` (`z.coerce.number().int().positive().default(20_000_000)`) to `ServerEnvSchema`, following the exact pattern of the existing `URL_MAX_RESPONSE_BYTES` field (same file, same style).
- [x] Write `server/src/services/manual-ingestion/manual-upload-parser.ts`:
  - `export interface ParsedManualUpload { ingredientsText: string; stepsText: string; mainImage: UploadedFile; stepImages: UploadedFile[] }` (reuse `UploadedFile` from Task 2's module).
  - `export async function parseManualUploadBody(c: Context): Promise<ParsedManualUpload>` — calls `c.req.parseBody({ all: true })` (Hono's multipart parser); reads `ingredientsText`/`stepsText` as strings, trims and normalizes newlines to `\n` (per specs/05 "trim obvious leading/trailing whitespace and normalize newlines"); throws `AppError('INVALID_INPUT', 'ingredientsText is required.')` / `'stepsText is required.'` if either is missing or empty after trimming; throws `AppError('INVALID_INPUT', 'mainImage is required.')` if `mainImage` is missing or not a `File`; converts the `mainImage` `File` (and each `stepImages` entry, normalizing Hono's parseBody single-file-vs-array quirk — when only one file is uploaded under a repeated field name, Hono returns a single `File` rather than an array, so explicitly coerce to an array) into `UploadedFile` objects via `Buffer.from(await file.arrayBuffer())`, `file.type`, `file.name`.
- [x] Write `.test.ts` using a real `Request` with a `FormData` body (no need to mock Hono internals — construct `new Request('http://x', { method: 'POST', body: formData })` and wrap in a minimal Hono `Context` via a throwaway `new Hono().post('/x', (c) => parseManualUploadBody(c))` test route, matching the pattern other route-adjacent parsers in this repo use): missing `ingredientsText` throws `INVALID_INPUT`; missing `mainImage` throws `INVALID_INPUT`; valid payload with one `stepImages` file returns a single-element array (not a bare object); valid payload with three `stepImages` files returns all three; newline normalization collapses `\r\n` to `\n` in `ingredientsText`.
- [x] Verify: `pnpm --filter server run test -- manual-upload-parser`.
- [x] Commit: `feat(server): add multipart parsing and validation for manual ingestion requests`.

## Task 5: Gemini Prompt for Manual Normalization

**Files:** `server/src/services/ai/prompts/manual-ingestion.ts` (+ `.test.ts`).

- [x] Write `server/src/services/ai/prompts/manual-ingestion.ts`, following the exact structure of `server/src/services/ai/prompts/url-ingestion.ts` (same `CANONICAL_RECIPE_SHAPE` block, same pantry embedding), with these differences:
  - `export interface BuildManualIngestionPromptParams { ingredientsText: string; stepsText: string; stepImageCount: number }`.
  - `export function buildManualIngestionPrompt({ ingredientsText, stepsText, stepImageCount }: BuildManualIngestionPromptParams): string` — instructs the model to extract from raw user-provided text rather than a scraped page (no "source URL" framing); explicitly says: "Preserve the sequence and core meaning of the user's steps — do not reorder, invent, or drop steps."; does **not** ask the model to pick or reference any image (main image and step images are hosted and assigned deterministically by the backend, not by Gemini) — mention `stepImageCount` only as context ("the user uploaded {stepImageCount} step image(s), which will be attached to steps by the backend after normalization — do not attempt to describe or reference them"); sets `metadata.source_type` to `"manual"` (no `source_url` field emitted); omits `main_image` from the required output shape entirely (the backend sets it directly after hosting, per Scope Decision 5) — update the embedded `CANONICAL_RECIPE_SHAPE`-equivalent text in this file to drop `"main_image"` from the requested JSON shape so Gemini never fabricates a value for it; also omits `tags` from the required output shape entirely and does not embed `TAG_VOCABULARY` anywhere in this prompt (Scope Decision 7) — tags are fully user-set in the review UI, not Gemini-assigned, for manual ingestion.
  - Body: `Ingredients (raw user text):\n"""\n${ingredientsText}\n"""\n\nSteps (raw user text):\n"""\n${stepsText}\n"""\n\nReturn only the JSON object, no surrounding text or markdown fences.`
- [x] Write `.test.ts`: asserts required instruction fragments are present (pantry list embedded, 600-char step-description instruction present, "do not reorder" instruction present, `"manual"` source_type instruction present); asserts the output shape description does **not** contain `"main_image"` or `"tags"`; asserts no `TAG_VOCABULARY` entry appears in the prompt.
- [x] Verify: `pnpm --filter server run test -- manual-ingestion` (prompt test only — pipeline test comes in Task 6).
- [x] Commit: `feat(server): add Gemini prompt for manual (Option B) recipe normalization`.

## Task 6: Manual Ingestion Pipeline

**Files:** `server/src/services/ingestion/manual-ingestion-pipeline.ts` (+ `.test.ts`).

- [x] Write `server/src/services/ingestion/manual-ingestion-pipeline.ts`:
  - `export interface RunManualIngestionPipelineParams { parsed: ParsedManualUpload; geminiClient: GeminiClient; geminiConfig: GeminiConfig; storageAdapter: StorageAdapter; recipeId: string; maxImageBytes: number; requestId: string }`
  - `export interface RunManualIngestionPipelineResult { recipeCandidate: RawRecipeCandidate; diagnostics: { extractor: 'gemini-primary'; model: string; durationMs: number }; warnings: string[] }`
  - `export async function runManualIngestionPipeline(params): Promise<RunManualIngestionPipelineResult>`:
    1. Host the main image: `hostUploadedImage(parsed.mainImage, { recipeId, storageAdapter, maxBytes: maxImageBytes, kind: 'main', index: 0 })` (Task 2). If it returns a warning, collect the warning and leave `main_image` unset on the candidate (so `finalSanitize`'s default fallback applies downstream, same as Option A's contract) — do **not** throw, since specs/06 treats image failures as non-critical even though `mainImage` is a required *upload* field (the field itself must be present per specs/05, but a corrupt/oversized file degrading to the default image is still a valid recipe, not a hard failure).
    2. Sort step images: `sortStepImageFilenames(parsed.stepImages)` (Task 3), then host each in order via `hostUploadedImage(file, { ..., kind: 'step', index })` (Task 2), collecting hosted URLs (skipping any that produced a warning, collecting those warnings too).
    3. Call `buildManualIngestionPrompt` (Task 5) with `parsed.ingredientsText`, `parsed.stepsText`, `stepImageCount: parsed.stepImages.length`, then `geminiClient.generateCanonicalRecipe({ model: geminiConfig.primaryModel, prompt, timeoutMs: geminiConfig.timeoutMs })`.
    4. Run the same light structural pre-check Option A's pipeline uses (non-empty title, at least one ingredient, at least one step) — if it fails, throw `AppError('AI_NORMALIZATION_FAILED', 'Could not normalize the provided recipe text.')` (no retry, per Scope Decision 2).
    5. Assign step images: `assignStepImageUrls(hostedStepImageUrls, candidate.steps.length)` (Task 3), merge each URL onto `candidate.steps[i].image`, collect any assignment warning.
    6. Set `candidate.main_image` to the hosted main-image URL if hosting succeeded, else leave it unset/empty.
    6a. Force `candidate.tags = []` regardless of what Gemini returned (the prompt does not ask for tags, but this is a defensive overwrite in case the model emits the field anyway) - tags are fully user-set downstream in the review UI (Scope Decision 7).
    7. Return `{ recipeCandidate: candidate, diagnostics: { extractor: 'gemini-primary', model: geminiConfig.primaryModel, durationMs }, warnings }` — `warnings` accumulates every non-critical warning from steps 1, 2, and 5 (the route, in Task 7, merges these into `recipe.metadata.warnings` after `applyPostProcessing`, exactly like Option A's route merges image-rehosting warnings today).
- [x] Write `.test.ts` with a fake `GeminiClient` and fake `StorageAdapter`: happy path (valid main image, 2 step images, 2 steps returned by Gemini) assigns both step images by index and hosts the main image, no warnings; oversized main image produces a warning and `main_image` left unset on the candidate; more step images than steps produces the "ignored" warning from Task 3; Gemini returning a title-less/stepless candidate throws `AI_NORMALIZATION_FAILED`; determinism check — same fake Gemini response run twice produces identical `recipeCandidate` (excluding `durationMs`).
- [x] Verify: `pnpm --filter server run test -- manual-ingestion-pipeline`.
- [x] Commit: `feat(server): add manual ingestion pipeline (Option B, single-call Gemini normalization)`.

## Task 7: Wire `POST /api/ingest/manual` End-to-End

**Files:** modify `server/src/routes/ingest.ts`, `server/src/app.ts`.

- [x] In `server/src/app.ts`, import `bodyLimit` from `hono/body-limit` and mount it on the manual route only, before `createIngestApp` handles the request — simplest approach: apply it inside `createIngestApp` (Task's own file) rather than globally in `app.ts`, so the limit is scoped to `/ingest/manual` without affecting `/ingest/url`'s JSON body handling. In `server/src/routes/ingest.ts`, add: `app.use('/ingest/manual', bodyLimit({ maxSize: env.MANUAL_REQUEST_MAX_BYTES, onError: () => { throw new AppError('INVALID_INPUT', 'The manual upload request exceeds the maximum allowed size.') } }))` registered before the `app.post('/ingest/manual', ...)` handler.
- [x] Rewrite the `POST /ingest/manual` handler in `server/src/routes/ingest.ts` (replacing the current `NOT_IMPLEMENTED` throw):
  1. `parseManualUploadBody(c)` (Task 4).
  2. `randomUUID()` for a fresh `recipeId` (working image-storage namespace only, same non-persistence caveat as Option A's route comment).
  3. `runManualIngestionPipeline` (Task 6) with `geminiClient`, `geminiConfig`, `storageAdapter`, `recipeId`, `maxImageBytes: env.IMAGE_MAX_BYTES`, `requestId`.
  4. `applyPostProcessing(recipeCandidate, { defaultMainImageUrl })` (Phase 2's module, unmodified) — sets `candidate.metadata` explicitly to `{ source_type: 'manual', language: 'en', warnings: [] }` before this call if Gemini's returned metadata is incomplete (mirror how Option A trusts Gemini's metadata object as-is; for manual, since Gemini is not asked to emit `source_url`, ensure `metadata.source_type` is forced to `'manual'` server-side rather than trusting the model, since the prompt already asks for it but a hallucinated `'url'` value must never leak through).
  5. Merge `runManualIngestionPipeline`'s `warnings` into `canonical.metadata.warnings`, same merge pattern the URL route already uses for image warnings.
  6. Return `c.json(ok(requestId, { recipe: finalRecipe, diagnostics }))`.
- [x] Remove the now-obsolete `NOT_IMPLEMENTED` comment/stub and the `// manual (text+images) ingestion lands in Phase 3` code comment above `createIngestApp`.
- [x] Update `server/src/routes/ingest.test.ts`: replace the existing "POST /api/ingest/manual still returns 501 NOT_IMPLEMENTED" test with a full HTTP-layer round trip using a fake `GeminiClient` and a real multipart `FormData` request (small in-memory JPEG/PNG buffer fixtures) — asserts: valid multipart request returns a schema-valid `recipe` with `metadata.source_type === 'manual'`, hosted `main_image` and step `image` URLs pointing at `/images/...`; missing `mainImage` field returns 400 `INVALID_INPUT`; missing `ingredientsText`/`stepsText` returns 400 `INVALID_INPUT`; a request whose total multipart body exceeds a tiny test-configured `MANUAL_REQUEST_MAX_BYTES` returns 400 `INVALID_INPUT`; Gemini returning a stepless/titleless candidate returns an error with code `AI_NORMALIZATION_FAILED`.
- [x] Verify: `pnpm --filter server run test && pnpm --filter server run lint`.
- [x] Commit: `feat(server): wire POST /api/ingest/manual to the real Option B pipeline`.

## Task 8: Workspace-Wide Verification Pass

- [x] Fresh install + full suite: `pnpm install && pnpm -r run test && pnpm -r run lint`.
- [x] Manual smoke test (requires a real `GEMINI_API_KEY` in `server/.env`, not committed): boot `pnpm --filter server run dev`, then `curl -X POST localhost:8787/api/ingest/manual -F "ingredientsText=2 cups flour\n1 tsp salt" -F "stepsText=Mix flour and salt.\nBake at 350F for 20 minutes." -F "mainImage=@/path/to/local/test.jpg"` — confirm a schema-valid recipe with `metadata.source_type: 'manual'` and a `/images/...` main image comes back; retry with an additional `-F "stepImages=@/path/to/step1.jpg"` and confirm `steps[0].image` is populated; try omitting `mainImage` (expect `INVALID_INPUT`).
- [x] `git status --porcelain server/data` — confirm empty (recipes and images dirs both untracked/ignored, same check Phase 2 ran).
- [x] Commit any fixups only if issues surfaced: `chore: fix workspace-wide lint/test/build issues from Phase 3 verification pass`.

---

## Acceptance Criteria (from master plan, Phase 3)
- [x] Manual input always results in canonical output or clear parse error — Task 4's `INVALID_INPUT` validation + Task 6's `AI_NORMALIZATION_FAILED` on structural pre-check failure + Task 7's integration test.
- [x] Step image ordering follows filename sorting rule — Task 3's deterministic case-insensitive sort, covered by unit tests and Task 7's integration test.
- [x] `main_image` is always present (uploaded/re-hosted or configured default) — Task 6 leaves `main_image` unset on any hosting failure, and Phase 2's unmodified `finalSanitize` applies the default fallback unconditionally, same guarantee Option A already relies on.
- [x] API returns diagnostics and warnings in standard envelope — Task 7's route returns `diagnostics: { extractor: 'gemini-primary', model, durationMs }` and merges all pipeline warnings into `recipe.metadata.warnings`.

## Critical Files
- `server/src/services/ingestion/manual-ingestion-pipeline.ts`
- `server/src/services/manual-ingestion/manual-upload-parser.ts`
- `server/src/services/manual-ingestion/step-image-assigner.ts`
- `server/src/services/images/upload-image-hoster.ts`
- `server/src/services/ai/prompts/manual-ingestion.ts`
- `server/src/routes/ingest.ts`
