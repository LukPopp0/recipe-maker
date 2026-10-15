import type { CanonicalRecipe } from 'shared';
import { describe, expect, it } from 'vitest';
import { localImageKey, recipeImageKeys } from './recipe-image-keys.js';

const BASE = 'https://recipes.example.com';

describe('localImageKey', () => {
  it('returns the key for an absolute or root-relative local recipe image URL', () => {
    expect(localImageKey(`${BASE}/images/recipes/abc/main-0.jpg`, BASE)).toBe('recipes/abc/main-0.jpg');
    expect(localImageKey('/images/recipes/abc/step-1.jpg', BASE)).toBe('recipes/abc/step-1.jpg');
  });

  it('returns null for external URLs, the placeholder, catalog images and traversal', () => {
    expect(localImageKey('https://cdn.other.com/images/recipes/abc/main-0.jpg', BASE)).toBeNull();
    expect(localImageKey('/images/placeholder-recipe.png', BASE)).toBeNull();
    expect(localImageKey('salt.png', BASE)).toBeNull();
    expect(localImageKey('/images/recipes/../../etc/passwd', BASE)).toBeNull();
    expect(localImageKey('', BASE)).toBeNull();
  });
});

describe('recipeImageKeys', () => {
  it('collects unique local keys from main_image and step images', () => {
    const recipe = {
      main_image: `${BASE}/images/recipes/abc/main-0.jpg`,
      steps: [
        { step_header: 'A', step_description: 'a', image: '/images/recipes/abc/step-0.jpg' },
        { step_header: 'B', step_description: 'b', image: `${BASE}/images/recipes/abc/main-0.jpg` },
        { step_header: 'C', step_description: 'c', image: 'https://cdn.other.com/x.jpg' },
        { step_header: 'D', step_description: 'd' },
      ],
    } as unknown as CanonicalRecipe;

    expect(recipeImageKeys(recipe, BASE).sort()).toEqual(['recipes/abc/main-0.jpg', 'recipes/abc/step-0.jpg']);
  });
});
