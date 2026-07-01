# Spec 03: API Contracts

## Goal
Define backend APIs for ingestion, upload, and export.

## Base
- Prefix: /api
- Content-Type: application/json for JSON routes.
- Multipart: for manual upload route.

## Endpoints

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

## Error Codes (Minimum Set)
- INVALID_INPUT
- INVALID_URL
- URL_FETCH_TIMEOUT
- URL_EXTRACTION_FAILED
- AI_NORMALIZATION_FAILED
- SCHEMA_VALIDATION_FAILED
- IMAGE_DOWNLOAD_FAILED
- INTERNAL_ERROR

## Non-Functional Rules
- Max request size for manual uploads.
- Rate limiting per IP/user (configurable).
- Request ID returned in all responses.

## Acceptance Criteria
- All endpoints implement the exact response envelope.
- Frontend can handle all defined error codes deterministically.