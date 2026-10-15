import type { CanonicalRecipe } from 'shared';
import { describe, expect, it, vi } from 'vitest';
import type { StoredRecipe } from '../recipes/recipe-repository.js';
import { deleteUnsharedRecipeImages } from './delete-recipe-images.js';

const BASE = 'http://localhost:8787';

function recipeWith(main: string, steps: (string | undefined)[] = []): CanonicalRecipe {
  return {
    title: 'R',
    tags: [],
    time: null,
    ingredients: [],
    pantry_items: [],
    main_image: main,
    steps: steps.map((image, i) => ({ step_header: `S${i}`, step_description: 'x', ...(image ? { image } : {}) })),
    metadata: { source_type: 'manual', language: 'en', warnings: [] },
  } as CanonicalRecipe;
}

function stored(recipe: CanonicalRecipe): StoredRecipe {
  return { id: 'other', owner: 'bob', createdAt: '', updatedAt: '', recipe };
}

describe('deleteUnsharedRecipeImages', () => {
  it('deletes only local keys no remaining recipe references', async () => {
    const storageAdapter = { put: vi.fn(), get: vi.fn(), list: vi.fn(), delete: vi.fn(async () => {}) };
    const deleted = recipeWith(`${BASE}/images/recipes/a/main-0.jpg`, [
      '/images/recipes/a/step-0.jpg',
      'https://cdn.other.com/pic.jpg',
    ]);
    const remaining = [stored(recipeWith(`${BASE}/images/recipes/a/main-0.jpg`))];

    const keys = await deleteUnsharedRecipeImages({ deleted, remaining, storageAdapter, publicBaseUrl: BASE, requestId: 'r' });

    expect(keys).toEqual(['recipes/a/step-0.jpg']);
    expect(storageAdapter.delete).toHaveBeenCalledTimes(1);
    expect(storageAdapter.delete).toHaveBeenCalledWith('recipes/a/step-0.jpg');
  });

  it('never deletes the placeholder and never throws when a delete fails', async () => {
    const storageAdapter = {
      put: vi.fn(),
      get: vi.fn(),
      list: vi.fn(),
      delete: vi.fn(async () => {
        throw new Error('disk gone');
      }),
    };
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const deleted = recipeWith('/images/placeholder-recipe.png', ['/images/recipes/a/step-0.jpg']);

    await expect(
      deleteUnsharedRecipeImages({ deleted, remaining: [], storageAdapter, publicBaseUrl: BASE, requestId: 'r' }),
    ).resolves.toEqual([]);
    expect(storageAdapter.delete).toHaveBeenCalledWith('recipes/a/step-0.jpg');
    expect(storageAdapter.delete).not.toHaveBeenCalledWith(expect.stringContaining('placeholder'));
    expect(errorLog).toHaveBeenCalled();
    errorLog.mockRestore();
  });
});
