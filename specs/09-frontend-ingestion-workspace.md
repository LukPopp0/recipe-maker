# Spec 09: Frontend Ingestion Workspace

## Goal
Provide a single-page workflow to run both ingestion options, review results, and export JSON.

## Layout
- Header: app title and status indicator.
- Left panel: input tabs (URL, Manual).
- Right panel: normalized recipe preview/editor.
- Bottom utility area: JSON preview + download button.

## URL Tab
Fields:
- Recipe URL input.
Actions:
- "Extract Recipe" submits to /api/ingest/url.
States:
- idle/loading/success/error.

## Manual Tab
Fields:
- Ingredients text area.
- Steps text area.
- Main image file picker.
- Step images multi-upload.
Actions:
- "Normalize Recipe" submits to /api/ingest/manual.

## Review Panel
Editable fields:
- title
- tags
- time
- ingredient rows
- step headers/descriptions

Controls:
- Show pantry_items as derived values from fixed pantry allowlist routing.
- Add/remove tags.
- Validate recipe before download.

## JSON Export
- Show syntax-highlighted canonical JSON.
- "Download JSON" action creates file with deterministic naming:
  - recipe-{slug}-{YYYYMMDD}.json

## UX Requirements
- Clear loading states with stage messages.
- Non-blocking warnings shown separately from errors.
- Error banner includes recovery actions.

## Acceptance Criteria
- User can complete either flow and export valid canonical JSON.
- Manual edits are reflected in export payload.
- Warnings visible without blocking export (unless validation errors).