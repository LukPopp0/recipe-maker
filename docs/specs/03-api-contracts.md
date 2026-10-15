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
  "user": { "username": "alice", "isAdmin": false }
}
```
Username is trimmed and lowercased; `isAdmin` is true when it appears in
`ADMIN_USERS` (always true for `local` in `AUTH_MODE=none`).

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

### POST /api/recipe/validate
Request: canonical recipe candidate.
Response: valid boolean + normalized value or errors.

### GET /api/recipe/download/:id
Returns normalized JSON as attachment.

### POST /api/recipe/save
Persists a canonical recipe candidate to server-side storage (explicit user action, not automatic).
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

### GET /api/recipes
Returns saved recipe summaries for the library view.
Response:
```json
{
  "ok": true,
  "requestId": "...",
  "recipes": [
    { "id": "...", "title": "...", "tags": [], "main_image": "...", "createdAt": "..." }
  ]
}
```

### GET /api/recipe/:id
Returns the full canonical recipe for a saved id.
Response shape mirrors /api/ingest/url (recipe field populated, no diagnostics).

### DELETE /api/recipe/:id
Removes a saved recipe.
Response:
```json
{
  "ok": true,
  "requestId": "..."
}
```

## Error Codes (Minimum Set)
- INVALID_INPUT
- INVALID_URL
- URL_FETCH_TIMEOUT
- URL_EXTRACTION_FAILED
- AI_NORMALIZATION_FAILED
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