# Recipe Maker Implementation Plan

## 1. Objective
Build a React-based application that ingests recipe data from two input modes, normalizes the data into one canonical JSON format, enforces a hard maximum of 6 cooking steps, and renders a standardized two-page recipe card.

## 2. Scope and Milestones

### Milestone 1 (Primary): Ingestion + Normalization + JSON Output
Implement the full data ingestion and normalization pipeline for both options:
- Option A: URL-only recipe import.
- Option B: Manual text + image uploads.

Milestone 1 includes:
- Secure Gemini integration behind backend APIs.
- Canonical schema validation and normalization.
- Step compaction logic (max 6 steps).
- Pantry-vs-ingredient split.
- Ingredient image matching from local asset library.
- JSON preview + download in UI.
- Load JSON tab to re-import a previously exported recipe.
- Explicit Save action persisting recipes server-side.
- Recipe library: list, view (JSON/review), download, delete.

### Milestone 2 (Secondary): Recipe Card Rendering
Implement deterministic card rendering driven only by canonical JSON:
- Page 1: Title, tags, time, main image, ingredients (with images).
- Page 2: Up to 6 cooking steps (header, description, optional step image).

Milestone 2 includes:
- Responsive card layout.
- Print/PDF export baseline.
- Visual refinement pass after design lock.
- "View as Card" upgrade to the recipe library's view action.

## 3. Constraints and Decisions
- Must support both Option A and Option B in-app.
- English input only for milestone 1.
- If extraction quality is too low for Option A, return explicit, actionable error.
- Step image generation is out of scope in milestone 1. Missing step images remain empty.
- URL images should be downloaded and re-hosted in milestone 1.
- Pantry logic uses a fixed pantry allowlist provided by the product owner. Pantry-list items must be routed to pantry_items and removed from ingredients.
- Tags use fixed vocabulary plus optional custom tags for Option A (URL ingestion). For Option B (manual ingestion), Gemini does not assign tags at all - tags are fully user-set in the UI (wired in Phase 5).
- Amount handling preserves flexible text values.
- main_image is required in canonical output. If no image is found, use a configured default image URL.
- Recipe persistence uses flat JSON files on disk (one per recipe), not a database, behind a pluggable RecipeRepository interface. Saving is an explicit user action, not automatic.
- No authentication in milestone 1/2 (single-user, local-first). If deployed later, add a basic access gate (single shared secret); full multi-user auth is out of scope.

## 4. Target Architecture

### 4.1 Frontend
- React + TypeScript (existing Vite app).
- Top-level nav: Create workspace (two ingestion tabs + Load JSON) and Library.
- Review/edit panel for normalized recipe.
- JSON viewer and download action.
- Card renderer module (milestone 2).

### 4.2 Backend
- Node.js API service in same repo using Hono (recommended for secure key handling).
- Test framework: Vitest (unit/integration), React Testing Library (frontend components).
- Responsibilities:
   - URL fetch and preprocessing.
   - Gemini-first extraction and normalization.
   - Normalization + validation.
   - Step compaction.
   - Image download and re-hosting.
   - Recipe save/list/get/delete via RecipeRepository.
   - Return canonical payloads.

### 4.3 Shared Contracts
- Shared types and runtime schema definitions used by frontend and backend.
- Strict response contract for success/error states.

### 4.4 Storage
- Image storage: adapter interface with local storage implementation first, future-ready cloud adapter (S3/GCS/R2) contract.
- Recipe storage: separate RecipeRepository interface, LocalJsonFileRecipeRepository default (flat JSON files, one per recipe). See specs/13-recipe-persistence-and-library.md.

## 5. Execution Plan

