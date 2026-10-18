import type { CanonicalRecipe, UnhostedImage } from 'shared';
import { fetchAndStoreRemoteImage, type FetchAndStoreRemoteImageResult } from './remote-image-fetcher.js';
import type { StorageAdapter } from '../storage/storage-adapter.js';

// MIME types permitted for re-hosted images per docs/specs/06.
export const ALLOWED_CONTENT_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export interface RehostRecipeImagesOptions {
  recipeId: string
  storageAdapter: StorageAdapter
  maxBytes: number
  // main_image is skipped (not re-downloaded) when it already equals this
  // URL - it's already a hosted asset, not a candidate from the source page.
  // A main image that cannot be hosted is replaced by this URL.
  defaultMainImageUrl: string
  // Leave main_image alone and do not fetch it (the caller supplies it).
  skipMainImage?: boolean
  // Hard timeout (ms) for downloading each image. Defaults to
  // DEFAULT_IMAGE_FETCH_TIMEOUT_MS if not provided.
  timeoutMs?: number
}

export interface RehostRecipeImagesResult {
  recipe: CanonicalRecipe
  warnings: string[]
  // Remote images that could not be hosted (main image and dropped step images).
  unhosted: UnhostedImage[]
}

function isRemoteHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

// Turns a failed fetchAndStoreRemoteImage result into a user-facing warning,
// shared by the main-image and step-image paths so wording stays consistent.
// `label` reads like "Main image" or "Step 3 image".
export function describeRehostFailure(
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
// re-hosts them via storageAdapter, per docs/specs/06's re-hosting rules. Never
// throws: a main-image failure sets main_image to defaultMainImageUrl; a step-image failure drops that
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
  const { recipeId, storageAdapter, maxBytes, defaultMainImageUrl, skipMainImage, timeoutMs } = options;
  const warnings: string[] = [];
  const unhosted: UnhostedImage[] = [];

  let mainImage = recipe.main_image;
  const isDefault = mainImage === defaultMainImageUrl;

  if (!skipMainImage && isRemoteHttpUrl(mainImage) && !isDefault) {
    const result = await fetchAndStoreRemoteImage(mainImage, {
      storageAdapter,
      maxBytes,
      keyPrefix: `recipes/${recipeId}/main-0`,
      timeoutMs,
    });
    if (result.ok) {
      mainImage = result.url;
    } else {
      const warning = describeRehostFailure('Main image', mainImage, result, maxBytes);
      warnings.push(warning);
      unhosted.push({ slot: 'main', url: mainImage, warning });
      mainImage = defaultMainImageUrl;
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
      const warning = describeRehostFailure(`Step ${index + 1} image`, step.image, result, maxBytes);
      warnings.push(warning);
      unhosted.push({ slot: index, url: step.image, warning });
      const { image: _dropped, ...rest } = step;
      steps.push(rest);
    }
  }

  return { recipe: { ...recipe, main_image: mainImage, steps }, warnings, unhosted };
}
