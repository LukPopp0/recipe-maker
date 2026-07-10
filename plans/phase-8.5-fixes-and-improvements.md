# Phase 8.5 - Post-testing fixes and improvements

Findings from end-to-end testing after Phase 8. Check items off as they are fixed.
Order below is the agreed fix order: quick wins first, then behavior fixes.
Item 11 (UI overhaul) is a separate work item needing its own design phase.

## 1. [ ] Add "water" to pantry allowlist (quick win)

- `shared/src/constants/pantry-allowlist.ts:8-16`: add `'water'` to `PANTRY_ALLOWLIST`.
  `isPantryItem` (line 23-37) already does case-insensitive exact match, no change needed.
- Update `specs/12-shared-constants.md` pantry list to match (specs + code together).
- Tests: extend existing pantry-classifier/allowlist unit tests: `isPantryItem('water')`
  and `isPantryItem('Water')` true; "coconut water" stays false (exact match already
  guarantees this - assert it).

## 2. [ ] Print drops backgrounds on card (tags, pantry banner, step headers) (quick win)

- `apps/web/src/components/card/card.css`: in the `@media print` block (lines 323-386)
  add to `.card-page`:
  `print-color-adjust: exact; -webkit-print-color-adjust: exact;`
  Affected elements inherit: `.card-tag-0/1/2` (83-85), `.card-pantry` (150-157),
  `.card-step-number` (183-197), `.card-step-title` (205-216).
- Verify: print preview (Chrome + Safari) in landscape and portrait; backgrounds of
  tags, pantry banner, step number circles, step title bars visible in Save-as-PDF.

## 3. [ ] Card title descenders (g/p/y) clipped on page 1 (quick win)

- `.card-title` at `card.css:47-58`: `line-height: 22pt` < `font-size: 23pt` plus
  `overflow: hidden` + `-webkit-line-clamp: 2` clips descenders on last rendered line.
- Fix: set `line-height: 1.15` (or ~26pt). Keep the 2-line clamp. Check the header
  row still fits page 1 in both orientations (title block shares row with logo,
  `.card-header` card.css:20-24); if 2-line titles now overflow, reduce font-size
  slightly rather than line-height.
- Verify: render card with titles containing descenders ("Spaghetti Bolognese",
  "Crispy Gnocchi") at 1 and 2 lines, both orientations, screen + print preview.

## 4. [ ] Card wordmark "MY RECIPES" smaller than pineapple logo (quick win)

- Card page-1 header only (no such header on Library page). `.card-logo` is 0.55in
  square (card.css:26-30); `.card-wordmark` is 14pt/0.95 line-height (card.css:32-39),
  two lines ~= 0.37in, visibly shorter than logo.
- Fix: size wordmark so its two-line block height equals 0.55in: with line-height 0.95,
  font-size ~= 0.55in / (2 * 0.95) ~= 20-21pt. Set explicit `height: 0.55in` on
  `.card-wordmark` with flex centering if rounding drifts. Markup unchanged
  (`CardPage1.tsx:50-55`).
- Verify: visual check both orientations + print preview; header row must not wrap.

## 5. [ ] Clear review data when new extraction starts

- State: `recipeState` in `apps/web/src/App.tsx:31`; currently replaced only on
  completion via `adoptRecipe` (App.tsx:37-50). Old recipe/diagnostics stay visible
  during the ~1 min extraction.
- Fix:
  - Add `handleExtractStart` in `App.tsx` that does `setRecipeState(null)` (match
    existing null/empty handling of Review/JSON panels, App.tsx:123-131).
  - Thread as new `onExtractStart` prop through `IngestTabs.tsx` (props at line 20)
    to `UrlTab` and `ManualTab`.
  - `UrlTab.submit` (UrlTab.tsx:28-46): call `onExtractStart()` right after validation
    passes, before the API call. Same in `ManualTab.submit` (ManualTab.tsx:57-82,
    after `validateManualUpload` passes at line 58-62).
  - Do NOT clear on validation failure (user keeps current recipe).
- Consider: if `dirty` is true (unsaved edits), still clear - extraction is an explicit
  user action; no confirm dialog (keep simple).
- Tests (RTL): start URL extraction with a recipe loaded -> review panel empties before
  response resolves; failed validation does not clear.

