# Spec 03: API Contracts

## Goal
Define backend APIs for ingestion, upload, and export.

## Base
- Prefix: /api
- Content-Type: application/json for JSON routes.
- Multipart: for manual upload route.
- Auth: when `AUTH_MODE=header`, every `/api/*` route except `GET /api/health`
  requires a non-empty `Remote-User` header (set by the reverse proxy); a missing
  or blank header returns 401 `UNAUTHENTICATED`. With `AUTH_MODE=none` (default)
  every request runs as admin user `local`. Non-API paths (`/images/*`,
  `/ingredient-images/*`) are not gated by the app.

## Endpoints

### GET /api/me
Returns the caller resolved by the auth middleware.
Response:
```json
{
  "ok": true,
  "requestId": "...",
  "user": { "username": "alice", "isAdmin": false },
  "placeholderImageUrl": "/images/placeholder-recipe.png"
}
```
Username is trimmed and lowercased; `isAdmin` is true when it appears in
`ADMIN_USERS` (always true for `local` in `AUTH_MODE=none`).
`placeholderImageUrl` is the default recipe image the client compares against
to tell whether the main image is unset.

### POST /api/image/upload
Multipart: `file` (jpeg/png/webp), `namespaceId` (UUID), `slot` (`main` or an
integer `0`-`5`, as string). Response: `{ "ok": true, "requestId": "...", "url": "..." }`.
Key `recipes/{namespaceId}/main-0-{hex8}.jpg` or `recipes/{namespaceId}/step-{i}-{hex8}.jpg`;
every call gets a new key. Invalid fields, missing file, bad type or size -> 400
`INVALID_INPUT`. Body-limited by `MANUAL_REQUEST_MAX_BYTES`; not rate limited.

### POST /api/image/link
Request: `{ "namespaceId": "<uuid>", "slot": "main" | 0-5, "url": "https://..." }`.
Downloads the image (SSRF guarded, jpeg/png/webp only), stores it under a new
key like `/api/image/upload` and returns `{ "ok": true, "requestId": "...", "url": "..." }`.
Errors: blocked or invalid address -> 400 `INVALID_URL`; remote status 401/403 ->
502 `IMAGE_DOWNLOAD_FAILED` ("This site blocks downloads, copy the image and
paste it instead.", `details.status`); any other download failure (status, type,
size, timeout) -> 502 `IMAGE_DOWNLOAD_FAILED`. Not rate limited.

### POST /api/ingest/url
Request:
```json
{
  "url": "https://example.com/recipe"
}
```
Response success:
```json
{
  "ok": true,
  "requestId": "...",
  "recipe": {},
  "diagnostics": {
    "extractor": "gemini-primary|gemini-retry",
    "model": "gemini-...",
    "durationMs": 0
  }
}
```
Response error:
```json
{
  "ok": false,
  "requestId": "...",
  "error": {
    "code": "URL_EXTRACTION_FAILED",
    "message": "Could not extract a usable recipe from this URL.",
    "details": {}
  }
}
```

### POST /api/ingest/manual
Multipart fields:
- ingredientsText: string
- stepsText: string
- mainImage: file
- stepImages: file[] (optional)

Response shape mirrors /api/ingest/url.

### POST /api/ingest/capture
Runs the URL pipeline on a recipe page captured by the user's own browser (spec 15). The page URL is never fetched by the server.
Multipart fields:
- url: string (required, http(s); otherwise 400 `INVALID_URL`). Relative image URLs in the page resolve against it; it becomes `metadata.source_url`.
- html: string (required, non-empty). More than `URL_MAX_RESPONSE_BYTES` UTF-8 bytes -> 400 `INVALID_INPUT`.
- mainImageUrl: string (optional, http(s); otherwise 400 `INVALID_INPUT`). Replaces the model's main image pick.
- mainImage: file (optional, requires `mainImageUrl`, else 400 `INVALID_INPUT`). Bytes the browser already downloaded; hosted instead of downloading `mainImageUrl`.

The request body is limited to `MANUAL_REQUEST_MAX_BYTES`; the route is rate limited like the other `/api/ingest/*` routes. Captured HTML is untrusted, exactly like fetched HTML, and every image URL the server downloads goes through the same SSRF guardrails.

Response mirrors /api/ingest/url (`diagnostics.fetchMode` is `capture`) plus:
- imageNamespaceId: string
- unhosted: `{ slot: "main" | number, url: string, warning: string }[]` - images the server could not host: a main image whose bytes were rejected or that could not be downloaded (the recipe then shows the placeholder), and step images that were dropped. The browser can retry these with its own bytes.