### 5.0 Spec Reference Map
- Spec 01 (architecture): specs/01-system-architecture.md
- Spec 02 (canonical schema): specs/02-canonical-recipe-schema.md
- Spec 03 (API contracts): specs/03-api-contracts.md
- Spec 04 (Option A URL ingestion): specs/04-option-a-url-ingestion.md
- Spec 05 (Option B manual ingestion): specs/05-option-b-manual-ingestion.md
- Spec 06 (image storage/re-hosting): specs/06-image-rehosting-storage.md
- Spec 07 (step compaction): specs/07-step-compaction-max-6.md
- Spec 08 (ingredient image matching): specs/08-ingredient-image-matching.md
- Spec 09 (frontend ingestion workspace): specs/09-frontend-ingestion-workspace.md
- Spec 10 (card renderer): specs/10-recipe-card-renderer.md
- Spec 11 (testing and ops): specs/11-testing-observability-and-ops.md
- Spec 12 (shared constants): specs/12-shared-constants.md
- Spec 13 (recipe persistence and library): specs/13-recipe-persistence-and-library.md

## Phase 0: Repository Cleanup and Baseline Setup

### Spec References
- specs/01-system-architecture.md
- specs/09-frontend-ingestion-workspace.md
- specs/11-testing-observability-and-ops.md

### Implementation Tasks
1. Remove Vite starter UI and boot a minimal app shell.
   - Replace src/App.tsx template content with the ingestion workspace shell placeholder.
   - Remove template imports (React/Vite logos, counters, docs links).
   - Remove or replace src/App.css if it contains only template styles.
2. Replace src/index.css with project base styles.
   - Add CSS reset/normalization (margin, box-sizing, media defaults).
   - Define app design tokens in :root (colors, spacing scale, typography scale, radius, shadows, z-index layers).
   - Add baseline layout rules for root container and major regions.
   - Add accessibility defaults (focus-visible, reduced-motion handling).
   - Add print baseline rules that do not yet implement full card print output.
3. Move ingredient assets to a shared location used by frontend and backend.
   - Create shared/assets/ingredients as the canonical asset directory.
   - Move current files from src/assets/ingredients to shared/assets/ingredients.
   - Update frontend import strategy to use an asset manifest generated from shared/assets/ingredients.
   - Update backend catalog scanning to read from shared/assets/ingredients.
   - Keep a temporary compatibility layer only if needed during migration, then remove it.
4. Replace README.md with project-specific documentation.
   - Document architecture (frontend, backend, shared modules, storage).
   - Document local setup commands and scripts.
   - Document milestone status and links to plan/spec files.
   - Document known constraints (English-only milestone 1, max 6 steps, fixed pantry list).
5. Add environment template files and config boundaries.
   - Add .env.example for frontend-safe variables only.
   - Add server/.env.example for secrets and backend runtime config.
   - Include keys for Gemini model selection, default image URL, upload limits, and storage adapter selection.
   - Add validation-on-startup for required environment variables in backend.

### Deliverables
- Clean app shell with no template artifacts.
- Shared ingredient asset source-of-truth path.
- Documented local setup and env contract.

### Acceptance Criteria
- App boots into recipe workspace shell.
- No React/Vite template elements remain.
- Frontend and backend both resolve ingredient assets from shared/assets/ingredients.
- README includes setup and architecture documentation for this project.

## Phase 1: Core Contracts and Foundations

### Spec References
- specs/01-system-architecture.md
- specs/02-canonical-recipe-schema.md
- specs/03-api-contracts.md
- specs/11-testing-observability-and-ops.md

### Implementation Tasks
1. Create shared canonical schema and validators.
   - Add shared/src/contracts for request/response TypeScript types.
   - Add shared/src/schema runtime validators for CanonicalRecipe and endpoint payloads.
   - Enforce required main_image fallback rule and step_description <= 600.
2. Define backend route contracts and handler boundaries.
   - Add typed request/response wrappers per endpoint.
   - Add endpoint-level input validation middleware.
   - Ensure consistent response envelope with requestId for all outcomes.
3. Add standardized error model.
   - Define stable error codes and mapping policy.
   - Add centralized error serializer that produces user-safe messages.
   - Add per-error diagnostics payload contract for frontend display.
4. Add Gemini model and prompt configuration module.
   - Define primary model, retry model, timeout, token budget, and retry count.
   - Version prompts explicitly (promptVersion) for reproducibility.
   - Add deterministic generation settings where supported.
