# Spec 01: System Architecture

## Goal
Define the concrete architecture for a secure, maintainable recipe ingestion and rendering system.

## Repository Structure

## Top-level
- /src: frontend application.
- /server: backend API service.
- /shared: shared types, validators, constants.
- /shared/assets/ingredients: shared ingredient image source-of-truth used by frontend and backend.
- /plans: implementation plans.
- /specs: feature specifications.

## Frontend structure
- /src/app: app shell, providers, routing (if needed).
- /src/components/ingest-url: URL option UI and client logic.
- /src/components/ingest-manual: manual option UI and client logic.
- /src/components/review: normalized recipe review/edit UI.
- /src/components/card: two-page card renderer.
- /src/lib/api: typed API client wrappers.
- /src/lib/state: app state modules.
- frontend reads ingredient image manifest generated from /shared/assets/ingredients.

## Backend structure
- /server/src/routes: route handlers.
- /server/src/services: ingestion services and orchestrators.
- /server/src/services/extractors: URL extractors and parsers.
- /server/src/services/normalizers: schema normalization and cleanup.
- /server/src/services/storage: image storage adapters.
- /server/src/services/ai: Gemini client wrappers and prompts.
- /server/src/middleware: validation, error wrapping, logging.

## Shared structure
- /shared/src/contracts: request/response types.
- /shared/src/schema: runtime validators.
- /shared/src/constants: tag vocabulary, pantry defaults, limits.
- /shared/assets/ingredients: image files used for ingredient matching and rendering.

## Runtime Architecture
1. Frontend sends ingestion request to backend.
2. Backend acquires raw content (URL/manual text/files).
3. Backend extracts recipe-like content.
4. Backend invokes Gemini for structured normalization.
5. Backend applies deterministic post-processors.
6. Backend validates canonical schema.
7. Backend returns canonical recipe + warnings + diagnostics.

## Security Requirements
- Gemini API key only on backend.
- Frontend cannot call Gemini directly in production.
- Uploaded files validated by MIME and size.
- URL fetch restricted by protocol and denylist (local/internal targets blocked).

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