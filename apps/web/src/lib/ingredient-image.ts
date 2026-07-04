// Resolves an ingredient's image filename to a servable URL, falling back to
// the shared "not found" placeholder for anything outside the known catalog.
import { INGREDIENT_IMAGE_MANIFEST } from 'shared';

const MANIFEST_SET = new Set(INGREDIENT_IMAGE_MANIFEST);

export const INGREDIENT_NOT_FOUND_IMAGE = '/ingredient-images/INGREDIENT_NOT_FOUND.png';

export function ingredientImageUrl(filename: string | undefined): string {
  if (filename !== undefined && MANIFEST_SET.has(filename)) {
    return `/ingredient-images/${filename}`;
  }

  return INGREDIENT_NOT_FOUND_IMAGE;
}