5. Bootstrap backend service skeleton using Hono.
   - Add server entrypoint, route registration, middleware order, and health endpoint.
   - Add startup checks for env variables and storage adapter readiness.
   - Set up Vitest for the backend package.
6. Bootstrap RecipeRepository.
   - Add RecipeRepository interface in shared/server contracts.
   - Implement LocalJsonFileRecipeRepository writing to server/data/recipes.
   - Ensure server/data/recipes is created on startup and gitignored.

### Deliverables
- Compile-safe shared contracts.
- Runtime validators for all payload edges.
- Backend skeleton with typed route boundaries and centralized error handling.
- Gemini configuration module with prompt versioning.
- RecipeRepository interface and local JSON file implementation.

### Acceptance Criteria
- Invalid payloads fail with typed, user-readable errors.
- All route handlers return predictable success/error shape.
- Backend boots with validated config and returns health check response.
- RecipeRepository save/get/list/delete round-trip correctly (covered by Vitest).

## Phase 2: Option A Pipeline (URL Import)

### Spec References
- specs/03-api-contracts.md
- specs/04-option-a-url-ingestion.md
- specs/06-image-rehosting-storage.md
- specs/07-step-compaction-max-6.md
- specs/12-shared-constants.md

### Scope Note
Pantry classifier, tag normalizer, step compaction, and final sanitation are built here as the real, reusable post-processing module, since Option A needs them to produce valid output. Phase 3 (Option B) reuses this module rather than rebuilding it. Phase 4 is scoped down to ingredient image matching (specs/08) plus confidence-metadata/warning hardening on top of this module.

### Implementation Tasks
1. Implement URL intake and security guardrails.
   - Validate URL scheme, syntax, and allowed host policy.
   - Block localhost and private network targets.
   - Enforce max redirects, fetch timeout, and response size limits.
2. Fetch and normalize source content for AI extraction.
   - Retrieve HTML and capture effective URL after redirects.
   - Strip script/style noise and produce cleaned text/DOM fragments.
   - Extract candidate image URLs from metadata as auxiliary context.
3. Run Gemini primary extraction/normalization call.
   - Send URL plus cleaned content context.
   - Require strict canonical schema output.
   - Include prompt instructions for pantry routing, 6-step cap behavior, and 600-char step descriptions.
4. Run Gemini retry path when primary response fails quality checks.
   - Retry with reduced content chunks focused on likely recipe sections.
   - Keep same schema contract and prompt version metadata.
5. Apply deterministic quality gate.
   - Validate required fields and schema conformance.
   - Reject responses with unresolved structural issues after retry.
6. Build and apply the reusable canonical post-processing module.
   - Pantry classifier: match normalized ingredient names against the fixed allowlist (specs/12), move matches to pantry_items, dedupe while preserving display form.
   - Tag normalizer: map model tags to the controlled vocabulary (specs/12), keep extras as custom tags.
   - Step compaction algorithm (hard cap at 6, specs/07).
   - Final sanitation: clamp step_description to 600 characters, trim/collapse whitespace, ensure required main_image with configured default fallback, re-validate against the canonical schema.
   - Module is built to be called identically from Option B (Phase 3).
7. Process images.
   - Download main image and step images when available.
   - Re-host through storage adapter and replace URLs in payload.
   - Record warnings for failed non-critical image downloads.
8. Return API response with diagnostics.
   - Include requestId, model name, promptVersion, extractor mode (gemini-primary or gemini-retry), and durationMs.

### Deliverables
- /api/ingest/url endpoint.
- Reusable canonical post-processing module (pantry, tags, step compaction, sanitation) used by both pipelines.
- Deterministic success/failure behavior.
- URL ingestion diagnostics and warning metadata.

### Acceptance Criteria
- Supported URL returns valid canonical recipe.
- Invalid/non-recipe URL returns explicit reason and guidance.
- Same URL and promptVersion produce stable schema-valid output.
- main_image is always present (original hosted URL or configured default).

## Phase 3: Option B Pipeline (Manual Input)

