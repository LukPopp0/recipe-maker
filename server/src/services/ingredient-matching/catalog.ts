import { INGREDIENT_IMAGE_MANIFEST } from 'shared';

// Filename of the placeholder image shown when no ingredient match is found.
export const INGREDIENT_NOT_FOUND_IMAGE = 'INGREDIENT_NOT_FOUND.png';

export interface IngredientCatalog {
  filenames: readonly string[]
  has(filename: string): boolean
}

/**
 * Loads the ingredient image catalog from the generated manifest (shared
 * package, Task 1). Pure - reads only the imported constant, no fs access.
 */
export function loadIngredientCatalog(): IngredientCatalog {
  const filenameSet = new Set(INGREDIENT_IMAGE_MANIFEST);

  return {
    filenames: INGREDIENT_IMAGE_MANIFEST,
    has(filename: string): boolean {
      return filenameSet.has(filename);
    },
  };
}

/**
 * Startup readiness check: verifies the not-found placeholder image is
 * present in the manifest. Logs a structured error and returns false when
 * missing, so callers can fail fast rather than serve broken image links.
 */
export function checkIngredientCatalogReady(): boolean {
  const catalog = loadIngredientCatalog();

  if (!catalog.has(INGREDIENT_NOT_FOUND_IMAGE)) {
    console.error(
      JSON.stringify({
        level: 'error',
        message: 'Ingredient image manifest is missing the not-found placeholder',
        expectedFilename: INGREDIENT_NOT_FOUND_IMAGE,
      }),
    );
    return false;
  }

  return true;
}
