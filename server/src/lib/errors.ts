import type { ApiError, ErrorCode } from 'shared';

// HTTP status per error code, per specs/03.
export const ERROR_STATUS_MAP: Record<ErrorCode, number> = {
  INVALID_INPUT: 400,
  INVALID_URL: 400,
  URL_FETCH_TIMEOUT: 504,
  URL_FETCH_BLOCKED: 422,
  URL_FETCH_FAILED: 422,
  URL_EXTRACTION_FAILED: 422,
  AI_NORMALIZATION_FAILED: 502,
  SCHEMA_VALIDATION_FAILED: 422,
  IMAGE_DOWNLOAD_FAILED: 502,
  RECIPE_NOT_FOUND: 404,
  INTERNAL_ERROR: 500,
  NOT_IMPLEMENTED: 501,
  ROUTE_NOT_FOUND: 404,
  RATE_LIMITED: 429,
};

// Default user-safe message per error code, used when a caller does not
// supply a more specific message.
export const ERROR_DEFAULT_MESSAGE: Record<ErrorCode, string> = {
  INVALID_INPUT: 'The request input is invalid.',
  INVALID_URL: 'The provided URL is invalid.',
  URL_FETCH_TIMEOUT: 'Timed out while fetching the URL.',
  URL_FETCH_BLOCKED: 'This site blocks automated access. Copy the recipe into the Manual tab instead.',
  URL_FETCH_FAILED: 'The site returned an error while fetching the URL.',
  URL_EXTRACTION_FAILED: 'Failed to extract recipe content from the URL.',
  AI_NORMALIZATION_FAILED: 'Failed to normalize the recipe with AI.',
  SCHEMA_VALIDATION_FAILED: 'The recipe data failed schema validation.',
  IMAGE_DOWNLOAD_FAILED: 'Failed to download an image.',
  RECIPE_NOT_FOUND: 'The requested recipe does not exist.',
  INTERNAL_ERROR: 'An unexpected error occurred.',
  NOT_IMPLEMENTED: 'This feature is not implemented yet.',
  ROUTE_NOT_FOUND: 'The requested route does not exist.',
  RATE_LIMITED: 'Too many ingestion requests. Wait a moment and try again.',
};

// Application-level error carrying a standardized error code and optional
// machine-readable details, plus the HTTP status derived from that code.
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
  }

  get status(): number {
    return ERROR_STATUS_MAP[this.code];
  }
}

// Collapses any thrown value into a safe, standardized ApiError. AppErrors pass
// through their code/message/details; anything else (unknown Error, string,
// object, etc.) collapses to a generic INTERNAL_ERROR so internals never leak.
export function serializeError(err: unknown): ApiError {
  if (err instanceof AppError) {
    return {
      code: err.code,
      message: err.message,
      details: err.details,
    };
  }

  return {
    code: 'INTERNAL_ERROR',
    message: 'An unexpected error occurred.',
  };
}