## 6. [ ] Dedupe near-duplicate ingredients ("sliced green onions" + "green onions")

- Today: no dedup on ingredients; `dedupeCaseInsensitive` (sanitize.ts:12) covers only
  tags/pantry_items. Schema has no uniqueness constraint (canonical-recipe.ts:43).
- Fix in two layers:
  1. Prompt: add explicit instruction to `url-ingestion.ts` and `manual-ingestion.ts`
     prompts: merge duplicate ingredients that differ only by preparation words
     (sliced, chopped, diced, minced, ...); combine amounts when mergeable.
  2. Deterministic safety net in post-processing: new `dedupeIngredients` step in
     `server/src/services/post-processing/` (own module + stage in `index.ts:46-78`,
     BEFORE image matching so the matcher gets a clean list and fewer entries).
     Matching rule: normalize name (lowercase, strip known preparation-word prefixes/
     suffixes from a small const list: sliced, chopped, diced, minced, grated, fresh,
     freshly ground, ...); two ingredients merge when normalized names are equal OR one
     name equals the other minus preparation words. Keep the first occurrence's display
     name and amount; append a `metadata.warnings` entry naming the dropped duplicate
     so review shows it. Do NOT attempt quantity arithmetic (amount_text is freeform) -
     keep first amount, mention the dropped one in the warning.
- Tests (Vitest unit): "sliced green onions" + "green onions" -> one entry + warning;
  "red onion" vs "onion" NOT merged (containment alone insufficient - only strip words
  from the preparation list); case-insensitive exact dupes merged.

## 7. [x] Time extraction: implausible values (780 min for "30 min to 1 hour")

- Today: value passes through untouched (post-processing/index.ts:69, sanitize.ts:57);
  only bound is schema 0-1440 (canonical-recipe.ts:42).
- Fix (prompt + flag):
  1. Prompt guidance in `url-ingestion.ts:9` and `manual-ingestion.ts:13`: expand the
     time instruction - "total time in minutes; for ranges like '30 minutes to 1 hour'
     use the upper bound (60); typical recipes are 1 minute to ~4 hours; never sum
     unrelated durations".
  2. Diagnostic warning in post-processing: when `time > 240`, push
     `metadata.warnings` entry ("Extracted time is N minutes (over 4 hours); please
     verify."). Natural spot: `finalSanitize` (sanitize.ts) next to the existing
     truncation-warning pattern (lines 38-52, 77-80). Do not clamp or reject; time
     stays editable in `ReviewPanel.tsx:75` and warning shows at ReviewPanel.tsx:109-113.
- Tests: unit test sanitize/post-processing warning at 241+, none at 240; prompt-text
  assertion if existing prompt tests do that pattern.

## 8. [x] Show source URL on recipe card (URL-ingested recipes)

- `metadata.source_url` exists (canonical-recipe.ts:24), set by URL ingestion, kept by
  sanitize (sanitize.ts:73-75), rendered nowhere.
- Fix: small "Source: {URL}" line on the card. Placement: bottom of page 2 as a footer
  (page 1 is dense; footer keeps card layout intact) - render in `CardPage2.tsx`, new
  `.card-source` style in card.css (small Lato, ~7-8pt, muted color, print-safe).
  Render nothing when `source_url` absent (manual recipes). Show full URL (card is
  meant for print reference), truncated with ellipsis via CSS if too long.
- Tests (RTL card tests): URL recipe shows source line; manual recipe does not.

## 9. [ ] Ingredient image matching: whole batch degrades to INGREDIENT_NOT_FOUND

- Today (`ingredient-image-matcher.ts`): `attemptMatch` (46-62) returns null on
  timeout/bad JSON/schema mismatch/ANY length mismatch (line 56); after primary +
  one retry model both null -> `degradedResult` (35-40) sets every image to
  INGREDIENT_NOT_FOUND.png.
- Fix - make partial results usable and diagnose failures:
  1. Length-mismatch salvage: instead of discarding on `parsed.length !==
     expectedLength`, align model entries to input ingredients by normalized name
     (lowercase, trimmed; fall back to index for unambiguous leftovers). Unmatched
     inputs keep their original name/amount and get INGREDIENT_NOT_FOUND.png +
     per-ingredient warning. Only fully discard on transport/parse/schema errors.
  2. Failure diagnostics: on discarded attempt, `logStage`-style structured log
     (`server/src/lib/log.ts` pattern) with error class and raw response length/snippet
     so recurring cause becomes visible (current `catch {}` at line 58-61 swallows all).
  3. Keep retry-with-retry-model behavior; salvage applies to both attempts.
  - Note: name-based alignment interacts with the matcher's renaming behavior (model
    returns normalized names, result overwrites name at line 105); align on INPUT
    order/name before renaming. Keep result mapping otherwise unchanged.
