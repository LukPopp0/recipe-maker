import { describe, it, expect } from 'vitest';
import { CanonicalRecipeSchema } from 'shared';
import { applyPostProcessing, type RawRecipeCandidate } from './index.js';

const DEFAULT_IMAGE = 'https://example.com/default.jpg';

describe('applyPostProcessing', () => {
  it('turns an unsanitized 9-step, unrouted-pantry, over-budget-tags candidate into a schema-valid recipe', () => {
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

    const result = applyPostProcessing(candidate, { defaultMainImageUrl: DEFAULT_IMAGE });

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

  it('is deterministic for identical input', () => {
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

    const a = applyPostProcessing(candidate, { defaultMainImageUrl: DEFAULT_IMAGE });
    const b = applyPostProcessing(candidate, { defaultMainImageUrl: DEFAULT_IMAGE });
    expect(a).toEqual(b);
  });
});
