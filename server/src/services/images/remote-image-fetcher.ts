import { AppError } from '../../lib/errors.js';
import { readBodyBytesWithLimit, resolveAndCheckHost, validateUrlSyntax } from '../url-ingestion/url-security.js';
import type { StorageAdapter } from '../storage/storage-adapter.js';
import { ALLOWED_CONTENT_TYPES } from './image-rehoster.js';

// Default hard timeout for a single remote-image download when the caller
// omits timeoutMs. Callers with env access should pass URL_FETCH_TIMEOUT_MS.
const DEFAULT_IMAGE_FETCH_TIMEOUT_MS = 8000;

export interface FetchAndStoreRemoteImageOptions {
  storageAdapter: StorageAdapter
  maxBytes: number
  // Storage key without extension; the extension is derived from the response
  // content type (e.g. 'recipes/<id>/main-0' -> 'recipes/<id>/main-0.jpg').
  keyPrefix: string
  timeoutMs?: number
}

// Discriminated result so callers own their user-facing warning wording.
export type FetchAndStoreRemoteImageResult =
  | { ok: true; url: string }
  | { ok: false; reason: 'blocked' }
  | { ok: false; reason: 'status'; status: number }
  | { ok: false; reason: 'unsupported-type'; contentType: string }
  | { ok: false; reason: 'oversized' }
  | { ok: false; reason: 'timeout' }
  | { ok: false; reason: 'error'; message: string };

// Downloads a single remote http(s) image and stores it via storageAdapter,
// applying the same SSRF guardrails as the page fetch (validateUrlSyntax +
// resolveAndCheckHost), a hard timeout, streaming maxBytes enforcement, and a
// content-type allowlist. Never throws: every failure mode maps to a typed
// {ok:false, reason} result. Shared by rehostRecipeImages (Option A main image)
// and manual ingestion's image-URL entries (Option B).
export async function fetchAndStoreRemoteImage(
  imageUrl: string,
  options: FetchAndStoreRemoteImageOptions,
): Promise<FetchAndStoreRemoteImageResult> {
  const { storageAdapter, maxBytes, keyPrefix, timeoutMs = DEFAULT_IMAGE_FETCH_TIMEOUT_MS } = options;

  let validatedUrl: URL;
  try {
    validatedUrl = validateUrlSyntax(imageUrl);
    await resolveAndCheckHost(validatedUrl.hostname);
  } catch {
    return { ok: false, reason: 'blocked' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // redirect: 'manual' - a redirect target is not re-validated against the
    // SSRF blocklist, so treat any redirect as a failure rather than following
    // it (mirrors fetchWithGuardrails re-validating every hop, without
    // reimplementing its redirect loop for a single-file download).
    const response = await fetch(validatedUrl, { redirect: 'manual', signal: controller.signal });

    if (!response.ok) {
      return { ok: false, reason: 'status', status: response.status };
    }

    const contentType = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    const ext = ALLOWED_CONTENT_TYPES[contentType];
    if (!ext) {
      return { ok: false, reason: 'unsupported-type', contentType: contentType || 'unknown' };
    }

    const buffer = await readBodyBytesWithLimit(response, maxBytes, controller);

    const key = `${keyPrefix}.${ext}`;
    const url = await storageAdapter.put(buffer, key, contentType);
    return { ok: true, url };
  } catch (err) {
    if (err instanceof AppError) {
      // readBodyBytesWithLimit throws AppError only on the maxBytes overflow.
      return { ok: false, reason: 'oversized' };
    }
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, reason: 'timeout' };
    }
    return { ok: false, reason: 'error', message: err instanceof Error ? err.message : 'unknown error' };
  } finally {
    clearTimeout(timer);
  }
}