Errors as for /api/ingest/url (for example 422 `URL_EXTRACTION_FAILED` when the page has no recipe content).

### POST /api/recipe/validate
Request: canonical recipe candidate.
Response: valid boolean + normalized value or errors.

### GET /api/recipe/download/:id
Returns normalized JSON as attachment.

### POST /api/recipe/save
Persists a canonical recipe candidate to server-side storage (explicit user action, not automatic).
The caller (`c.get('user')`, spec 11 Authentication Settings) becomes the recipe owner.
Request: canonical recipe object.
Response success:
```json
{
  "ok": true,
  "requestId": "...",
  "id": "..."
}
```
Response error shape mirrors other endpoints.

### PUT /api/recipe/:id
Replaces a saved recipe in place ("Save changes"). Any user (with `AUTH_MODE=none` everyone is the admin user `local`) may update any recipe; the owner and `createdAt` never change, `updatedAt` is bumped.
Request: canonical recipe object (same body as `POST /api/recipe/save`).
Response success:
```json
{
  "ok": true,
  "requestId": "...",
  "id": "..."
}
```
Errors: 404 `RECIPE_NOT_FOUND` for an unknown id (never creates a recipe), 422 `SCHEMA_VALIDATION_FAILED` for an invalid body.

### GET /api/recipes
Returns saved recipe summaries for the library view, newest first.
Query: `scope=mine|all` (default `all`). `mine` returns only recipes owned by the caller. Any other value is 400 `INVALID_INPUT`.
Response:
```json
{
  "ok": true,
  "requestId": "...",
  "recipes": [
    { "id": "...", "title": "...", "tags": [], "main_image": "...", "owner": "alice", "createdAt": "...", "updatedAt": "..." }
  ]
}
```

### GET /api/recipe/:id
Returns the full canonical recipe for a saved id.
Response shape mirrors /api/ingest/url (recipe field populated, no diagnostics), plus record metadata:
```json
{
  "ok": true,
  "requestId": "...",
  "recipe": {},
  "meta": { "id": "...", "owner": "alice", "createdAt": "...", "updatedAt": "..." }
}
```

### DELETE /api/recipe/:id
Removes a saved recipe. Only the owner or an admin may delete; anyone else gets 403 `FORBIDDEN` and the recipe is kept. Unknown id is 404 `RECIPE_NOT_FOUND`. Local images used only by this recipe are deleted with it (see spec 06); image cleanup failures never fail the delete.
Response:
```json
{
  "ok": true,
  "requestId": "..."
}
```

### GET /api/admin/images/unused
Admin only (403 `FORBIDDEN` otherwise). Lists stored images no saved recipe references that are older than 24 hours. The `url` is `${PUBLIC_BASE_URL}/images/<key>`.
Response:
```json
{
  "ok": true,
  "requestId": "...",
  "images": [
    { "key": "recipes/ns1/main-0.jpg", "url": "https://recipes.example.com/images/recipes/ns1/main-0.jpg", "sizeBytes": 48211, "modifiedAt": "..." }
  ]
}
```

### POST /api/admin/images/delete
Admin only (403 `FORBIDDEN` otherwise). Deletes unused images by key.
Request: `{ "keys": ["recipes/ns1/main-0.jpg"] }` (1 to 500 keys).
The server re-derives the unused set (unreferenced and older than 24 hours); keys that are referenced, too recent, or outside `recipes/` are ignored.
Response:
```json
{
  "ok": true,
  "requestId": "...",
  "deleted": 1
}
```

## Error Codes (Minimum Set)
- INVALID_INPUT
- INVALID_URL
- URL_FETCH_TIMEOUT
- URL_EXTRACTION_FAILED
- AI_NORMALIZATION_FAILED
- AI_QUOTA_EXCEEDED (429, Gemini daily quota reached: "Gemini daily quota reached. It resets at midnight Pacific time."; distinct from the app's own RATE_LIMITED; every Gemini 429 maps here, including short per-minute limits)
- SCHEMA_VALIDATION_FAILED
- IMAGE_DOWNLOAD_FAILED
- RECIPE_NOT_FOUND
- UNAUTHENTICATED (401, missing `Remote-User` in header mode)
- FORBIDDEN (403, caller lacks permission for the action)
- INTERNAL_ERROR

## Non-Functional Rules
- Max request size for manual uploads.
- Rate limiting per IP/user (configurable).
- Request ID returned in all responses.

## Acceptance Criteria
- All endpoints implement the exact response envelope.
- Frontend can handle all defined error codes deterministically.