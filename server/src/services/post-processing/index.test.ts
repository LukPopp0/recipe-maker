import { describe, it, expect } from 'vitest';
import { CanonicalRecipeSchema } from 'shared';
import { applyPostProcessing, type RawRecipeCandidate } from './index.js';
import type { RawIngredient } from './pantry-classifier.js';
import type { IngredientImageMatcher, IngredientImageMatchResult } from '../ingredient-matching/ingredient-image-matcher.js';

const DEFAULT_IMAGE = 'https://example.com/default.jpg';

// Fake matcher: records the ingredients it was called with and returns a
// caller-supplied result, mirroring the real matcher's never-rejects contract.
function makeFakeMatcher(
  result: IngredientImageMatchResult,
): { matcher: IngredientImageMatcher; calls: RawIngredient[][] } {
  const calls: RawIngredient[][] = [];
  return {
    calls,
    matcher: {
      async matchIngredientImages(ingredients: RawIngredient[]) {
        calls.push(ingredients);
        return result;
      },
    },
  };
}

describe('applyPostProcessing', () => {
  it('turns an unsanitized 9-step, unrouted-pantry, over-budget-tags candidate into a schema-valid recipe', async () => {
    const candidate: RawRecipeCandidate = {
      title: '  Roast Chicken  ',
      tags: ['High Protein', 'family friendly', 'Comfort Meal', 'custom-x', 'custom-y', 'Quick', 'Balanced'],
      time: 90,
      ingredients: [
        { name: 'Chicken', amount_text: '1 whole' },
        { name: 'Salt', amount_text: '1 tsp' },
        { name: 'Pepper', amount_text: '1 tsp' },
        { name: 'Olive oil', amount_text: '2 tbsp' },
        { name: 'Rosemary', amount_text: '2 sprigs' },
      ],
      pantry_items: [],
      main_image: '',
      steps: Array.from({ length: 9 }, (_, i) => ({
        step_header: `Step ${i + 1}`,
        step_description: `Do action ${i + 1}.`,
      })),
      metadata: {
        source_type: 'url',
        source_url: 'https://example.com/roast-chicken',
        language: 'en',
        warnings: [],
      },
    };

    const result = await applyPostProcessing(candidate, { defaultMainImageUrl: DEFAULT_IMAGE });

    // fully schema-valid after one call
    expect(CanonicalRecipeSchema.safeParse(result).success).toBe(true);

    // steps compacted to <= 6
    expect(result.steps.length).toBeLessThanOrEqual(6);
    expect(result.steps.length).toBe(6);

    // pantry routed out of ingredients
    expect(result.pantry_items).toEqual(expect.arrayContaining(['Salt', 'Pepper', 'Olive oil']));
    expect(result.ingredients.map((i) => i.name)).toEqual(['Chicken', 'Rosemary']);

    // tags capped at 5, vocab first, casing normalized
    expect(result.tags).toHaveLength(5);
    expect(result.tags.slice(0, 4)).toEqual(['High Protein', 'Family Friendly', 'Comfort Meal', 'Quick']);

    // main image fallback applied
    expect(result.main_image).toBe(DEFAULT_IMAGE);

    // title trimmed
    expect(result.title).toBe('Roast Chicken');
  });

  it('is deterministic for identical input', async () => {
    const candidate: RawRecipeCandidate = {
      title: 'Soup',
      tags: ['Quick'],
      time: null,
      ingredients: [{ name: 'Onion', amount_text: '1' }],
      pantry_items: [],
      main_image: 'https://example.com/soup.jpg',
      steps: Array.from({ length: 8 }, (_, i) => ({
        step_header: `H${i}`,
        step_description: `desc ${i}`,
      })),
      metadata: { source_type: 'url', language: 'en', warnings: [] },
    };

    const a = await applyPostProcessing(candidate, { defaultMainImageUrl: DEFAULT_IMAGE });
    const b = await applyPostProcessing(candidate, { defaultMainImageUrl: DEFAULT_IMAGE });
    expect(a).toEqual(b);
  });

  it('leaves ingredients/warnings unchanged when no matcher is provided', async () => {
    const candidate: RawRecipeCandidate = {
      title: 'Soup',
      tags: ['Quick'],
      time: null,
      ingredients: [{ name: 'Onion', amount_text: '1' }],
      pantry_items: [],
      main_image: 'https://example.com/soup.jpg',
      steps: [{ step_header: 'H', step_description: 'desc' }],
      metadata: { source_type: 'url', language: 'en', warnings: [] },
    };

    const result = await applyPostProcessing(candidate, { defaultMainImageUrl: DEFAULT_IMAGE });
    expect(result.ingredients).toEqual([{ name: 'Onion', amount_text: '1' }]);
    expect(result.metadata.warnings).toEqual([]);
  });

  it('applies matched images and appends matcher warnings when a matcher is provided', async () => {
    const candidate: RawRecipeCandidate = {
      title: 'Soup',
      tags: ['Quick'],
      time: null,
      ingredients: [
        { name: 'Onion', amount_text: '1' },
        { name: 'Garlic', amount_text: '2 cloves' },
      ],
      pantry_items: [],
      main_image: 'https://example.com/soup.jpg',
      steps: [{ step_header: 'H', step_description: 'desc' }],
      metadata: { source_type: 'url', language: 'en', warnings: ['pre-existing warning'] },
    };

    const { matcher } = makeFakeMatcher({
      ingredients: [
        { name: 'Onion', amount_text: '1', image: 'onion.png' },
        { name: 'Garlic', amount_text: '2 cloves', image: 'garlic.png' },
      ],
      warnings: ['matcher warning'],
    });

    const result = await applyPostProcessing(candidate, {
      defaultMainImageUrl: DEFAULT_IMAGE,
      ingredientImageMatcher: matcher,
    });

    expect(result.ingredients.map((i) => i.image)).toEqual(['onion.png', 'garlic.png']);
    expect(result.metadata.warnings).toEqual(['pre-existing warning', 'matcher warning']);
  });

  it('only sends post-pantry-classification ingredients to the matcher', async () => {
    const candidate: RawRecipeCandidate = {
      title: 'Roast',
      tags: [],
      time: null,
      ingredients: [
        { name: 'Chicken', amount_text: '1' },
        { name: 'Salt', amount_text: '1 tsp' },
      ],
      pantry_items: [],
      main_image: 'https://example.com/roast.jpg',
      steps: [{ step_header: 'H', step_description: 'desc' }],
      metadata: { source_type: 'url', language: 'en', warnings: [] },
    };

    const { matcher, calls } = makeFakeMatcher({
      ingredients: [{ name: 'Chicken', amount_text: '1', image: 'chicken.png' }],
      warnings: [],
    });

    await applyPostProcessing(candidate, {
      defaultMainImageUrl: DEFAULT_IMAGE,
      ingredientImageMatcher: matcher,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].map((i) => i.name)).toEqual(['Chicken']);
  });

  it('does not call the matcher when there are no non-pantry ingredients', async () => {
    const candidate: RawRecipeCandidate = {
      title: 'Empty',
      tags: [],
      time: null,
      ingredients: [{ name: 'Salt', amount_text: '1 tsp' }],
      pantry_items: [],
      main_image: 'https://example.com/empty.jpg',
      steps: [{ step_header: 'H', step_description: 'desc' }],
      metadata: { source_type: 'url', language: 'en', warnings: [] },
    };

    const { matcher, calls } = makeFakeMatcher({ ingredients: [], warnings: [] });

    await applyPostProcessing(candidate, {
      defaultMainImageUrl: DEFAULT_IMAGE,
      ingredientImageMatcher: matcher,
    });

    expect(calls).toHaveLength(0);
  });
});
