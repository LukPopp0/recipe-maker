import { describe, expect, it } from 'vitest';
import { INGREDIENT_IMAGE_MANIFEST } from 'shared';
import { INGREDIENT_NOT_FOUND_IMAGE, ingredientImageUrl } from './ingredient-image.ts';

describe('ingredientImageUrl', () => {
  it('returns the ingredient-images URL for a filename in the manifest', () => {
    const filename = INGREDIENT_IMAGE_MANIFEST[0];
    expect(ingredientImageUrl(filename)).toBe(`/ingredient-images/${filename}`);
  });

  it('returns the not-found image URL for a filename not in the manifest', () => {
    expect(ingredientImageUrl('nonexistent-ingredient.png')).toBe(INGREDIENT_NOT_FOUND_IMAGE);
  });

  it('returns the not-found image URL when filename is undefined', () => {
    expect(ingredientImageUrl(undefined)).toBe(INGREDIENT_NOT_FOUND_IMAGE);
  });

  it('resolves INGREDIENT_NOT_FOUND_IMAGE to the manifest entry', () => {
    expect(INGREDIENT_NOT_FOUND_IMAGE).toBe('/ingredient-images/INGREDIENT_NOT_FOUND.png');
  });
});
