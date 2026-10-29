// Typed API client for the frontend. All fetch calls live here - the rest of
// the app never calls fetch directly. Every endpoint returns a ClientResult
// so callers branch on `.ok` instead of catching exceptions.
import type {
  ApiErrorEnvelope,
  ApiResponse,
  CanonicalRecipe,
  CapturePayload,
  CurrentUser,
  ImageSlot,
  LibraryScope,
  RecipeMeta,
  RecipeSummary,
  UnhostedImage,
  UnusedImage,
} from 'shared';

export interface IngestDiagnostics {
  extractor: string
  model: string
  durationMs: number
}

export type IngestResult = {
  recipe: CanonicalRecipe
  diagnostics: IngestDiagnostics
  // Storage-key namespace of the ingestion's hosted images; the review panel
  // uploads images into the same namespace via uploadImage/linkImage.
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

export type CaptureIngestResult = IngestResult & { unhosted: UnhostedImage[] }

// Posts a page captured by the user's own browser (bookmarklet / extension).
export async function ingestCapture(payload: CapturePayload): Promise<ClientResult<CaptureIngestResult>> {
  const formData = new FormData();
  formData.append('url', payload.url);
  formData.append('html', payload.html);
  if (payload.mainImageUrl) {
    formData.append('mainImageUrl', payload.mainImageUrl);
  }
  // The server checks the file type, so the part always carries the blob's own image/* type.
  if (payload.mainImage) {
    formData.append('mainImage', new File([payload.mainImage], 'main-image', { type: payload.mainImage.type }));
  }
  return request<CaptureIngestResult>('/api/ingest/capture', {
    method: 'POST',
    body: formData,
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

// Uploads image bytes into one slot ('main' or a step index) of an ingestion's
// image namespace. The blob keeps its own type when wrapped by FormData; the
// server rejects anything that is not exactly jpeg, png or webp.
export async function uploadImage(
  namespaceId: string,
  slot: ImageSlot,
  file: Blob,
  filename = 'image',
): Promise<ClientResult<{ url: string }>> {
  const formData = new FormData();
  formData.append('namespaceId', namespaceId);
  formData.append('slot', String(slot));
  formData.append('file', file, filename);

  return request<{ url: string }>('/api/image/upload', {
    method: 'POST',
    body: formData,
  });
}

// Asks the server to fetch and host a remote image into a slot.
export async function linkImage(
  namespaceId: string,
  slot: ImageSlot,
  url: string,
): Promise<ClientResult<{ url: string }>> {
  return request<{ url: string }>('/api/image/link', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ namespaceId, slot, url }),
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

// Replaces the stored recipe in place. The owner never changes on update, so
// the body is the recipe alone.
export async function updateRecipe(id: string, recipe: CanonicalRecipe): Promise<ClientResult<{ id: string }>> {
  return request(`/api/recipe/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(recipe),
  });
}

export async function listRecipes(scope: LibraryScope = 'all'): Promise<ClientResult<{ recipes: RecipeSummary[] }>> {
  return request(`/api/recipes?scope=${scope}`);
}

export async function getRecipe(id: string): Promise<ClientResult<{ recipe: CanonicalRecipe; meta: RecipeMeta }>> {
  return request(`/api/recipe/${encodeURIComponent(id)}`);
}

export async function deleteRecipe(id: string): Promise<ClientResult<Record<string, never>>> {
  return request(`/api/recipe/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function getMe(): Promise<ClientResult<{ user: CurrentUser; placeholderImageUrl: string }>> {
  return request('/api/me');
}

export async function listUnusedImages(): Promise<ClientResult<{ images: UnusedImage[] }>> {
  return request('/api/admin/images/unused');
}

export async function deleteImages(keys: string[]): Promise<ClientResult<{ deleted: number }>> {
  return request('/api/admin/images/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keys }),
  });
}
