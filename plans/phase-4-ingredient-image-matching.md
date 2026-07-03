# Phase 4: Ingredient Image Matching and Post-Processing Hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gemini-driven ingredient image matching against the shared ingredient asset catalog, wired into the Phase 2 post-processing module so both ingestion pipelines assign `ingredient.image` values, with warning metadata for unmatched/low-confidence items.

**Architecture:** A new `server/src/services/ingredient-matching/` module provides an `IngredientImageMatcher` (second Gemini call: normalized ingredients + catalog filenames in, matched ingredients out). `applyPostProcessing` becomes async and accepts an optional injected matcher, running it on the classified (non-pantry) ingredients immediately before `finalSanitize`. The catalog is the committed ingredient manifest, newly exported from the `shared` package.

**Tech Stack:** Everything already in place — `@google/genai` via the existing `GeminiClient`, Zod, Vitest. No new dependencies.

## Scope Decisions (confirmed with user)

1. **`INGREDIENT_NOT_FOUND.png` asset exists now.** The user added it to `shared/assets/ingredients` (215 files total). The committed manifest (`shared/src/generated/ingredient-manifest.json`, currently 214 entries) must be regenerated to include it (Task 1), and the server gets a startup check asserting it is present in the manifest (Task 2).
2. **`ingredient.image` stores the bare catalog filename** (e.g. `broccoli.png`), not a path or URL. The frontend resolves filenames via the manifest; static serving of `shared/assets/ingredients` is deferred to Phase 5. This deviates from spec 08's "convert matched filename to final served image path/URL" post-processing step — spec 08 is updated accordingly (exported canonical JSON stays portable).
3. **Confidence metadata = flat strings in `metadata.warnings`.** One warning per `INGREDIENT_NOT_FOUND.png` assignment and per degraded/coerced match. No schema change; spec 02 untouched.
4. **Matcher failure degrades, never fails the request.** One retry with `GEMINI_RETRY_MODEL`; if that also fails, every ingredient gets `INGREDIENT_NOT_FOUND.png` plus a single warning. Ingestion already succeeded at that point — matching problems must not throw.
5. **Matcher runs after pantry classification, tag normalization, and step compaction, immediately before `finalSanitize`** (master plan Phase 4: "final step before sanitation's re-validation"). Pantry items are never matched — they have no `image` field. `applyPostProcessing` becomes async; when no matcher is injected, behavior is byte-for-byte unchanged (existing unit tests keep passing with only an `await` added).
6. **The matcher call re-normalizes ingredient display fields per spec 08** (title-case names, preparation-detail stripping, short units like `tbsp`/`tsp`/`g`). Output must preserve ingredient count and order; a count mismatch counts as a failed attempt (triggers the retry/degrade path). `amount_value` is not part of the matcher's output shape and is carried over from the input by index.
7. **Backend rejects non-catalog filenames.** Any filename Gemini invents is coerced to `INGREDIENT_NOT_FOUND.png` plus a warning naming the ingredient — coercion alone does not fail the attempt.
8. **`PROMPT_VERSION` bumps to `v2`** — a new prompt joins the set and pipeline output visibly changes (ingredient images now assigned), so responses must be distinguishable from Phase 2/3 output.

## Context

Phases 0-3 shipped both ingestion endpoints. `applyPostProcessing(candidate, { defaultMainImageUrl })` (`server/src/services/post-processing/index.ts:43`) is sync and pure: pantry -> tags -> compaction -> assemble -> `finalSanitize`. `ingredient.image` (`z.string().optional()` in `shared/src/schema/canonical-recipe.ts`) is currently never set by either pipeline. `GeminiClient.generateCanonicalRecipe({ model, prompt, timeoutMs })` is a generic prompt-in/parsed-JSON-out call, reusable for the matcher without changes despite its name. The manifest generator (`shared/scripts/generate-ingredient-manifest.mjs`) exists but has no runtime consumer.

## Global Constraints

- No scope beyond specs/02, 08 and the master plan's Phase 4 section.
- Deterministic generation settings (temperature 0, topP 1, topK 1) from `GeminiConfig.generationConfig` apply to the matcher call, same as ingestion calls.
- Every Gemini call must be mockable in tests — no test hits the real Gemini API.
- All Phase 2/3 guarantees regress-checked: schema validity, max 6 steps, `main_image` fallback.
- ASCII only, no emojis, targeted minimal edits.

---

## Task 1: Export the Ingredient Manifest from `shared` (and Regenerate It)

**Files:** modify `shared/scripts/generate-ingredient-manifest.mjs`, modify `shared/src/index.ts`, regenerate `shared/src/generated/ingredient-manifest.json`, create `shared/src/generated/ingredient-manifest.ts` (generated), extend `shared/scripts/lib/build-ingredient-manifest.test.mjs` only if generator logic changes need it.

