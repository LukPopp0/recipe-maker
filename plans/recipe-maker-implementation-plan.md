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

### Milestone 2 (Secondary): Recipe Card Rendering
Implement deterministic card rendering driven only by canonical JSON:
- Page 1: Title, tags, time, main image, ingredients (with images).
- Page 2: Up to 6 cooking steps (header, description, optional step image).

Milestone 2 includes:
- Responsive card layout.
- Print/PDF export baseline.
- Visual refinement pass after design lock.

## 3. Constraints and Decisions
- Must support both Option A and Option B in-app.
- English input only for milestone 1.
- If extraction quality is too low for Option A, return explicit, actionable error.
- Step image generation is out of scope in milestone 1. Missing step images remain empty.
- URL images should be downloaded and re-hosted in milestone 1.
- Pantry logic uses a fixed pantry allowlist provided by the product owner. Pantry-list items must be routed to pantry_items and removed from ingredients.
- Tags use fixed vocabulary plus optional custom tags.
- Amount handling preserves flexible text values.
- main_image is required in canonical output. If no image is found, use a configured default image URL.

## 4. Target Architecture

### 4.1 Frontend
- React + TypeScript (existing Vite app).
- One workspace page with two ingestion tabs: URL Import, Manual Import.
- Review/edit panel for normalized recipe.
- JSON viewer and download action.
- Card renderer module (milestone 2).

### 4.2 Backend
- Node.js API service in same repo (recommended for secure key handling).
- Responsibilities:
   - URL fetch and preprocessing.
   - Gemini-first extraction and normalization.
   - Normalization + validation.
   - Step compaction.
   - Image download and re-hosting.
   - Return canonical payloads.

### 4.3 Shared Contracts
- Shared types and runtime schema definitions used by frontend and backend.
- Strict response contract for success/error states.

### 4.4 Storage
- Adapter interface with local storage implementation first.
- Future-ready cloud adapter (S3/GCS/R2) contract.

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
5. Bootstrap backend service skeleton.
   - Add server entrypoint, route registration, middleware order, and health endpoint.
   - Add startup checks for env variables and storage adapter readiness.

### Deliverables
- Compile-safe shared contracts.
- Runtime validators for all payload edges.
- Backend skeleton with typed route boundaries and centralized error handling.
- Gemini configuration module with prompt versioning.

### Acceptance Criteria
- Invalid payloads fail with typed, user-readable errors.
- All route handlers return predictable success/error shape.
- Backend boots with validated config and returns health check response.

## Phase 2: Option A Pipeline (URL Import)

### Spec References
- specs/03-api-contracts.md
- specs/04-option-a-url-ingestion.md
- specs/06-image-rehosting-storage.md
- specs/07-step-compaction-max-6.md
- specs/08-ingredient-image-matching.md

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
6. Apply post-processing pipeline.
   - Enforce fixed pantry-list routing.
   - Run step compaction if >6 steps.
   - Clamp step_description to 600 characters if still over limit.
   - Ensure required main_image with configured default fallback.
7. Process images.
   - Download main image and step images when available.
   - Re-host through storage adapter and replace URLs in payload.
   - Record warnings for failed non-critical image downloads.
8. Return API response with diagnostics.
   - Include requestId, model name, promptVersion, extractor mode (gemini-primary or gemini-retry), and durationMs.

### Deliverables
- /api/ingest/url endpoint.
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

### Implementation Tasks
1. Build manual input form:
   - Ingredients text area.
   - Steps text area.
   - Main image upload.
   - Optional step image upload list.
2. Upload preprocessing:
   - Normalize filenames.
   - Sort step image files alphabetically.
3. Backend normalization:
   - Validate required fields (ingredientsText, stepsText, mainImage).
   - Re-host uploaded main image and optional step images.
   - Pass raw text blocks and image metadata to Gemini-first normalization.
   - Avoid deep heuristic parsing except minimal cleanup.
   - Require canonical schema output from Gemini.
4. Apply same post-normalization logic as Option A:
   - Pantry split.
   - Tag policy.
   - Step compaction.
   - Step description 600-character cap.
   - Required main_image default fallback.
   - Image hosting.
