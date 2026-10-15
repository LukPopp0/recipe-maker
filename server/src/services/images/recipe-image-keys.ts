import type { CanonicalRecipe } from 'shared';

// Keys the app itself stored for recipes (manual uploads, step uploads,
// re-hosted URL images) all live under recipes/{namespace}/{file}.
const RECIPE_KEY_PATTERN = /^recipes\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;

// Maps an image URL back to its storage key when it is one of this app's
// own recipe images (`${PUBLIC_BASE_URL}/images/<key>` or `/images/<key>`),
// else null. External URLs, the default placeholder and ingredient catalog
// filenames are never local recipe images, so they are never deleted.
export function localImageKey(url: string, publicBaseUrl: string): string | null {
  const prefixes = [`${publicBaseUrl}/images/`, '/images/'];
  const prefix = prefixes.find((candidate) => url.startsWith(candidate));
  if (!prefix) return null;

  const key = url.slice(prefix.length);
  return RECIPE_KEY_PATTERN.test(key) && !key.split('/').includes('..') ? key : null;
}

// Liberal counterpart for deciding what is still *used* (deployment spec
// section 8): the origin and query are ignored, so images saved under an
// older PUBLIC_BASE_URL (or with a ?v= query) are never mistaken for unused.
// It accepts everything localImageKey accepts, plus a `/images/` path under
// the current base path (a base like https://host/app puts files at
// /app/images/...). Never use this to pick what to delete; localImageKey
// stays strict for that.
export function referencedImageKey(url: string, publicBaseUrl: string): string | null {
  const local = localImageKey(url, publicBaseUrl);
  if (local) return local;

  // An unparseable base fails toward "used": only the plain /images/ path is tried.
  let basePath = '';
  let base = 'http://localhost';
  try {
    const parsed = new URL(publicBaseUrl);
    basePath = parsed.pathname.replace(/\/+$/, '');
    base = publicBaseUrl;
  } catch {
    // keep defaults
  }

  let pathname: string;
  try {
    pathname = new URL(url, base).pathname;
  } catch {
    return null;
  }
  const prefix = [`${basePath}/images/`, '/images/'].find((candidate) => pathname.startsWith(candidate));
  if (!prefix) return null;

  const key = pathname.slice(prefix.length);
  return RECIPE_KEY_PATTERN.test(key) && !key.split('/').includes('..') ? key : null;
}

function recipeImageUrls(recipe: CanonicalRecipe): string[] {
  return [recipe.main_image, ...recipe.steps.map((step) => step.image ?? '')];
}

// Unique keys a recipe may still display, matched origin-insensitively.
export function referencedImageKeys(recipe: CanonicalRecipe, publicBaseUrl: string): string[] {
  const keys = recipeImageUrls(recipe)
    .map((url) => referencedImageKey(url, publicBaseUrl))
    .filter((key): key is string => key !== null);
  return [...new Set(keys)];
}

// Unique local image keys a recipe references (main image + step images).
export function recipeImageKeys(recipe: CanonicalRecipe, publicBaseUrl: string): string[] {
  const keys = recipeImageUrls(recipe)
    .map((url) => localImageKey(url, publicBaseUrl))
    .filter((key): key is string => key !== null);
  return [...new Set(keys)];
}
