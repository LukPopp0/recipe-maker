import type { CanonicalRecipe } from 'shared';
import { describe, expect, it } from 'vitest';
import { localImageKey, recipeImageKeys, referencedImageKey, referencedImageKeys } from './recipe-image-keys.js';

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

describe('referencedImageKey', () => {
  it('ignores origin and query string so a changed PUBLIC_BASE_URL still counts as used', () => {
    expect(referencedImageKey('http://old-host.example.com/images/recipes/abc/main-0.jpg', BASE)).toBe('recipes/abc/main-0.jpg');
    expect(referencedImageKey(`${BASE}/images/recipes/abc/main-0.jpg?v=123#x`, BASE)).toBe('recipes/abc/main-0.jpg');
    expect(referencedImageKey('/images/recipes/abc/step-1.jpg', BASE)).toBe('recipes/abc/step-1.jpg');
  });

  it('returns null for paths outside /images/recipes, traversal and garbage', () => {
    expect(referencedImageKey('https://cdn.other.com/pics/recipes/abc/main-0.jpg', BASE)).toBeNull();
    expect(referencedImageKey('/images/placeholder-recipe.png', BASE)).toBeNull();
    expect(referencedImageKey('/images/recipes/../../etc/passwd', BASE)).toBeNull();
    expect(referencedImageKey('http://', BASE)).toBeNull();
    expect(referencedImageKey('', BASE)).toBeNull();
  });
});

describe('referencedImageKeys', () => {
  it('collects keys from main_image and steps regardless of origin', () => {
    const recipe = {
      main_image: 'http://old-host.example.com/images/recipes/abc/main-0.jpg',
      steps: [{ step_header: 'A', step_description: 'a', image: '/images/recipes/abc/step-0.jpg' }],
    } as unknown as CanonicalRecipe;

    expect(referencedImageKeys(recipe, BASE).sort()).toEqual(['recipes/abc/main-0.jpg', 'recipes/abc/step-0.jpg']);
  });
});

describe('base URL with a path', () => {
  const APP = 'https://recipes.example.com/app';

  it('keeps localImageKey strict', () => {
    expect(localImageKey(`${APP}/images/recipes/abc/main-0.jpg`, APP)).toBe('recipes/abc/main-0.jpg');
    expect(localImageKey('/images/recipes/abc/main-0.jpg', APP)).toBe('recipes/abc/main-0.jpg');
    expect(localImageKey('https://old.example.com/app/images/recipes/abc/main-0.jpg', APP)).toBeNull();
  });

  it('counts own, other-origin and root-relative URLs as referenced', () => {
    expect(referencedImageKey(`${APP}/images/recipes/abc/main-0.jpg`, APP)).toBe('recipes/abc/main-0.jpg');
    expect(referencedImageKey('https://old.example.com/app/images/recipes/abc/main-0.jpg', APP)).toBe('recipes/abc/main-0.jpg');
    expect(referencedImageKey('/images/recipes/abc/main-0.jpg', APP)).toBe('recipes/abc/main-0.jpg');
  });

  it('tolerates a trailing slash on the base URL and an invalid base URL', () => {
    expect(referencedImageKey(`${APP}/images/recipes/abc/main-0.jpg`, `${APP}/`)).toBe('recipes/abc/main-0.jpg');
    expect(referencedImageKey('/images/recipes/abc/main-0.jpg', 'not a url')).toBe('recipes/abc/main-0.jpg');
  });
});
