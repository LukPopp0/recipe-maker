// Error codes per specs/03 minimum set, plus two additions:
// NOT_IMPLEMENTED is not in the spec's literal list. It is needed because Phase 1
// registers the /api/ingest/url and /api/ingest/manual routes before their real
// implementations land in Phase 2/3, and those stub handlers need a standard
// error code to return in the meantime.
// ROUTE_NOT_FOUND is also not in the spec's literal list. It is needed because
// spec 03 does not define a generic "no route matched" code, and RECIPE_NOT_FOUND
// is recipe-specific and semantically wrong for an unmatched-route 404.
export const ERROR_CODES = [
  'INVALID_INPUT',
  'INVALID_URL',
  'URL_FETCH_TIMEOUT',
  'URL_EXTRACTION_FAILED',
  'AI_NORMALIZATION_FAILED',
  'SCHEMA_VALIDATION_FAILED',
  'IMAGE_DOWNLOAD_FAILED',
  'RECIPE_NOT_FOUND',
  'INTERNAL_ERROR',
  'NOT_IMPLEMENTED',
  'ROUTE_NOT_FOUND',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number]

export type ApiError = {
  code: ErrorCode
  message: string
  details?: unknown
}

// Success envelope per specs/03: { ok: true, requestId, ...restOfPayload }.
export type ApiSuccessEnvelope<T extends object = Record<string, never>> = {
  ok: true
  requestId: string
} & T

// Error envelope per specs/03: { ok: false, requestId, error: { code, message, details? } }.
export type ApiErrorEnvelope = {
  ok: false
  requestId: string
  error: ApiError
}

export type ApiResponse<T extends object = Record<string, never>> = ApiSuccessEnvelope<T> | ApiErrorEnvelope
