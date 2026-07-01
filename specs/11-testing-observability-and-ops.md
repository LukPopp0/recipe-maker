# Spec 11: Testing, Observability, and Operations

## Goal
Ensure reliability, debuggability, and safe operation for ingestion and rendering features.

## Test Strategy
Tooling: Vitest for unit/integration tests; React Testing Library for UI/component tests.

### Unit Tests
- Schema validation success/failure.
- Step compaction correctness.
- Pantry classifier behavior.
- Tag normalizer behavior.
- Ingredient image matching determinism.

### Integration Tests
- URL ingestion happy path.
- URL ingestion failure path.
- Manual ingestion with/without images.
- Image re-hosting behavior.
- End-to-end canonical output shape.

### UI Tests
- Tab switching and form submission.
- Error and warning display.
- JSON export includes edits.
- Card rendering with missing images.

## Observability
- Structured logs for each ingestion stage.
- requestId propagation frontend <-> backend.
- Metrics:
  - ingestion duration
  - extraction success rate
  - schema failure rate
  - image match fallback rate

## Operational Guardrails
- External request timeouts.
- Retry policy for transient failures.
- Rate limits for ingest endpoints.
- Input size limits for text and files.

## Gemini Usage Controls
- Configurable model selection.
- Token budget controls per request.
- Fallback model chain for failures/timeouts.

## Release Gates
- All critical tests passing.
- No blocker-level unresolved known issues.
- Performance thresholds met on representative fixture set.

## Acceptance Criteria
- Reproducible test suite in CI.
- Actionable logs for all production errors.
- Stable ingestion behavior under expected load.