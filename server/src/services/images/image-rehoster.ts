import type { CanonicalRecipe } from 'shared';
import { fetchAndStoreRemoteImage, type FetchAndStoreRemoteImageResult } from './remote-image-fetcher.js';
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
  // Hard timeout (ms) for downloading each image. Defaults to
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

// Turns a failed fetchAndStoreRemoteImage result into a user-facing warning,
// shared by the main-image and step-image paths so wording stays consistent.
// `label` reads like "Main image" or "Step 3 image".
function describeRehostFailure(
  label: string,
  imageUrl: string,
  result: Extract<FetchAndStoreRemoteImageResult, { ok: false }>,
  maxBytes: number,
): string {
  switch (result.reason) {
    case 'blocked':
      return `${label} was not re-hosted: "${imageUrl}" was blocked or invalid.`;
    case 'status':
      return `${label} was not re-hosted: request to "${imageUrl}" failed with status ${result.status}.`;
    case 'unsupported-type':
      return `${label} was not re-hosted: unsupported content type "${result.contentType}" for "${imageUrl}".`;
    case 'oversized':
      return `${label} was not re-hosted: "${imageUrl}" exceeded the ${maxBytes}-byte limit.`;
    case 'timeout':
      return `${label} was not re-hosted: timed out while downloading "${imageUrl}".`;
    case 'error':
      return `${label} was not re-hosted: failed to download "${imageUrl}" (${result.message}).`;
  }
}

// Downloads recipe.main_image (when it's a remote http(s) URL that isn't
// already the configured default) plus any remote steps[].image URLs and
// re-hosts them via storageAdapter, per specs/06's re-hosting rules. Never
// throws: a main-image failure leaves main_image untouched (finalSanitize's
// default-fallback takes over downstream); a step-image failure drops that
// step's image (the card falls back to its text-only variant). Every failure
// appends a warning string.
//
// All these URLs are attacker-controllable: they're scraped from candidate
// image URLs / JSON-LD on the source recipe page and picked by Gemini, so
// each goes through the same SSRF guardrails (validateUrlSyntax +
// resolveAndCheckHost, per url-ingestion/url-security.ts) as the page fetch
// before ever being requested, plus a hard timeout and streaming maxBytes
// enforcement.
export async function rehostRecipeImages(
  recipe: CanonicalRecipe,
  options: RehostRecipeImagesOptions,
): Promise<RehostRecipeImagesResult> {
  const { recipeId, storageAdapter, maxBytes, defaultMainImageUrl, timeoutMs } = options;
  const warnings: string[] = [];

  let mainImage = recipe.main_image;
  const isDefault = defaultMainImageUrl !== undefined && mainImage === defaultMainImageUrl;

  if (isRemoteHttpUrl(mainImage) && !isDefault) {
    const result = await fetchAndStoreRemoteImage(mainImage, {
      storageAdapter,
      maxBytes,
      keyPrefix: `recipes/${recipeId}/main-0`,
      timeoutMs,
    });
    if (result.ok) {
      mainImage = result.url;
    } else {
      warnings.push(describeRehostFailure('Main image', mainImage, result, maxBytes));
    }
  }

  // Sequential so warnings keep step order deterministic.
  const steps: CanonicalRecipe['steps'] = [];
  for (const [index, step] of recipe.steps.entries()) {
    if (step.image === undefined || !isRemoteHttpUrl(step.image)) {
      steps.push(step);
      continue;
    }

    const result = await fetchAndStoreRemoteImage(step.image, {
      storageAdapter,
      maxBytes,
      keyPrefix: `recipes/${recipeId}/step-${index}`,
      timeoutMs,
    });
    if (result.ok) {
      steps.push({ ...step, image: result.url });
    } else {
      warnings.push(describeRehostFailure(`Step ${index + 1} image`, step.image, result, maxBytes));
      const { image: _dropped, ...rest } = step;
      steps.push(rest);
    }
  }

  return { recipe: { ...recipe, main_image: mainImage, steps }, warnings };
}
