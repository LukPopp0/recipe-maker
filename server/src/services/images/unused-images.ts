import type { StoredRecipe } from '../recipes/recipe-repository.js';
import type { StoredObject } from '../storage/storage-adapter.js';
import { recipeImageKeys } from './recipe-image-keys.js';

// Images younger than this may belong to an ingest still open in someone's
// Create workspace (not saved yet), so they are never offered for cleanup.
export const UNUSED_IMAGE_MIN_AGE_MS = 24 * 60 * 60 * 1000;

export function findUnusedImages(params: {
  objects: StoredObject[]
  recipes: StoredRecipe[]
  publicBaseUrl: string
  now: Date
}): StoredObject[] {
  const { objects, recipes, publicBaseUrl, now } = params;
  const used = new Set(recipes.flatMap((entry) => recipeImageKeys(entry.recipe, publicBaseUrl)));
  const cutoff = now.getTime() - UNUSED_IMAGE_MIN_AGE_MS;
  return objects.filter((object) => !used.has(object.key) && object.modifiedAt.getTime() <= cutoff);
}
