# Spec 09: Frontend Ingestion Workspace

## Goal
Provide a single-page workflow to run both ingestion options, review results, and export JSON.

## Layout (phase 8.5 item 11, "Fresh Market" -
docs/superpowers/specs/2026-07-10-ui-overhaul-design.md)
- Sticky top bar: app title, segmented Create/Library navigation
  (docs/specs/13-recipe-persistence-and-library.md), and status chip
  (coral tint dirty, green tint saved, neutral idle).
- Create is a centered wizard column with numbered stages:
  1. Input: tabs (URL, Manual, Load JSON); collapses to a slim row after a
     recipe loads, reopened via "Edit input".
  2. Review: normalized recipe preview/editor (full-width hero).
  3. JSON: collapsible drawer, closed by default; syntax-highlighted viewer
     with Copy and Download.
- Floating action tray (bottom-center sticky, only when a recipe is loaded
  in Create): Save Recipe, Preview Card, save-state note. The tray owns the
  save state machine and pre-save/preview validation.

## URL Tab
Fields:
- Recipe URL input.
Actions:
- "Extract Recipe" submits to /api/ingest/url.
States:
- idle/loading/success/error.

## Capture Mode (`/capture`)
Opened by the bookmarklet or extension (docs/specs/15). Read once at load: when the path is `/capture`, a capture panel appears above the ingest tabs. It shows the waiting state, the handoff-failed instructions, or `Page received from {hostname}` with the URL and an explicit `Extract recipe` button (nothing is sent before the click). After extraction the recipe is adopted with `unhosted`, and images the server could not host are relayed from the capture source and uploaded into their slots without overwriting a slot the user filled meanwhile. Relayed images do not mark the recipe dirty, except after a save: then the image is a real unsaved change (docs/specs/15 Relay). While a relay run is in progress the Review panel shows `Fetching images from the recipe tab...` (role status), and a relay to a closed or missing opener resolves at once.

## Setup Page (`/setup`)
There is no router library. `App.tsx` reads `location.pathname` at load: `/setup` opens the setup page (docs/specs/15). The header `Setup` link and the `Set up Send to Recipe Maker` link shown next to a `URL_FETCH_BLOCKED` error open it with `history.pushState({}, '', '/setup')`, remembering the previous view; a `popstate` listener returns to that view when the path is no longer `/setup`. Create and Library keep switching by state; choosing one while on Setup replaces the `/setup` entry with `/` (`history.replaceState`), and `popstate` keeps view and path in sync both ways (Back and Forward). Opening Setup while already on it pushes nothing.

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
- main image and per-step images (ImageControl: Paste / Link / Upload / Remove)

Controls:
- "Add main image" prompt at the top (heading + "Recipes are picked by their
  photo. Paste, link or upload one.") with the main image control, shown when
  `main_image` is blank or equals the placeholder URL from `/api/me`; otherwise
  a plain "Main image" section with the control. Save is allowed either way.
- Each step has its own image control; setting or removing an image clears that
  slot's warnings. Read-only mode (Library) shows step image thumbnails only:
  no main image thumbnail and no image controls.
- Show pantry_items as derived values from fixed pantry allowlist routing.
- Add/remove tags.
- Validate recipe before download.
- "Save Recipe" action (explicit, not automatic; lives in the floating action
  tray): posts to /api/recipe/save and confirms with the returned id.

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