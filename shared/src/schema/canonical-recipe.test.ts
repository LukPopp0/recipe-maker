import { describe, expect, it } from 'vitest';
import { CanonicalRecipeSchema, applyMainImageFallback } from './canonical-recipe.js';

function validRecipe() {
  return {
    title: 'Weeknight Pasta',
    tags: ['quick', 'vegetarian'],
    time: 30,
    ingredients: [
      { name: 'Pasta', amount_text: '200g' },
      { name: 'Garlic', amount_text: '2 cloves', amount_value: 2, unit: 'clove', image: 'garlic.png' },
    ],
    pantry_items: ['salt', 'pepper'],
    main_image: 'main.jpg',
    steps: [
      { step_header: 'Boil', step_description: 'Boil the pasta until al dente.' },
      { step_header: 'Serve', step_description: 'Toss with garlic and serve.', image: 'serve.jpg' },
    ],
    metadata: {
      source_type: 'manual' as const,
      language: 'en' as const,
      warnings: [],
    },
  };
}

describe('CanonicalRecipeSchema', () => {
  it('accepts a valid recipe', () => {
    const result = CanonicalRecipeSchema.safeParse(validRecipe());
    expect(result.success).toBe(true);
  });

  it('accepts a null time and empty ingredients array', () => {
    const recipe = validRecipe();
    recipe.time = null as unknown as number
    ;(recipe as { ingredients: unknown[] }).ingredients = [];
    const result = CanonicalRecipeSchema.safeParse(recipe);
    expect(result.success).toBe(true);
  });

  it('rejects a step_description over 600 characters', () => {
    const recipe = validRecipe();
    recipe.steps[0].step_description = 'a'.repeat(601);
    const result = CanonicalRecipeSchema.safeParse(recipe);
    expect(result.success).toBe(false);
  });

  it('accepts a step_description of exactly 600 characters', () => {
    const recipe = validRecipe();
    recipe.steps[0].step_description = 'a'.repeat(600);
    const result = CanonicalRecipeSchema.safeParse(recipe);
    expect(result.success).toBe(true);
  });

  it('rejects more than 6 steps', () => {
    const recipe = validRecipe();
    recipe.steps = Array.from({ length: 7 }, (_, i) => ({
      step_header: `Step ${i}`,
      step_description: `Description ${i}`,
    }));
    const result = CanonicalRecipeSchema.safeParse(recipe);
    expect(result.success).toBe(false);
  });

  it('rejects zero steps', () => {
    const recipe = validRecipe();
    recipe.steps = [];
    const result = CanonicalRecipeSchema.safeParse(recipe);
    expect(result.success).toBe(false);
  });

  it('rejects an empty main_image', () => {
    const recipe = validRecipe();
    recipe.main_image = '';
    const result = CanonicalRecipeSchema.safeParse(recipe);
    expect(result.success).toBe(false);
  });

  it('rejects a title longer than 140 characters', () => {
    const recipe = validRecipe();
    recipe.title = 'a'.repeat(141);
    const result = CanonicalRecipeSchema.safeParse(recipe);
    expect(result.success).toBe(false);
  });

  it('rejects an empty title', () => {
    const recipe = validRecipe();
    recipe.title = '';
    const result = CanonicalRecipeSchema.safeParse(recipe);
    expect(result.success).toBe(false);
  });

  it('rejects more than 5 tags', () => {
    const recipe = validRecipe();
    recipe.tags = ['a', 'b', 'c', 'd', 'e', 'f'];
    const result = CanonicalRecipeSchema.safeParse(recipe);
    expect(result.success).toBe(false);
  });

  it('rejects a tag longer than 40 characters', () => {
    const recipe = validRecipe();
    recipe.tags = ['a'.repeat(41)];
    const result = CanonicalRecipeSchema.safeParse(recipe);
    expect(result.success).toBe(false);
  });

  it('rejects time above 1440 minutes', () => {
    const recipe = validRecipe();
    recipe.time = 1441;
    const result = CanonicalRecipeSchema.safeParse(recipe);
    expect(result.success).toBe(false);
  });

  it('rejects a non-integer time', () => {
    const recipe = validRecipe();
    recipe.time = 30.5;
    const result = CanonicalRecipeSchema.safeParse(recipe);
    expect(result.success).toBe(false);
  });

  it('rejects an ingredient with a blank name', () => {
    const recipe = validRecipe();
    recipe.ingredients[0].name = '   ';
    const result = CanonicalRecipeSchema.safeParse(recipe);
    expect(result.success).toBe(false);
  });

  it('rejects a step with a blank step_header', () => {
    const recipe = validRecipe();
    recipe.steps[0].step_header = '';
    const result = CanonicalRecipeSchema.safeParse(recipe);
    expect(result.success).toBe(false);
  });
});

describe('applyMainImageFallback', () => {
  const fallbackUrl = '/assets/default-recipe.png';

  it('returns the candidate when it is present and non-blank', () => {
    expect(applyMainImageFallback('main.jpg', fallbackUrl)).toBe('main.jpg');
  });

  it('returns the fallback when the candidate is undefined', () => {
    expect(applyMainImageFallback(undefined, fallbackUrl)).toBe(fallbackUrl);
  });

  it('returns the fallback when the candidate is an empty string', () => {
    expect(applyMainImageFallback('', fallbackUrl)).toBe(fallbackUrl);
  });

  it('returns the fallback when the candidate is blank/whitespace', () => {
    expect(applyMainImageFallback('   ', fallbackUrl)).toBe(fallbackUrl);
  });
});