### Spec References
- specs/03-api-contracts.md
- specs/05-option-b-manual-ingestion.md
- specs/06-image-rehosting-storage.md
- specs/07-step-compaction-max-6.md
- specs/08-ingredient-image-matching.md

### Scope Note
Backend only, mirroring Phase 2's pattern (Phase 2 shipped `/api/ingest/url` with no frontend URL tab). The manual-entry form UI (ingredients/steps text areas, main image and step image uploads) is built in Phase 5 ("Milestone 1 Frontend Completion") alongside the URL and Load JSON tabs, not here. This phase ships `POST /api/ingest/manual` end-to-end: multipart parsing, uploaded-image hosting, Gemini normalization, deterministic step-image assignment by filename order, and reuse of Phase 2's post-processing module unchanged. Ingredient image matching (specs/08) stays deferred to Phase 4 for both pipelines. See `plans/phase-3-option-b-manual-ingestion.md`.

### Implementation Tasks
1. Upload preprocessing:
   - Normalize filenames.
   - Sort step image files alphabetically.
2. Backend normalization:
   - Validate required fields (ingredientsText, stepsText, mainImage).
   - Re-host uploaded main image and optional step images.
   - Pass raw text blocks and image metadata to Gemini-first normalization.
   - Avoid deep heuristic parsing except minimal cleanup.
   - Require canonical schema output from Gemini.
3. Apply the same post-processing module built in Phase 2 (no reimplementation):
   - Pantry split.
   - Tag policy (Option B only: tags pass through empty/user-set - Gemini does not
     assign tags for manual ingestion; the tag vocabulary applies to Option A only).
   - Step compaction.
   - Step description 600-character cap.
   - Required main_image default fallback.
   - Image hosting.
4. Return normalized recipe and diagnostics:
   - Include warnings when step images are missing or unmatched by index.
   - Include promptVersion, model, and duration.
5. Tags for manual ingestion: Gemini does not select tags. `tags` comes back empty from
   this pipeline; the user sets tags entirely themselves in the review UI (Phase 5).

### Deliverables
- /api/ingest/manual endpoint.
- Stable parse behavior for common formatting variants.
- Deterministic step-image assignment by sorted filename.

### Acceptance Criteria
- Manual input always results in canonical output or clear parse error.
- Step image ordering follows filename sorting rule.
- main_image is always present (uploaded/re-hosted or configured default).
- API returns diagnostics and warnings in standard envelope.

## Phase 4: Ingredient Image Matching and Post-Processing Hardening

### Spec References
- specs/02-canonical-recipe-schema.md
- specs/08-ingredient-image-matching.md

### Scope Note
Pantry classifier, tag normalizer, step compaction, and final sanitation were built in Phase 2 as the reusable post-processing module (used unchanged by Option B in Phase 3). This phase only adds ingredient image matching on top of that module, plus confidence/warning metadata hardening.

Decisions confirmed during Phase 4 planning (see `plans/phase-4-ingredient-image-matching.md`):
- `INGREDIENT_NOT_FOUND.png` was added to `shared/assets/ingredients` by the product owner (215 assets); the committed manifest is regenerated and the server checks its presence at startup.
- `ingredient.image` stores the bare catalog filename (e.g. `broccoli.png`), not a path/URL; the frontend resolves filenames via the manifest. Static serving of ingredient assets is deferred to Phase 5.
- Confidence metadata is flat strings in `metadata.warnings` (one per unmatched/coerced ingredient); no schema change.
- Matcher failure never fails the request: one retry with the retry model, then degrade all ingredients to `INGREDIENT_NOT_FOUND.png` plus a warning.
- The matcher runs after pantry classification (pantry items are never matched) and after step compaction, immediately before final sanitation; `applyPostProcessing` becomes async with an optional injected matcher.
- `PROMPT_VERSION` bumps to `v2`.

### Implementation Tasks
1. Ingredient image matcher:
   - Gemini-driven matching against provided ingredient asset catalog.
   - Enforce catalog-only filenames or INGREDIENT_NOT_FOUND.png fallback.
2. Confidence metadata:
   - Track warnings for low-confidence matching/extraction.