5. Return normalized recipe and diagnostics:
   - Include warnings when step images are missing or unmatched by index.
   - Include promptVersion, model, and duration.

### Deliverables
- /api/ingest/manual endpoint.
- Stable parse behavior for common formatting variants.
- Deterministic step-image assignment by sorted filename.

### Acceptance Criteria
- Manual input always results in canonical output or clear parse error.
- Step image ordering follows filename sorting rule.
- main_image is always present (uploaded/re-hosted or configured default).
- API returns diagnostics and warnings in standard envelope.

## Phase 4: Canonical Post-Processing

### Spec References
- specs/02-canonical-recipe-schema.md
- specs/07-step-compaction-max-6.md
- specs/08-ingredient-image-matching.md

### Implementation Tasks
1. Pantry classifier with fixed pantry allowlist (no user override in normalization pipeline).
   - Match normalized ingredient names against allowlist.
   - Move matches to pantry_items and remove from ingredients.
   - Deduplicate pantry_items while preserving display consistency.
2. Tag normalizer:
   - Map model tags to controlled vocabulary.
   - Keep extras as custom tags.
3. Step compaction algorithm (hard cap at 6).
4. Ingredient image matcher:
   - Gemini-driven matching against provided ingredient asset catalog.
   - Enforce catalog-only filenames or INGREDIENT_NOT_FOUND.png fallback.
5. Confidence metadata:
   - Track warnings for low-confidence matching/extraction.
6. Final canonical sanitation:
   - Trim and normalize whitespace.
   - Deduplicate tags.
   - Guarantee main_image presence.
   - Validate final object before API response.

### Deliverables
- Reusable post-processing module used by both pipelines.
- Deterministic pantry routing and final sanitation stage.

### Acceptance Criteria
- All outputs satisfy schema and step cap.
- Ingredient image assignment deterministic for same input.
- Pantry-list items never appear in ingredients after final post-processing.

## Phase 5: Milestone 1 Frontend Completion

### Spec References
- specs/03-api-contracts.md
- specs/09-frontend-ingestion-workspace.md
- specs/02-canonical-recipe-schema.md

### Implementation Tasks
1. Build two-tab ingestion UI.
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

### Deliverables
- End-to-end milestone 1 UX.
- Diagnostics-aware review experience and JSON export.

### Acceptance Criteria
- User can complete both flows without touching code.
- Final JSON download reflects all user edits.
- Error and warning states are understandable and actionable.

## Phase 6: Milestone 2 Card Rendering

### Implementation Tasks
1. Build card renderer module that accepts canonical JSON only.
2. Page 1 layout:
   - Title, tags, time, main image, ingredients list with ingredient images.
3. Page 2 layout:
   - Exactly rendered compacted steps (max 6), optional step images.
4. Print mode and PDF baseline:
   - Browser print CSS first.
5. Empty-state fallbacks for missing images/text.

### Deliverables
- Two-page card preview and printable output.

### Acceptance Criteria
- All valid canonical recipes render without layout breakage.
- Print/PDF output is legible and complete.

## Phase 7: Quality, Testing, and Hardening

### Implementation Tasks
1. Unit tests:
   - Schema validators.
   - Step compaction.
   - Pantry classifier.
   - Ingredient matcher.
2. Integration tests:
   - URL flow golden fixtures.
   - Manual flow golden fixtures.
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

## 6. Implementation Order (Strict)
1. Phase 0 cleanup.
2. Phase 1 contracts.
3. Option A backend.
4. Option B backend + frontend forms.
5. Shared post-processing.
6. Frontend review + JSON export.
7. Milestone 2 card renderer.
8. Tests + hardening.

## 7. Definition of Done
- Both input options work in one UI.
- Canonical JSON is generated, editable, and downloadable.
- Max 6 steps always enforced.
- Ingredient images matched from local library through Gemini catalog matching with INGREDIENT_NOT_FOUND.png fallback.
- Two-page card renders from canonical JSON.
- Tests cover core transformation logic and ingestion endpoints.

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

## 9. Deliverables Checklist
- Master plan document (this file).
- Feature specs in ./specs for each implementation area.
- Implementation starts only after this plan is approved.