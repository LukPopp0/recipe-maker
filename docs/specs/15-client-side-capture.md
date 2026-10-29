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
1. On a recipe page the user starts the capture source (bookmarklet or extension).
2. The source collects the page (URL, HTML, optional main image URL and bytes) and opens `/capture` in the app (bookmarklet: new tab with `window.opener` set; extension: app tab with the bridge content script).
3. The app's `useCaptureHandoff` posts `ready` to `window.opener` (target `'*'`, no data) and `{ ...ready, channel }` to its own window (target `location.origin`), every 500 ms.
4. The source answers with a `payload` message. The app accepts it only from `window.opener` without a channel marker, or from its own window with `channel === 'recipe-maker-extension'`, and only if `isCaptureMessage` validates it. The first payload wins.
5. On payload the app replaces the `/capture` history entry with `/` (only when the path is still `/capture`, so a Setup page opened meanwhile keeps its URL) and the Create workspace shows `Page received from {hostname}`, the URL and an `Extract recipe` button. Nothing is sent to the server yet.
6. `Extract recipe` posts `POST /api/ingest/capture` (multipart: `url`, `html`, `mainImageUrl`, `mainImage` as a file named `main-image` with the blob's own type; the blob type is the bare media type, and the server compares the bare lowercased type too). If the server rejects the bytes (not jpeg/png/webp, too large, unreadable) the recipe gets the placeholder and an `unhosted` entry that is relayed in step 8; the image URL is not downloaded by the server. Progress and errors use `StageStatus` / `ErrorBanner` like the URL tab.
7. The recipe is adopted like any ingestion (`imageNamespaceId`, `unhosted`).
8. Images the server could not host come back as `unhosted`; the app relays them (below) and uploads each via `POST /api/image/upload`.
9. The user reviews and saves explicitly as usual.

Handoff failure: if no payload arrives within 15 s the panel shows `Did not receive the page. Go back to the recipe tab and press Send to Recipe Maker again. If you just logged in, the second try works.` (the first try can be lost to a login redirect that drops `window.opener`). A payload that arrives after the failure is still accepted, which helps when the source is just slow.

Timeouts (defaults): handoff 15000 ms, ready interval 500 ms, relay 30000 ms.

## Relay
For each `unhosted` entry, sequentially, the app sends `relay-request { id, url }` back on the channel the payload came from (opener or extension channel). The source fetches the image with the recipe site's own session and answers `relay-reply { id, url, image }` (`image: null` when it could not). The app accepts replies under the same source/channel rules as payloads, and only from the channel the payload used. A request with no reply within the relay timeout counts as `null`.

A relayed blob is skipped when null, when it has no `image/*` type, or when its upload fails (the recipe keeps the server's unhosted warning). A successful upload fills the slot through a functional state update that applies only if the workspace still has the same `imageNamespaceId` and the slot is still empty, so it never overwrites an image the user set meanwhile. Relay updates do not mark the recipe dirty, except after the recipe was saved: then the image is a real unsaved change and the workspace shows the unsaved state. A filled slot is also removed from the workspace `unhosted` list. A `relay-reply` is accepted only when both its `id` and `url` match the pending request; on page unmount all pending requests resolve with `null`.

## Message protocol
All messages are plain objects checked by `isCaptureMessage` (shared/src/capture/protocol.ts), used by both sides. Every message has `protocol: 'recipe-maker-capture/1'`; messages on the extension path also carry `channel: 'recipe-maker-extension'`.
- `ready` (app to source): no data.
- `payload` (source to app): `{ url, html, mainImageUrl?, mainImage? }`; `mainImage` is a `Blob`.
- `relay-request` (app to source): `{ id, url }`.
- `relay-reply` (source to app): `{ id, url, image }` with `image: Blob | null`.
Images travel as `Blob` objects (structured clone), never base64, on the opener path. `fetchImageBlob` (shared/src/capture/fetch-image.ts) returns only `image/*` bodies within `CAPTURE_IMAGE_MAX_BYTES`, with the type normalized to the bare lowercased media type (no parameters such as `charset`). Timeouts are listed under Capture flow.

## Bookmarklet
`runBookmarklet(appOrigin)` (shared/src/capture/bookmarklet.ts) is the whole bookmarklet. `apps/web/scripts/generate-bookmarklet.mjs` bundles `bookmarklet-entry.ts` into a self-contained IIFE (so a `javascript:` run never replaces the page); the app origin token in it is replaced at runtime by the Setup page. It opens `appOrigin + '/capture'` in a new tab, collects the page and the main image in the background, and answers messages:
- It accepts a message only when `event.origin === appOrigin && event.source === appWindow` and `isCaptureMessage` passes.
- On `ready` it posts the `payload`; on `relay-request` it fetches the image with the recipe site's session and posts `relay-reply` echoing `id` and `url`.
- It posts only with `targetOrigin = appOrigin`, never `'*'`, because the messages carry recipe data.
If the tab cannot be opened it alerts to allow pop-ups. If collection throws it falls back to `{ url, html }`.

## Extension
Filled in by Task 18 (Firefox/Chrome extension and its bridge content script).

## Setup page
`/setup` (header link `Setup`, and the link next to a `URL_FETCH_BLOCKED` error) explains why the tools exist and offers them. The page shows the app origin (`window.location.origin`) so it can be copied into the extension options. Sections:
- Bookmarklet (desktop): a draggable `Send to Recipe Maker` link (its `javascript:` href is set on the DOM node, because React blocks such hrefs). Works in Firefox desktop and Chrome desktop. Does not work in Firefox on Android (Firefox blocks the new tab it opens); those users use the Firefox extension.
- Bookmarklet (Chrome on Android): a `Copy bookmarklet code` button plus steps (create a bookmark, paste the code as the URL, name it, check the saved URL still starts with `javascript:`, then type the name in the address bar and tap the suggestion). A bookmarklet made in Chrome desktop syncs to Android with bookmark sync.
- Firefox extension (desktop and Android): download link for `recipe-maker.xpi` from the latest GitHub release. Desktop: open the file. Android: download it, enable the debug menu (Settings > About Firefox, tap the logo 5 times), then "Install add-on from file". Firefox asks to grant access to all sites. Set the Recipe Maker address in the options. Pasting images is unreliable on Firefox Android: add manual images with Link or Upload.
- Chrome extension (desktop): download link for `recipe-maker-chrome.zip`; extract, open `chrome://extensions`, enable Developer mode, "Load unpacked", set the address in the options. The developer-mode warning is expected.
