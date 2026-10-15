import type { CanonicalRecipe } from 'shared';
import type { StoredRecipe } from '../recipes/recipe-repository.js';
import type { StorageAdapter } from '../storage/storage-adapter.js';
import { recipeImageKeys, referencedImageKeys } from './recipe-image-keys.js';

export interface DeleteUnsharedRecipeImagesParams {
  deleted: CanonicalRecipe
  remaining: StoredRecipe[]
  storageAdapter: StorageAdapter
  publicBaseUrl: string
  requestId: string
}

// After a recipe delete (deployment spec section 8): removes the recipe's
// own local images unless another saved recipe still points at them (e.g. a
// "Save as new" copy). Failures are logged, never thrown - the recipe is
// already gone and a leftover file is harmless (the admin cleanup finds it).
export async function deleteUnsharedRecipeImages(params: DeleteUnsharedRecipeImagesParams): Promise<string[]> {
  const { deleted, remaining, storageAdapter, publicBaseUrl, requestId } = params;
  const stillUsed = new Set(remaining.flatMap((entry) => referencedImageKeys(entry.recipe, publicBaseUrl)));
  const removed: string[] = [];

  for (const key of recipeImageKeys(deleted, publicBaseUrl)) {
    if (stillUsed.has(key)) continue;
    try {
      await storageAdapter.delete(key);
      removed.push(key);
    } catch (err) {
      console.error(
        JSON.stringify({
          level: 'error',
          message: 'Failed to delete recipe image',
          requestId,
          key,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }
  return removed;
}
