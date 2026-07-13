// Typed API client for the frontend. All fetch calls live here - the rest of
// the app never calls fetch directly. Every endpoint returns a ClientResult
// so callers branch on `.ok` instead of catching exceptions.
import type { ApiErrorEnvelope, ApiResponse, CanonicalRecipe, RecipeSummary } from 'shared';

export interface IngestDiagnostics {
  extractor: string
  model: string
  durationMs: number
}

export type IngestResult = {
  recipe: CanonicalRecipe
  diagnostics: IngestDiagnostics
  // Storage-key namespace of the ingestion's hosted images; the review panel
  // uploads step images into the same namespace via uploadStepImage.
  imageNamespaceId: string
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

function networkFailure(requestId: string): ClientResult<never> {
  return {
    ok: false,
    error: {
      code: 'NETWORK_ERROR',
      message: 'Could not reach the server. Check your connection and try again.',
      requestId,
    },
  };
}

function malformedResponseFailure(requestId: string): ClientResult<never> {
  return {
    ok: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'The server returned an unexpected response.',
      requestId,
    },
  };
}

// Single place that unwraps ApiResponse envelopes and normalizes every
// failure mode (transport, parsing, and application-level errors) into the
// same ApiFailure shape. Per-endpoint functions below stay thin wrappers.
async function request<T extends object>(input: string, init?: RequestInit): Promise<ClientResult<T>> {
  const requestId = crypto.randomUUID();
  const headers = { ...(init?.headers as Record<string, string>), 'x-request-id': requestId };

  let response: Response;
  try {
    response = await fetch(input, { ...init, headers });
  } catch {
    return networkFailure(requestId);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return malformedResponseFailure(requestId);
  }

  if (body === null || typeof body !== 'object' || !('ok' in body)) {
    return malformedResponseFailure(requestId);
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

  const { ok: isOk, requestId: envelopeRequestId, ...payload } = envelope;
  void isOk;
  void envelopeRequestId;
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
  mainImage?: File
  mainImageUrl?: string
  stepImages: File[]
  stepImageUrls?: string[]
}): Promise<ClientResult<IngestResult>> {
  const formData = new FormData();
  formData.append('ingredientsText', fields.ingredientsText);
  formData.append('stepsText', fields.stepsText);
  if (fields.mainImage) {
    formData.append('mainImage', fields.mainImage);
  }
  if (fields.mainImageUrl && fields.mainImageUrl.trim() !== '') {
    formData.append('mainImageUrl', fields.mainImageUrl.trim());
  }
  for (const stepImage of fields.stepImages) {
    formData.append('stepImages', stepImage);
  }
  for (const stepImageUrl of fields.stepImageUrls ?? []) {
    if (stepImageUrl.trim() !== '') {
      formData.append('stepImageUrls', stepImageUrl.trim());
    }
  }

  return request<IngestResult>('/api/ingest/manual', {
    method: 'POST',
    body: formData,
  });
}

// Uploads one step image from the review panel. The server hosts it under
// recipes/{namespaceId}/step-{stepIndex} and returns the hosted URL; the
// caller writes that URL onto the step being edited.
export async function uploadStepImage(
  namespaceId: string,
  stepIndex: number,
  file: File,
): Promise<ClientResult<{ url: string }>> {
  const formData = new FormData();
  formData.append('namespaceId', namespaceId);
  formData.append('stepIndex', String(stepIndex));
  formData.append('file', file);

  return request<{ url: string }>('/api/image/step', {
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

export async function listRecipes(): Promise<ClientResult<{ recipes: RecipeSummary[] }>> {
  return request('/api/recipes');
}

export async function getRecipe(id: string): Promise<ClientResult<{ recipe: CanonicalRecipe }>> {
  return request(`/api/recipe/${encodeURIComponent(id)}`);
}

export async function deleteRecipe(id: string): Promise<ClientResult<Record<string, never>>> {
  return request(`/api/recipe/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