- Tests (Vitest, mock geminiClient): response one entry short -> matched entries keep
  images, missing one degrades individually with warning; garbage JSON on both
  attempts -> full degrade (existing behavior); log emitted on failed attempt.

## 10. [x] Manual ingestion: accept image URLs alongside file upload

- Backend:
  - `manual-upload-parser.ts`: accept string fields `mainImageUrl` and `stepImageUrls`
    (repeated field) alongside existing File fields. New rules: exactly one of
    mainImage file OR mainImageUrl required; step images may mix files and URLs.
    Validate URLs http(s) (reuse URL-validation approach from URL ingestion pipeline).
    Extend `ParsedManualUpload` with URL variants (discriminated union per image:
    `{ kind: 'file', file: UploadedFile } | { kind: 'url', url: string }`).
  - `manual-ingestion-pipeline.ts:75-109`: for URL entries fetch + host via the
    remote-fetch logic used by `image-rehoster.ts` (`server/src/services/images/`);
    extract its single-image fetch+store helper for reuse rather than duplicating.
    Respect `IMAGE_MAX_BYTES` and `URL_FETCH_TIMEOUT_MS` like URL ingestion. On fetch
    failure: warning + fallback (main image -> default fallback; step image -> none),
    consistent with existing hosting-failure warnings.
  - Keep `source_url: undefined` forcing at `ingest.ts:143` - image URLs do not make
    the recipe URL-sourced.
- Frontend (`ManualTab.tsx`):
  - Main image: URL text input next to the file picker; filling one clears/disables
    the other. Step images: URL input + "Add" button appending to the same list as
    files (list at lines 139-170 shows mixed entries; URL entries labeled as such).
  - `api/client.ts` `ingestManual`: append `mainImageUrl` / repeated `stepImageUrls`
    to the multipart body. `lib/upload-limits.ts` `validateManualUpload`: require
    main image file XOR URL; basic URL format check client-side.
  - Note: step-image-to-step assignment is by sorted filename (`step-image-assigner.ts`);
    URL entries need a deterministic pseudo-filename (e.g. last URL path segment) -
    document in the UI hint like the existing sorted-filename note (ManualTab.tsx:32-34).
- Tests: parser unit tests (file-only, url-only, mixed, neither -> INVALID_INPUT,
  bad URL -> INVALID_INPUT); pipeline integration test with mocked fetch; RTL test
  for XOR validation in ManualTab.

## 11. [x] UI overhaul - SEPARATE WORK ITEM, plan separately before starting

- Floating buttons, fixed header, colors, layout. Scope: `apps/web/src/index.css`
  (tokens), `workspace.css` (~715 lines, shell + all component styles),
  `App.tsx:78-167` (markup). Plain CSS + custom properties, no Tailwind.
- Requires its own session: brainstorming + frontend-design skill, then a dedicated
  plan. Do not start ad hoc.
- Done 2026-07-10 as the "Fresh Market" overhaul (design spec:
  `docs/superpowers/specs/2026-07-10-ui-overhaul-design.md`; spec 09 layout
  section updated): warm pastel palette light+dark, Montserrat/Lato app-wide,
  sticky merged header with segmented nav + status chip, wizard Create flow
  (Input collapses, JSON drawer), floating ActionTray owning Save/Preview,
  shared .btn hierarchy, Library restyle. card.css untouched.

## Verification (per item)

- Unit/integration: `pnpm test` (Vitest; golden-fixture ingestion tests must stay green).
- Typecheck: `pnpm typecheck`.
- Card items (2, 3, 4, 8): run web app, render card both orientations, browser print
  preview / Save-as-PDF.
- Frontend behavior (5, 10): RTL tests + manual run of Create workspace.
