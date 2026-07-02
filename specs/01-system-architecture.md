# Spec 01: System Architecture

## Goal
Define the concrete architecture for a secure, maintainable recipe ingestion and rendering system.

## Technology Choices
- Backend framework: Hono.
- Test framework: Vitest (unit/integration), React Testing Library (UI/component tests).
- Recipe persistence: flat JSON files on disk, one per recipe, behind a pluggable RecipeRepository interface (see specs/13-recipe-persistence-and-library.md).

## Repository Structure

This is a pnpm workspace with three sibling packages: `/apps/web` (package `web`),
`/server` (package `server`), `/shared` (package `shared`).

## Top-level
- /apps/web: frontend application (package `web`).
- /server: backend API service (package `server`).
- /shared: shared types, validators, constants (package `shared`).
- /shared/assets/ingredients: shared ingredient image source-of-truth used by frontend and backend.
- /plans: implementation plans.
- /specs: feature specifications.
- /server/data/recipes: local JSON file storage for saved recipes (gitignored).

## Frontend structure
- /apps/web/src/app: app shell, providers, routing (if needed).
- /apps/web/src/components/ingest-url: URL option UI and client logic.
- /apps/web/src/components/ingest-manual: manual option UI and client logic.
- /apps/web/src/components/review: normalized recipe review/edit UI.
- /apps/web/src/components/library: recipe library list/view/delete UI.
- /apps/web/src/components/card: two-page card renderer.
- /apps/web/src/lib/api: typed API client wrappers.
- /apps/web/src/lib/state: app state modules.
- frontend reads ingredient image manifest generated from /shared/assets/ingredients.

## Backend structure
- /server/src/routes: route handlers.
- /server/src/services: ingestion services and orchestrators.
- /server/src/services/extractors: URL extractors and parsers.
- /server/src/services/normalizers: schema normalization and cleanup.
- /server/src/services/storage: image storage adapters.
- /server/src/services/recipes: RecipeRepository interface and local JSON file implementation.
- /server/src/services/ai: Gemini client wrappers and prompts.
- /server/src/middleware: validation, error wrapping, logging.

## Shared structure
- /shared/src/contracts: request/response types.
- /shared/src/schema: runtime validators.
- /shared/src/constants: tag vocabulary, pantry defaults, limits (see specs/12-shared-constants.md for exact values).
- /shared/assets/ingredients: image files used for ingredient matching and rendering.

## Runtime Architecture
1. Frontend sends ingestion request to backend.
2. Backend acquires raw content (URL/manual text/files).
3. Backend extracts recipe-like content.
4. Backend invokes Gemini for structured normalization.
5. Backend applies deterministic post-processors.
6. Backend validates canonical schema.
7. Backend returns canonical recipe + warnings + diagnostics.
8. If user chooses Save, frontend calls POST /api/recipe/save; backend writes via RecipeRepository and returns an id.
9. Frontend can later list/view/download/delete saved recipes via RecipeRepository-backed endpoints.

## Security Requirements
- Gemini API key only on backend.
- Frontend cannot call Gemini directly in production.
- Uploaded files validated by MIME and size.
- URL fetch restricted by protocol and denylist (local/internal targets blocked).
- server/data/recipes is excluded from version control. If deployed beyond local use, add a basic access gate (single shared secret) in front of the API; full multi-user auth is out of scope for now.

## Performance Requirements
- P50 ingest response under 12s for typical recipes.
- P95 ingest response under 20s with remote image fetch.
- Hard timeout for each external call.

## Error Model
- Every error response includes:
  - code: stable machine-readable code.
  - message: user-friendly explanation.
  - details: optional actionable metadata.
  - requestId: for troubleshooting.

## Acceptance Criteria
- Clear separation of frontend/backend/shared concerns.
- No secrets in frontend bundle.
- Deterministic transformation pipeline for both options.