**Interfaces:**
- Produces: `INGREDIENT_IMAGE_MANIFEST: readonly string[]` exported from `shared` (sorted catalog filenames including `INGREDIENT_NOT_FOUND.png`).

- [ ] Extend `shared/scripts/generate-ingredient-manifest.mjs` to write a TypeScript sibling next to the JSON it already writes: `shared/src/generated/ingredient-manifest.ts` containing a generated-file header comment and `export const INGREDIENT_IMAGE_MANIFEST: readonly string[] = [ ...same sorted entries... ];`. Keep the JSON output unchanged (the frontend may consume it later). The TS form avoids JSON-import config (`resolveJsonModule` / import attributes) in every consuming package.
- [ ] Run `pnpm --filter shared run generate:manifest`. Confirm both generated files now contain 215 entries including `INGREDIENT_NOT_FOUND.png`.
- [ ] Add to `shared/src/index.ts`, following the existing constants export pattern: `export { INGREDIENT_IMAGE_MANIFEST } from './generated/ingredient-manifest.js';`
- [ ] Verify: `pnpm --filter shared run test && pnpm --filter shared run typecheck`.
- [ ] Commit: `feat(shared): export ingredient image manifest (incl. INGREDIENT_NOT_FOUND.png) for runtime use`.

## Task 2: Ingredient Catalog Module + Startup Check

**Files:** create `server/src/services/ingredient-matching/catalog.ts` (+ `.test.ts`), modify `server/src/index.ts`.

**Interfaces:**
- Consumes: `INGREDIENT_IMAGE_MANIFEST` from `shared` (Task 1).
- Produces:
  - `export const INGREDIENT_NOT_FOUND_IMAGE = 'INGREDIENT_NOT_FOUND.png'`
  - `export interface IngredientCatalog { filenames: readonly string[]; has(filename: string): boolean }`
  - `export function loadIngredientCatalog(): IngredientCatalog` (backed by a `Set` for `has`)
  - `export function checkIngredientCatalogReady(): boolean` — false + structured console.error when `INGREDIENT_NOT_FOUND_IMAGE` is missing from the manifest.

- [ ] Write `.test.ts` first: `loadIngredientCatalog()` returns 215 filenames; `has('broccoli.png')` true; `has('made-up.png')` false; catalog contains `INGREDIENT_NOT_FOUND_IMAGE`; `checkIngredientCatalogReady()` returns true against the real manifest.
- [ ] Implement `catalog.ts` as above (pure module, reads only the imported manifest constant — no fs access).
- [ ] In `server/src/index.ts`, next to the existing `checkStorageReady` fail-fast block, call `checkIngredientCatalogReady()` and `process.exit(1)` on false (same structured-JSON error-log style as `checkStorageReady`).
- [ ] Verify: `pnpm --filter server run test -- catalog`.
- [ ] Commit: `feat(server): add ingredient catalog module with INGREDIENT_NOT_FOUND startup check`.

## Task 3: Ingredient-Matching Prompt

**Files:** create `server/src/services/ai/prompts/ingredient-matching.ts` (+ `.test.ts`).

**Interfaces:**
- Produces:
  - `export interface BuildIngredientMatchingPromptParams { ingredients: RawIngredient[]; catalogFilenames: readonly string[] }`
  - `export function buildIngredientMatchingPrompt(params): string`

- [ ] Write `ingredient-matching.ts` following the structure of `url-ingestion.ts` (compact output-shape block, rules list, fenced input, "Return only the JSON object" closer). Prompt content:
  - Output shape: `[{ "name": string (title case), "amount_text": string, "unit"?: string (short form), "image": string (a filename from the catalog below, or "INGREDIENT_NOT_FOUND.png") }]` — a JSON array, same length and order as the input list.
  - Normalization rules from spec 08: title-case names; strip preparation-only details ("red onions, finely chopped" -> "Red Onions"); keep product-form identity ("can of crushed tomatoes" -> "Crushed Tomatoes"); short units (pounds -> lbs, tablespoons -> tbsp, teaspoons -> tsp, ounces -> oz, grams -> g, milliliters -> ml); preserve input order exactly.
  - Matching rules from spec 08: choose the closest semantic filename from the catalog; never invent filenames; prefer specific over generic when confident; when uncertain or no close match, use `INGREDIENT_NOT_FOUND.png`.
  - Inputs: the ingredient list as JSON (`name`, `amount_text`, `unit` only) and the catalog filenames newline-joined inside a `<catalog>` block.
