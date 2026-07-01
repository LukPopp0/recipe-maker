# Spec 09: Frontend Ingestion Workspace

## Goal
Provide a single-page workflow to run both ingestion options, review results, and export JSON.

## Layout
- Top-level navigation: Create (this workspace) and Library (specs/13-recipe-persistence-and-library.md).
- Header: app title and status indicator.
- Left panel: input tabs (URL, Manual, Load JSON).
- Right panel: normalized recipe preview/editor.
- Bottom utility area: JSON preview + download button.

## URL Tab
Fields:
- Recipe URL input.
Actions:
- "Extract Recipe" submits to /api/ingest/url.
States:
- idle/loading/success/error.

## Load JSON Tab
Fields:
- File picker (accepts .json).
Actions:
- "Load Recipe" reads the file client-side and posts it to /api/recipe/validate.
Behavior:
- On success, feeds the validated recipe into the same review panel as a fresh ingestion.
- Does not auto-save; user still uses the explicit Save action if they want it in the library.
- On validation failure, show field-level errors from the validate response.

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
- "Save Recipe" action (explicit, not automatic): posts to /api/recipe/save and confirms with the returned id.

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