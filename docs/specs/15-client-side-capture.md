# 15 Client-Side Capture

## Goal
Let the user ingest a recipe from a site that blocks the server (for example allrecipes.com), by capturing the page HTML in the user's own browser and sending it to the server for the same processing as URL ingestion.

## Why
Some recipe sites block requests from server and data-center IP addresses (403), even with a headless browser. The user's browser already has the page open and is not blocked, so it can hand the rendered HTML to the server.

## Capture endpoint
`POST /api/ingest/capture` (multipart, see spec 03) receives `url`, `html` and optionally `mainImageUrl` plus `mainImage` bytes.

- The pipeline is split: `extractRecipeFromHtml` does the minimum-content check, the fetch log line and the Gemini extraction (with its single retry); `runUrlIngestionPipeline` fetches and then calls it. The capture route calls it directly with `fetchMode: 'capture'`.
- The route helper `finishUrlStyleIngest` (post-processing, image re-hosting, warning merge) is shared with `/api/ingest/url`.
- The captured `url` is validated for syntax only and never fetched. `metadata.source_type` is `url` and `metadata.source_url` is the captured `url`, whatever the model returned.
- The HTML is untrusted: same cleaner and prompt path as fetched HTML. All image downloads keep the existing SSRF guardrails.
- Main image: with `mainImage` bytes, they are hosted (`kind main`) and Gemini's pick is not downloaded; if the bytes are rejected the recipe gets the placeholder, the hosting warning is added to `metadata.warnings` and an `unhosted` entry `{ slot: "main", url: mainImageUrl, warning }` is returned. With only `mainImageUrl`, it replaces Gemini's pick and is downloaded by the server. With neither, Gemini's pick is used as in URL ingestion.
- Images the server cannot download (blocked, 403, too large) are listed in `unhosted`; failed step images are dropped from the recipe.
- Limits: body `MANUAL_REQUEST_MAX_BYTES`, HTML `URL_MAX_RESPONSE_BYTES`, rate limit shared with `/api/ingest/*`.

## Capture flow
Filled in by a later task.

## Relay
Filled in by a later task.

## Bookmarklet and extension
Filled in by a later task.

## Setup page
Filled in by a later task.