- [ ] Write `.test.ts`: prompt contains every catalog filename passed in; contains each input ingredient name; contains the `INGREDIENT_NOT_FOUND.png` fallback instruction, the "never invent filenames" rule, the same-length/same-order requirement, and at least one unit-shortening rule (`tablespoons -> tbsp`).
- [ ] Verify: `pnpm --filter server run test -- prompts/ingredient-matching`.
- [ ] Commit: `feat(server): add Gemini prompt for ingredient image matching (specs/08)`.

## Task 4: Ingredient Image Matcher Service

**Files:** create `server/src/services/ingredient-matching/ingredient-image-matcher.ts` (+ `.test.ts`).

**Interfaces:**
- Consumes: `buildIngredientMatchingPrompt` (Task 3), `IngredientCatalog` + `INGREDIENT_NOT_FOUND_IMAGE` (Task 2), `GeminiClient.generateCanonicalRecipe` (existing, generic JSON call), `GeminiConfig` (existing), `RawIngredient` (existing, from post-processing).
- Produces:
  - `export interface IngredientImageMatchResult { ingredients: RawIngredient[]; warnings: string[] }`
  - `export interface IngredientImageMatcher { matchIngredientImages(ingredients: RawIngredient[]): Promise<IngredientImageMatchResult> }`
  - `export function createIngredientImageMatcher(params: { geminiClient: Pick<GeminiClient, 'generateCanonicalRecipe'>; geminiConfig: GeminiConfig; catalog: IngredientCatalog }): IngredientImageMatcher`

- [ ] Write `.test.ts` first, with a fake `generateCanonicalRecipe` handler (`vi.fn()`, same injection pattern as `url-ingestion-pipeline.test.ts`):
  - Empty input array: resolves `{ ingredients: [], warnings: [] }` without calling Gemini.
  - Happy path: 3 ingredients in, fake returns 3 valid entries with catalog filenames; result carries those filenames, names/units updated from the response, `amount_value` preserved by index from the input, no warnings.
  - Non-catalog filename in response: coerced to `INGREDIENT_NOT_FOUND.png`, one warning naming the ingredient, other entries untouched.
  - Honest `INGREDIENT_NOT_FOUND.png` from the model: kept, one warning per spec 08 ("No image match found for ingredient 'X'.").
  - Count mismatch (2 entries for 3 inputs): first call rejected, second call (retry model) used; assert the second call's `model` param is `geminiConfig.retryModel`.
  - Both attempts fail (throw / invalid shape): resolves (never rejects) with all input ingredients set to `INGREDIENT_NOT_FOUND.png` and a single degradation warning; input names/amounts unchanged.
  - Empty name in a response entry fails Zod validation and counts as a failed attempt.
- [ ] Implement `ingredient-image-matcher.ts`:
  - Local Zod schema: `z.array(z.object({ name: z.string().trim().min(1), amount_text: z.string().trim().min(1), unit: z.string().optional(), image: z.string().min(1) }))` plus a `.length === input.length` check.
  - Attempt runner: build prompt (Task 3), `geminiClient.generateCanonicalRecipe({ model, prompt, timeoutMs: geminiConfig.timeoutMs })`, Zod-parse; any `AppError` or parse/length failure marks the attempt failed (caught, not rethrown).
  - Attempt 1 with `geminiConfig.primaryModel`; on failure attempt 2 with `geminiConfig.retryModel`; on second failure return the degraded result (decision 4).
  - On success, per entry: if `!catalog.has(image)` and `image !== INGREDIENT_NOT_FOUND_IMAGE`, coerce + warn (decision 7); if the final image is `INGREDIENT_NOT_FOUND_IMAGE`, add the no-match warning (decision 3); merge `{ ...input[i], name, amount_text, unit, image }` so `amount_value` survives.
- [ ] Verify: `pnpm --filter server run test -- ingredient-image-matcher`.
- [ ] Commit: `feat(server): add Gemini-driven ingredient image matcher with retry and degrade path`.

## Task 5: Wire the Matcher into `applyPostProcessing`

**Files:** modify `server/src/services/post-processing/index.ts` (+ update `index.test.ts`).

**Interfaces:**
- Consumes: `IngredientImageMatcher` (Task 4).
- Produces: `applyPostProcessing(candidate, options): Promise<CanonicalRecipe>` — now async; `ApplyPostProcessingOptions` gains `ingredientImageMatcher?: IngredientImageMatcher`.

