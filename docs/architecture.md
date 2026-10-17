# Architecture

A reader-level tour of how Recipe Maker fits together. For exact contracts and
rules, follow the links into [docs/specs](specs/). For running it, see
[local-development.md](local-development.md), [self-hosting.md](self-hosting.md)
and [configuration.md](configuration.md).

## What it does

Recipe Maker turns a recipe from a web page (URL) or from pasted text and
images (manual) into one canonical JSON recipe: at most 6 steps, ingredients
split into main and pantry items, each ingredient matched to a catalog image.
The user reviews and edits the result, explicitly saves it, browses saved
recipes in a library, and prints a two-page recipe card.

## Packages

This is a pnpm workspace ([spec 01](specs/01-system-architecture.md)).

- `apps/web` - React + TypeScript + Vite frontend: the Create workspace
  (URL / Manual / Load JSON tabs, editable review panel), the Library, and the
  card renderer.
- `server` - Hono backend (`server/src`): routes, middleware, and `services/`
  for ingestion, AI, post-processing, storage and recipes.
- `shared` - types, the Zod recipe schema, error codes and constants (pantry
  allowlist, tag vocabulary) used by both sides, plus the ingredient image
  catalog in `shared/assets/ingredients`. See
  [spec 02](specs/02-canonical-recipe-schema.md) and
  [spec 12](specs/12-shared-constants.md).

```
 browser (apps/web)
     |  /api/*  (JSON)           /images/*   /ingredient-images/*   /  (web app)
     v
 +--------------------- Hono server (one process) ----------------------+
 | request id -> logger -> auth (/api/*) -> rate limit (/api/ingest/*)   |
 |                                                                       |
 |  ingest routes ----> fetch / Gemini / post-processing / image rehost  |
 |  recipe routes ----> RecipeRepository   (JSON files | SQLite)         |
 |  image + ingest ---> StorageAdapter     (resize -> local disk)        |
 +-----------------------------------------------------------------------+
        |                        |
   Gemini API            target web pages (static fetch, or Playwright)
```

## Single-process shape

One Node process serves everything. Hono exposes the API under `/api`, the
stored images under `/images/*`, the ingredient catalog images under
`/ingredient-images/*`, and, when `WEB_DIST_DIR` is set, the built web app
(single page app, with fallback to `index.html`). In the Docker image
`WEB_DIST_DIR` is set, so one container is the whole product; in local
development Vite serves the web app separately and proxies to the server. There
is no separate worker, queue or database server.

## URL ingestion

`POST /api/ingest/url` ([spec 04](specs/04-option-a-url-ingestion.md),
`server/src/services/ingestion/url-ingestion-pipeline.ts`):

1. **Fetch.** The URL is validated and fetched with SSRF guardrails (blocked
   address ranges, redirect limit, timeout, size cap; `services/url-ingestion/url-security.ts`).
   Blocked and failed fetches surface as explicit `URL_FETCH_BLOCKED` /
   `URL_FETCH_FAILED` errors.
2. **Extract input.** The HTML is cleaned to visible text, candidate images and,
   if present, the schema.org `Recipe` JSON-LD, which is the best input.
3. **Browser fallback.** If there is no JSON-LD and the page text is thin (a
   client-side rendered shell), or the JSON-LD has no ingredients, the page is
   re-fetched with a headless Chromium via Playwright (when
   `BROWSER_FALLBACK_ENABLED`). The richer result wins.
4. **Gemini structured output.** The cleaned content goes to Gemini with a JSON
   response schema ([`services/ai`](../server/src/services/ai)). A light
   structural check (title, ingredients, steps) decides whether the answer is
   usable; if not, one retry runs with a stricter prompt, less content and
   `GEMINI_RETRY_MODEL`. Step images declared in JSON-LD are overlaid on the
   result ([spec 14](specs/14-url-step-images.md)).
5. **Post-processing.** Deterministic code makes the candidate schema-valid:
   sanitizing, tag normalization, deduplicating ingredients, the pantry split,
   and compaction to at most 6 steps
   ([spec 07](specs/07-step-compaction-max-6.md),
   `services/post-processing`).
6. **Ingredient image matching.** A second Gemini call picks a catalog image
   for each ingredient ([spec 08](specs/08-ingredient-image-matching.md)). If it
   fails or the quota is reached, every ingredient falls back to the
   "not found" image and a warning is added.
7. **Image re-hosting.** The main image and step images are downloaded and
   stored through the `StorageAdapter` so the recipe no longer depends on the
   source site ([spec 06](specs/06-image-rehosting-storage.md)). Failures become
   warnings; the default placeholder image is used when there is no main image.

