# Spec 14: Step Images for URL Ingestion + Review-Stage Upload

## Goal
URL-ingested recipes get step images on the printable card. Two mechanisms:
always-on extraction from the source page, and a manual review-stage upload
(fed by a copy-to-clipboard generation prompt the user runs in Gemini's web UI
for free).

## Non-Goal: Server-Side AI Image Generation
Rejected. Google's image-generation models (gemini-2.5-flash-image,
gemini-3.1-flash-lite-image) have no API free tier (verified against the
official pricing docs, 2026-07; paid cost ~$0.03-0.04/image). The user
generates images manually in the Gemini web UI instead and uploads them in the
review panel.

## Part 1: Extraction (always on)

### Candidate image mining (html-cleaner)
- Candidate images are collected as `{ url, alt? }` pairs; the `<img>` alt
  text travels into the extraction prompt as the step-mapping signal.
- Sources: og:image / twitter:image meta, `<img src>`, plus lazy-load
  attributes (`data-src`, `data-lazy-src`, first `srcset`/`data-srcset`
  entry).
- Filtered out: `data:` URIs, `.svg` files, images whose width AND height
  attributes are both under 100px (icon/sprite signal).
- Cap: 30 candidates (was 10), deduped by resolved absolute URL.

### Gemini per-step mapping (prompt v4)
- The output schema's step objects carry an optional `"image"` field.
- Rule stays loose (hard limits only): assign a step image only when a
  candidate or JSON-LD image clearly shows that step (not the hero shot);
  omit when unsure; bare URL only.
- Candidates render one per line as `url (alt: "...")` when alt exists.

### JSON-LD HowToStep overlay (highest confidence)
- `extractJsonLdStepImages` pulls per-instruction image URLs from
  `recipeInstructions` HowToStep nodes: image as string | {url} | ImageObject
  | arrays of those; HowToSection.itemListElement flattened in place; plain
  string instructions count as image-less entries; relative URLs resolved
  against the effective page URL. Never throws.
- After an extraction attempt passes the structural pre-check, JSON-LD images
  overlay onto the candidate's steps by index - but ONLY when the JSON-LD
  instruction count equals the extracted step count. JSON-LD wins over the
  model's pick; a null entry never clears a model-assigned image. When counts
  diverge (model merged >6 source steps), the model's own mapping stands (it
  saw the full JSON-LD in the prompt).
- Logged as `stepImagesFromJsonLd` on the `extract` stage.

### Re-hosting
- `rehostRecipeImages` re-hosts remote `steps[].image` URLs alongside
  main_image, keys `recipes/{recipeId}/step-{index}.{ext}` - the same scheme
  manual ingestion uses.
- Same guardrails as main_image (these URLs are attacker-controllable):
  SSRF validation, hard timeout, streaming maxBytes, MIME allowlist
  (jpeg/png/webp).
- Failures are non-fatal: the step's image field is dropped (card falls back
  to the text-only step variant) and a warning is appended
  ("Step N image was not re-hosted: ...").

## Part 2: Review-Stage Upload

### imageNamespaceId contract
- Both ingest responses (`/api/ingest/url`, `/api/ingest/manual`) return
  `imageNamespaceId`: the UUID used as the image storage-key namespace during
  that ingestion. It is NOT a saved recipe id.
- The frontend keeps it in workspace state; recipes that never went through
  ingestion (Load JSON, Library "Open in Create") get a client-minted
  `crypto.randomUUID()` instead - equivalent, since the server only validates
  UUID shape.

### POST /api/image/step
- Multipart: `file` (image), `namespaceId` (UUID string), `stepIndex`
  (integer 0-5, as string).
- Validation: namespaceId must be a bare UUID (blocks path traversal into
  storage keys); stepIndex 0-5; file required. Violations -> 400
  INVALID_INPUT. MIME/size failures from hostUploadedImage -> 400
  INVALID_INPUT with the hosting warning as the message.
- Hosts via the manual-ingestion path (`hostUploadedImage`), key
  `recipes/{namespaceId}/step-{stepIndex}.{ext}` -> re-upload for the same
  step overwrites (replace semantics). Returns `{ url }`.
- Mounted under /api but NOT under /ingest/*, so the ingestion rate limiter
  does not throttle uploads. Body-limited by MANUAL_REQUEST_MAX_BYTES.

### Review panel UI
- StepEditor (editable, namespace present): per-step thumbnail when
  `step.image` is set, plus an upload-only file control (jpeg/png/webp,
  client-validated via lib/upload-limits before the round trip). Success
  writes the hosted URL onto `steps[i].image` through the normal onChange
  flow (marks workspace dirty). No URL input, no remove control.
- Read-only mode (Library view) renders the thumbnail only.
- Save persists `steps[].image` verbatim (no re-host at save time).

### Copy image prompt button
- One button in the review panel's Steps header: "Copy step image generation
  prompt" (secondary-button styling, not ghost).
- Copies a single prompt to the clipboard: intro naming the dish, each
  numbered step_description wrapped in its own `<step-N>` tag inside a
  `<steps>` block, and the generation instruction LAST with an explicit image
  count ("There should be N separate images."). The tag structure +
  trailing instruction are load-bearing: a flat prompt with the instruction
  first makes Gemini produce a single image instead of one per step.
  Frontend-only.
- Workflow: copy -> paste into Gemini web UI -> download images -> upload per
  step -> Save.

## Acceptance Criteria
- A JSON-LD page with HowToStep images yields hosted `steps[].image` values
  and renders step photos on the card.
- Pages without usable step images produce recipes whose cards use the
  text-only step fallback (unchanged).
- A step image can be added or replaced in the review panel before Save; the
  saved recipe references the hosted /images/... URL.
- Step-image failures (extraction, re-host, upload) never fail the request:
  warnings only.