- [ ] Update `index.test.ts` first: existing cases just gain `await` (no behavior change without a matcher — assert output deep-equals the pre-Phase-4 expectations). New cases with a fake matcher: matched filenames land on `ingredients[i].image`; matcher warnings appear in `metadata.warnings` alongside `finalSanitize` truncation warnings; matcher receives only the post-pantry-classification ingredients (pantry staples in the input never reach the matcher).
- [ ] Make `applyPostProcessing` async. After `classifyPantryItems`/`normalizeTags`/`compactSteps`, when `options.ingredientImageMatcher` is set and the classified ingredients are non-empty: `const matchResult = await options.ingredientImageMatcher.matchIngredientImages(ingredients);` — use `matchResult.ingredients` in the assembled recipe and append `matchResult.warnings` to `candidate.metadata.warnings` before `finalSanitize` (which already merges metadata warnings). No matcher or empty ingredients: identical flow to today.
- [ ] Update the module doc comment (pipeline ordering now lists "5. ingredient image matching (optional, before sanitize)").
- [ ] Verify: `pnpm --filter server run test -- post-processing`.
- [ ] Commit: `feat(server): run ingredient image matching inside post-processing before final sanitize`.

## Task 6: Route Wiring, PROMPT_VERSION Bump, Integration Tests

**Files:** modify `server/src/routes/ingest.ts`, `server/src/services/ai/prompt-version.ts` (+ update `server/src/routes/ingest.test.ts`).

**Interfaces:**
- Consumes: `createIngredientImageMatcher` + `loadIngredientCatalog` (Tasks 2/4), async `applyPostProcessing` (Task 5).

- [ ] In `createIngestApp` (`server/src/routes/ingest.ts`), construct once at app creation: `const ingredientImageMatcher = createIngredientImageMatcher({ geminiClient, geminiConfig, catalog: loadIngredientCatalog() });` then pass `ingredientImageMatcher` in both routes' `applyPostProcessing` options and `await` the (now async) call. No other route logic changes.
- [ ] Bump `server/src/services/ai/prompt-version.ts` to `export const PROMPT_VERSION = 'v2';` (decision 8).
- [ ] Update `ingest.test.ts`: the fake `GeminiClient` now answers two calls per request — first the ingestion candidate, second the matcher array (drive via `vi.fn().mockResolvedValueOnce(candidate).mockResolvedValueOnce(matchArray)`). Assert for both `/ingest/url` and `/ingest/manual`: `ingredients[i].image` equals the catalog filename from the fake match response; a fake matcher response with an invented filename yields `INGREDIENT_NOT_FOUND.png` plus a warning in `metadata.warnings`; a matcher call that rejects on both attempts still returns 200 with all images `INGREDIENT_NOT_FOUND.png` and the degradation warning; all prior assertions (schema validity, source_type, hosted image URLs, error cases) still pass unchanged.
- [ ] Verify: `pnpm --filter server run test && pnpm --filter server run lint`.
- [ ] Commit: `feat(server): assign ingredient images in both ingestion routes (PROMPT_VERSION v2)`.

## Task 7: Workspace-Wide Verification Pass

- [ ] Fresh install + full suite: `pnpm install && pnpm -r run test && pnpm -r run lint && pnpm -r run typecheck`.
- [ ] Manual smoke test (real `GEMINI_API_KEY` in `server/.env`): boot `pnpm --filter server run dev`; POST a known recipe URL to `/api/ingest/url` and a manual payload to `/api/ingest/manual` (same curl shapes as the Phase 3 plan's Task 8). Confirm: every `ingredients[i].image` is a real catalog filename or `INGREDIENT_NOT_FOUND.png`; unmatched items produce warnings; response `diagnostics` unchanged in shape; run the same URL twice and confirm identical `ingredients[].image` assignments (determinism).
- [ ] Regression: max 6 steps, `main_image` present, `metadata.warnings` always an array.
- [ ] Commit fixups only if issues surfaced: `chore: fix workspace-wide issues from Phase 4 verification pass`.

---

## Acceptance Criteria (from master plan, Phase 4)

- [ ] Ingredient image assignment deterministic for same input — temperature-0 generation config + fixed prompt (Task 3) + smoke-test double-run (Task 7).
- [ ] Unknown ingredients reliably map to `INGREDIENT_NOT_FOUND.png` without failing the request — coercion + degrade path (Task 4), integration coverage (Task 6).
- [ ] All outputs still satisfy schema and step cap — `finalSanitize` re-validation still runs last (Task 5), regression checks (Tasks 6/7).

## Critical Files

- `shared/scripts/generate-ingredient-manifest.mjs`, `shared/src/index.ts`
- `server/src/services/ingredient-matching/catalog.ts`
- `server/src/services/ingredient-matching/ingredient-image-matcher.ts`
- `server/src/services/ai/prompts/ingredient-matching.ts`
- `server/src/services/post-processing/index.ts`
- `server/src/routes/ingest.ts`
