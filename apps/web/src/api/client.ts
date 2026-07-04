// Typed API client for the frontend. All fetch calls live here - the rest of
// the app never calls fetch directly. Every endpoint returns a ClientResult
// so callers branch on `.ok` instead of catching exceptions.
import type { ApiErrorEnvelope, ApiResponse, CanonicalRecipe } from 'shared';

export interface IngestDiagnostics {
  extractor: string
  model: string
  durationMs: number
}

export type IngestResult = {
  recipe: CanonicalRecipe
  diagnostics: IngestDiagnostics
}

export type ApiFailure = {
  code: string
  message: string
  details?: unknown
  requestId?: string
}

export type ClientResult<T> = { ok: true; value: T } | { ok: false; error: ApiFailure }

// zod's SafeParseError['error'].flatten() shape - shared does not export this
// (it is a validation-library detail, not a domain type), so it is typed here.
export type FlattenedErrors = {
  formErrors: string[]
  fieldErrors: Record<string, string[]>
}

function networkFailure(): ClientResult<never> {
  return {
    ok: false,
    error: {
      code: 'NETWORK_ERROR',
      message: 'Could not reach the server. Check your connection and try again.',
    },
  };
}

function malformedResponseFailure(): ClientResult<never> {
  return {
    ok: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'The server returned an unexpected response.',
    },
  };
}

// Single place that unwraps ApiResponse envelopes and normalizes every
// failure mode (transport, parsing, and application-level errors) into the
// same ApiFailure shape. Per-endpoint functions below stay thin wrappers.
async function request<T extends object>(input: string, init?: RequestInit): Promise<ClientResult<T>> {
  let response: Response;
  try {
    response = await fetch(input, init);
  } catch {
    return networkFailure();
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return malformedResponseFailure();
  }

  if (body === null || typeof body !== 'object' || !('ok' in body)) {
    return malformedResponseFailure();
  }

  const envelope = body as ApiResponse<T>;

  if (envelope.ok === false) {
    const errorEnvelope = envelope as ApiErrorEnvelope;
    return {
      ok: false,
      error: {
        code: errorEnvelope.error.code,
        message: errorEnvelope.error.message,
        details: errorEnvelope.error.details,
        requestId: errorEnvelope.requestId,
      },
    };
  }

  const { ok: isOk, requestId, ...payload } = envelope;
  void isOk;
  void requestId;
  return { ok: true, value: payload as T };
}

export async function ingestUrl(url: string): Promise<ClientResult<IngestResult>> {
  return request<IngestResult>('/api/ingest/url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
}

export async function ingestManual(fields: {
  ingredientsText: string
  stepsText: string
  mainImage: File
  stepImages: File[]
}): Promise<ClientResult<IngestResult>> {
  const formData = new FormData();
  formData.append('ingredientsText', fields.ingredientsText);
  formData.append('stepsText', fields.stepsText);
  formData.append('mainImage', fields.mainImage);
  for (const stepImage of fields.stepImages) {
    formData.append('stepImages', stepImage);
  }

  return request<IngestResult>('/api/ingest/manual', {
    method: 'POST',
    body: formData,
  });
}

export async function validateRecipe(
  candidate: unknown,
): Promise<ClientResult<{ valid: true; recipe: CanonicalRecipe } | { valid: false; errors: FlattenedErrors }>> {
  return request('/api/recipe/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(candidate),
  });
}

export async function saveRecipe(recipe: CanonicalRecipe): Promise<ClientResult<{ id: string }>> {
  return request('/api/recipe/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(recipe),
  });
}
