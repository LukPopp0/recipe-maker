import type { CanonicalRecipe } from 'shared';
import { fetchAndStoreRemoteImage } from './remote-image-fetcher.js';
import type { StorageAdapter } from '../storage/storage-adapter.js';

// MIME types permitted for re-hosted images per specs/06.
export const ALLOWED_CONTENT_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export interface RehostRecipeImagesOptions {
  recipeId: string
  storageAdapter: StorageAdapter
  maxBytes: number
  // main_image is skipped (left untouched, not re-downloaded) when it already
  // equals the configured default image URL - it's already a hosted asset,
  // not a candidate extracted from the source page.
  defaultMainImageUrl?: string
  // Reserved for Phase 3 (manual/Option B ingestion) reuse; Option A never
  // produces step images (specs/04), so Phase 2 callers always pass [].
  stepImages?: string[]
  // Hard timeout (ms) for downloading main_image. Defaults to
  // DEFAULT_IMAGE_FETCH_TIMEOUT_MS if not provided.
  timeoutMs?: number
}

export interface RehostRecipeImagesResult {
  recipe: CanonicalRecipe
  warnings: string[]
}

function isRemoteHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

// Downloads recipe.main_image (when it's a remote http(s) URL that isn't
// already the configured default) and re-hosts it via storageAdapter, per
// specs/06's re-hosting rules. Never throws: any failure (bad MIME, oversized,
// network error, blocked/invalid URL, timeout) leaves main_image untouched and
// appends a warning string, so finalSanitize's default-fallback can take over
// downstream.
//
// main_image is attacker-controllable: it's scraped from candidate image URLs
// on the source recipe page and picked by Gemini, so it goes through the same
// SSRF guardrails (validateUrlSyntax + resolveAndCheckHost, per
// url-ingestion/url-security.ts) as the page fetch before ever being
// requested, plus a hard timeout and streaming maxBytes enforcement.
export async function rehostRecipeImages(
  recipe: CanonicalRecipe,
  options: RehostRecipeImagesOptions,
): Promise<RehostRecipeImagesResult> {
  const { recipeId, storageAdapter, maxBytes, defaultMainImageUrl, timeoutMs } = options;
  const warnings: string[] = [];

  const mainImage = recipe.main_image;
  const isDefault = defaultMainImageUrl !== undefined && mainImage === defaultMainImageUrl;

  if (!isRemoteHttpUrl(mainImage) || isDefault) {
    return { recipe, warnings };
  }

  const result = await fetchAndStoreRemoteImage(mainImage, {
    storageAdapter,
    maxBytes,
    keyPrefix: `recipes/${recipeId}/main-0`,
    timeoutMs,
  });

  if (result.ok) {
    return { recipe: { ...recipe, main_image: result.url }, warnings };
  }

  switch (result.reason) {
    case 'blocked':
      warnings.push(`Main image was not re-hosted: "${mainImage}" was blocked or invalid.`);
      break;
    case 'status':
      warnings.push(`Main image was not re-hosted: request to "${mainImage}" failed with status ${result.status}.`);
      break;
    case 'unsupported-type':
      warnings.push(
        `Main image was not re-hosted: unsupported content type "${result.contentType}" for "${mainImage}".`,
      );
      break;
    case 'oversized':
      warnings.push(`Main image was not re-hosted: "${mainImage}" exceeded the ${maxBytes}-byte limit.`);
      break;
    case 'timeout':
      warnings.push(`Main image was not re-hosted: timed out while downloading "${mainImage}".`);
      break;
    case 'error':
      warnings.push(`Main image was not re-hosted: failed to download "${mainImage}" (${result.message}).`);
      break;
  }

  return { recipe, warnings };
}