3. Wire the matcher into the existing post-processing module (Phase 2) so both pipelines call it as the final step before sanitation's re-validation.

### Deliverables
- Ingredient image matcher integrated into the shared post-processing module.
- Confidence/warning metadata for unmatched or low-confidence ingredients.

### Acceptance Criteria
- Ingredient image assignment deterministic for same input.
- Unknown ingredients reliably map to INGREDIENT_NOT_FOUND.png without failing the request.
- All outputs still satisfy schema and step cap (regression check on Phase 2's guarantees).

## Phase 5: Milestone 1 Frontend Completion

### Spec References
- specs/03-api-contracts.md
- specs/09-frontend-ingestion-workspace.md
- specs/02-canonical-recipe-schema.md
- specs/13-recipe-persistence-and-library.md

### Implementation Tasks
1. Build ingestion UI with URL, Manual, and Load JSON tabs.
   - Load JSON reads a file client-side and validates it via POST /api/recipe/validate before feeding it into the review panel.
2. Add request lifecycle UI states.
   - idle/loading/success/error per tab.
   - stage-level status text (fetching, normalizing, post-processing, complete).
3. Add review panel with editable fields:
   - Title, tags, ingredients, and steps.
   - pantry_items shown as derived from fixed pantry allowlist routing.
4. Add warnings and diagnostics panel.
   - Show schema warnings, unmatched ingredient image warnings, and fallback-image warnings.
   - Keep warnings non-blocking unless validation fails.
5. Add normalized JSON viewer.
   - Render canonical JSON and allow copy-to-clipboard.
6. Add downloadable JSON export.
   - Deterministic filename format.
   - Export exactly what is currently shown in review state.
7. Add client-side pre-submit validation and guardrails.
   - Validate required manual fields before API call.
   - Enforce file type/size limits client-side for quicker feedback.
8. Add explicit Save Recipe action.
   - Posts current review-state recipe to POST /api/recipe/save.
   - Confirms with returned id; does not auto-save on ingestion or on Load JSON.

### Deliverables
- End-to-end milestone 1 UX.
- Diagnostics-aware review experience and JSON export.
- Explicit save flow wired to the backend RecipeRepository.

### Acceptance Criteria
- User can complete all three flows (URL, Manual, Load JSON) without touching code.
- Final JSON download reflects all user edits.
- Error and warning states are understandable and actionable.
- Save Recipe persists the currently reviewed recipe and only that recipe.

## Phase 6: Recipe Persistence and Library

### Spec References
- specs/03-api-contracts.md
- specs/13-recipe-persistence-and-library.md

### Implementation Tasks
1. Backend: implement POST /api/recipe/save, GET /api/recipes, GET /api/recipe/:id, DELETE /api/recipe/:id using RecipeRepository (built in Phase 1).
2. Add RECIPE_NOT_FOUND error handling for get/delete on missing ids.
3. Frontend: build Library section (top-level nav item) with list/view/download/delete.
   - List view renders title, main image thumbnail, tags per saved recipe.
   - View opens the existing review/JSON panel in read-only mode.
   - Delete confirms before calling DELETE.

### Deliverables
- Working save-to-library flow from the review panel.
- Library list/view/download/delete UI.

### Acceptance Criteria
- Saved recipes persist across server restarts.
- Deleting a recipe removes it from disk and from the library list.
- Library view/download reuse existing review/export components rather than duplicating them.

## Phase 7: Milestone 2 Card Rendering

### Implementation Tasks
1. Build card renderer module that accepts canonical JSON only.
2. Page 1 layout:
   - Title, tags, time, main image, ingredients list with ingredient images.
3. Page 2 layout:
   - Exactly rendered compacted steps (max 6), optional step images.
4. Print mode and PDF baseline:
   - Browser print CSS first.
5. Empty-state fallbacks for missing images/text.
6. Add "View as Card" link from the Library view action into the card renderer.

### Deliverables
- Two-page card preview and printable output.
- Library entries can be opened as a rendered card.

### Acceptance Criteria
- All valid canonical recipes render without layout breakage.
- Print/PDF output is legible and complete.

## Phase 8: Quality, Testing, and Hardening

### Implementation Tasks
1. Unit tests:
   - Schema validators.
   - Step compaction.
   - Pantry classifier.
   - Ingredient matcher.
   - RecipeRepository (save/get/list/delete).
2. Integration tests:
   - URL flow golden fixtures.
   - Manual flow golden fixtures.
   - Load JSON flow.
   - Save/list/view/delete round-trip through the API.
3. Operational guards:
   - Request timeouts.
   - Retry strategy.
   - Rate-limit handling.
4. Logging:
   - Request IDs.
   - Pipeline stage durations.
   - Error codes.

### Deliverables
- Reliable, test-backed ingestion service.

### Acceptance Criteria
- Critical modules covered by tests.
- Known failures handled with actionable messages.

## Phase 9: PDF Generation Upgrade (Future, Post-Milestone 2)

### Spec References
- specs/10-recipe-card-renderer.md

### Implementation Tasks
1. Add server-side headless rendering (Puppeteer or Playwright) that hits the card renderer route and prints to PDF.
2. Expose a download-as-PDF action alongside the existing browser print flow.
3. Keep browser print CSS as a fallback.

### Deliverables
- Consistent PDF output independent of the user's browser.

### Acceptance Criteria
- PDF output matches the on-screen card layout for a representative fixture set.
- Not required for Milestone 2 completion; tracked as a follow-up.

## 6. Implementation Order (Strict)
1. Phase 0 cleanup.
2. Phase 1 contracts (includes RecipeRepository).
3. Option A backend (includes reusable post-processing module: pantry, tags, step compaction, sanitation).
4. Option B backend + frontend forms.
5. Ingredient image matching and post-processing hardening.
6. Frontend review + JSON export + Load JSON + Save action.
7. Recipe persistence and library.
8. Milestone 2 card renderer.
9. Tests + hardening.
10. PDF generation upgrade (future, post-milestone 2).

## 7. Definition of Done
- Both input options, plus Load JSON, work in one UI.
- Canonical JSON is generated, editable, and downloadable.
- Max 6 steps always enforced.
- Ingredient images matched from local library through Gemini catalog matching with INGREDIENT_NOT_FOUND.png fallback.
- Recipes can be explicitly saved, then listed, viewed, downloaded, and deleted from the library.
- Two-page card renders from canonical JSON, including from a saved library entry.
- Tests cover core transformation logic, ingestion endpoints, and recipe persistence.

## 8. Risks and Mitigations

### Risk: URL extraction inconsistency across sites
Mitigation:
- Use Gemini-first extraction with retry prompts over cleaned content.
- Keep strict quality gates and schema validation.
- Return explicit extraction-quality failures.

### Risk: Gemini output drift
Mitigation:
- Strict schema-constrained outputs.
- Runtime validation and correction layer.
- Model fallback strategy.

### Risk: Image rights and hosting
Mitigation:
- Track source URLs in metadata.
- Keep pluggable storage and policy layer.
- Add legal review checkpoint before wide release.

### Risk: Ambiguous ingredient names
Mitigation:
- Gemini ingredient normalization and catalog-based matching.
- INGREDIENT_NOT_FOUND.png fallback + warning message.

### Risk: Flat-file recipe storage under concurrent writes or at scale
Mitigation:
- Personal, single-user, local-first usage keeps concurrency risk low.
- RecipeRepository is an interface; swapping in a DB-backed implementation later requires no caller changes.
- Revisit if list() directory scanning becomes slow (unlikely at personal-use volume).

### Risk: Deploying beyond local use without access control
Mitigation:
- Deferred until deployment is actually planned.
- Add a basic access gate (single shared secret) at the Hono middleware level; full multi-user auth is explicitly out of scope.

## 9. Deliverables Checklist
- Master plan document (this file).
- Feature specs in ./specs for each implementation area, including specs/12-shared-constants.md and specs/13-recipe-persistence-and-library.md.
- Implementation starts only after this plan is approved.