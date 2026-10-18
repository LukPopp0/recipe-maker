import { describe, expect, it } from 'vitest';
import type { CanonicalRecipe } from 'shared';
import {
  DEFAULT_PLACEHOLDER_IMAGE_URL,
  isMissingMainImage,
  isSlotEmpty,
  removeSlotWarnings,
  setSlotImage,
} from './image-slots.ts';

const P = DEFAULT_PLACEHOLDER_IMAGE_URL;

function makeRecipe(): CanonicalRecipe {
  return {
    title: 'T',
    tags: [],
    time: null,
    ingredients: [],
    pantry_items: [],
    main_image: '/images/recipes/ns/main.jpg',
    steps: [
      { step_header: 'A', step_description: 'a', image: '/images/recipes/ns/step-0.jpg' },
      { step_header: 'B', step_description: 'b' },
    ],
    metadata: {
      source_type: 'url',
      language: 'en',
      warnings: ['Main image was not re-hosted: x', 'Step 1 image was not re-hosted: y', 'Other'],
    },
  };
}

describe('image-slots', () => {
  it('treats blank and placeholder main images as missing', () => {
    expect(isMissingMainImage('', P)).toBe(true);
    expect(isMissingMainImage(P, P)).toBe(true);
    expect(isMissingMainImage('https://cdn.x/remote.jpg', P)).toBe(false);
  });

  it('strips only the main-image warnings for the main slot', () => {
    const w = ['Main image was not re-hosted: x', 'Step 2 image was not re-hosted: y', 'Other'];
    expect(removeSlotWarnings(w, 'main')).toEqual(['Step 2 image was not re-hosted: y', 'Other']);
  });

  it('strips step N warnings by 1-based number and exact extra warnings', () => {
    expect(
      removeSlotWarnings(
        ['Step 2 image was not re-hosted: y', '"main.heic" was not uploaded: z'],
        1,
        ['"main.heic" was not uploaded: z'],
      ),
    ).toEqual([]);
  });

  it('does not treat Step 1 as a prefix of Step 10', () => {
    expect(removeSlotWarnings(['Step 10 image was not re-hosted: y'], 0)).toEqual([
      'Step 10 image was not re-hosted: y',
    ]);
  });

  it('setSlotImage(null) on a step deletes the image and leaves no warning', () => {
    const next = setSlotImage(makeRecipe(), 0, null, { placeholderUrl: P });
    expect('image' in next.steps[0]).toBe(false);
    expect(next.metadata.warnings).toEqual(['Main image was not re-hosted: x', 'Other']);
  });

  it('setSlotImage sets a step image and strips unhosted warnings for that slot', () => {
    const next = setSlotImage(makeRecipe(), 1, '/images/new.jpg', {
      placeholderUrl: P,
      unhosted: [{ slot: 1, url: 'https://x/y.jpg', warning: 'Other' }],
    });
    expect(next.steps[1].image).toBe('/images/new.jpg');
    expect(next.metadata.warnings).not.toContain('Other');
  });

  it('setSlotImage(null) on main restores the placeholder', () => {
    const next = setSlotImage(makeRecipe(), 'main', null, { placeholderUrl: P });
    expect(next.main_image).toBe(P);
    expect(next.metadata.warnings).toEqual(['Step 1 image was not re-hosted: y', 'Other']);
  });

  it('setSlotImage does not mutate the input recipe', () => {
    const recipe = makeRecipe();
    const snapshot = structuredClone(recipe);
    setSlotImage(recipe, 0, null, { placeholderUrl: P });
    setSlotImage(recipe, 'main', 'https://a/b.jpg', { placeholderUrl: P });
    expect(recipe).toEqual(snapshot);
  });

  it('isSlotEmpty reports missing main and step images', () => {
    const recipe = makeRecipe();
    expect(isSlotEmpty(recipe, 'main', P)).toBe(false);
    expect(isSlotEmpty({ ...recipe, main_image: P }, 'main', P)).toBe(true);
    expect(isSlotEmpty(recipe, 0, P)).toBe(false);
    expect(isSlotEmpty(recipe, 1, P)).toBe(true);
  });
});
