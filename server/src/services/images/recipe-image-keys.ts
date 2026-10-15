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
// section 8): origin, query and any path prefix before /images/ are ignored,
// so images saved under an older PUBLIC_BASE_URL (another origin, or a base
// path that has since changed) are never mistaken for unused. Never use this
// to pick what to delete; localImageKey stays strict for that.
const REFERENCED_KEY_PATTERN = /\/images\/(recipes\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+)$/;

export function referencedImageKey(url: string, publicBaseUrl: string): string | null {
  const local = localImageKey(url, publicBaseUrl);
  if (local) return local;

  // An unparseable base only matters for resolving root-relative URLs, so a
  // fixed dummy origin is enough.
  let base = 'http://localhost';
  try {
    new URL(publicBaseUrl);
    base = publicBaseUrl;
  } catch {
    // keep default
  }

  let pathname: string;
  try {
    pathname = new URL(url, base).pathname;
  } catch {
    return null;
  }
  const key = REFERENCED_KEY_PATTERN.exec(pathname)?.[1];
  return key && !key.split('/').includes('..') ? key : null;
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
