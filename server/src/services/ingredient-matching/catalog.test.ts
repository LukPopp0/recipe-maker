import { describe, expect, it } from 'vitest';
import { INGREDIENT_NOT_FOUND_IMAGE, checkIngredientCatalogReady, loadIngredientCatalog } from './catalog.js';

describe('loadIngredientCatalog', () => {
  it('returns all 215 filenames from the manifest', () => {
    const catalog = loadIngredientCatalog();
    expect(catalog.filenames).toHaveLength(215);
  });

  it('has() returns true for a known filename', () => {
    const catalog = loadIngredientCatalog();
    expect(catalog.has('broccoli.png')).toBe(true);
  });

  it('has() returns false for an unknown filename', () => {
    const catalog = loadIngredientCatalog();
    expect(catalog.has('made-up.png')).toBe(false);
  });

  it('includes the INGREDIENT_NOT_FOUND placeholder image', () => {
    const catalog = loadIngredientCatalog();
    expect(catalog.has(INGREDIENT_NOT_FOUND_IMAGE)).toBe(true);
  });
});

describe('checkIngredientCatalogReady', () => {
  it('returns true against the real manifest', () => {
    expect(checkIngredientCatalogReady()).toBe(true);
  });
});