The response carries the recipe, diagnostics, and an `imageNamespaceId` that the
review panel uses to upload step images into the same storage namespace
(`POST /api/image/step`). Nothing is saved yet. Each stage writes one
structured log line ([spec 11](specs/11-testing-observability-and-ops.md)).
Gemini quota errors surface as `AI_QUOTA_EXCEEDED` (HTTP 429).

## Manual ingestion

`POST /api/ingest/manual` ([spec 05](specs/05-option-b-manual-ingestion.md))
takes multipart text plus a main image and step images (uploaded files or image
URLs). The images are hosted first (failures become warnings), then Gemini
normalizes the text to the canonical schema, post-processing and ingredient
matching run as above, and the hosted step images are assigned to steps in
filename order. There is no fetch or browser stage. Load JSON, the third
Create tab, is frontend-only and skips the server pipeline.

## Storage

- **Recipes** live behind the `RecipeRepository` interface
  (`server/src/services/recipes`; [spec 13](specs/13-recipe-persistence-and-library.md)).
  `RECIPE_STORE=json` (default) writes one JSON file per recipe under
  `RECIPE_DATA_DIR`; `RECIPE_STORE=sqlite` uses a single SQLite database at
  `RECIPE_DB_PATH` and is what the Docker image uses. Both share a contract test
  suite. Saving is always an explicit user action.
- **Images** live behind the `StorageAdapter` interface
  (`services/storage`). The only implementation writes to local disk under
  `IMAGE_DATA_DIR`. `ResizingStorageAdapter` decorates it, so every image from
  every source (re-hosted, uploaded, manual) is normalized with sharp
  (at most 1600 px, JPEG) and stored with a `.jpg` key.
- **Cleanup.** Deleting a recipe removes its images unless another recipe still
  uses them. Admins can list and delete images no recipe references (the
  "Unused images" cleanup, `/api/admin/images/*`).

## Auth and permissions

There are no accounts in the app. Login is delegated to a reverse proxy
(this project's setup uses tinyauth behind nginx), see
[self-hosting.md](self-hosting.md). `server/src/middleware/auth.ts` runs on
every `/api/*` request:

- `AUTH_MODE=none` (default for local development): every request is the user
  `local`, who is an admin.
- `AUTH_MODE=header`: the username comes from the `Remote-User` header set by
  the proxy; a missing header is `UNAUTHENTICATED` (401). The header is trusted
  as-is, so this mode is only safe when the app port is reachable only through
  the proxy. The Docker image defaults to this mode.

`GET /api/me` tells the frontend who the user is and whether they are an admin
(`ADMIN_USERS`). Rules ([spec 13](specs/13-recipe-persistence-and-library.md)):

- Every recipe has an owner (the user who first saved it).
- Everyone can view and edit every recipe (Save changes keeps the original
  owner; Save as new creates a copy owned by the user who saves it).
- Only the owner or an admin can delete a recipe (otherwise `FORBIDDEN`, 403).
- Only admins can use the image cleanup.

`/api/health` is the one `/api` path that answers without a user, for Docker
health checks. Ingestion routes (`/api/ingest/*`) additionally pass an
in-memory fixed-window rate limiter (`RATE_LIMIT_MAX` per
`RATE_LIMIT_WINDOW_MS`, answering `RATE_LIMITED`, 429), keyed on the first
`X-Forwarded-For` entry, which is why the proxy must overwrite that header
rather than append to it. The limiter is per process and resets on restart.

## Card rendering and printing

The recipe card is rendered entirely in the browser
(`apps/web/src/components/card`, [spec 10](specs/10-recipe-card-renderer.md)):
a two-page, letter-size layout, landscape by default with a portrait toggle,
using self-hosted Inter and D-DIN fonts. The preview scales to fit the
available width; `@media print` rules in `card.css` print the pages at real
size. Users print or "Save as PDF" through the browser print dialog
(`window.print`). The card is reachable from Library ("View as Card") and from
the Create workspace ("Preview Card").

## Deliberate non-goals

- **No in-app accounts.** No sign-up, passwords or sessions in the app; the
  proxy owns login and the app only reads the username it is given.
- **No server-side PDF.** The browser print dialog is sufficient, so there is no
  headless-render PDF endpoint.
- **No AI image generation.** Step images come from the source page or are
  uploaded; the review panel offers a "Copy image prompt" button for use in an
  external tool instead.

## Keeping Playwright and the Docker image in step

The Docker image takes Chromium from the Playwright base image, and the
`playwright` npm package drives it, so the two versions must match. The base
image tag comes from `ARG PLAYWRIGHT_VERSION` at the top of the `Dockerfile`.
When you upgrade the `playwright` package, change that ARG to the same version;
`server/src/docker-playwright-version.test.ts` fails (and so does CI) if they
differ. Otherwise the browser fallback breaks at runtime with "Executable
doesn't exist". See also "Building the image yourself" in
[self-hosting.md](self-hosting.md).
