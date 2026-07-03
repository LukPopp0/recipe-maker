import { describe, it, expect } from 'vitest';
import type { CanonicalRecipe } from 'shared';
import { finalSanitize } from './sanitize.js';
import { AppError } from '../../lib/errors.js';

const DEFAULT_IMAGE = 'https://example.com/default.jpg';

function validRecipe(overrides: Partial<CanonicalRecipe> = {}): CanonicalRecipe {
  return {
    title: 'Test Recipe',
    tags: ['Quick'],
    time: 30,
    ingredients: [{ name: 'Chicken', amount_text: '200 g' }],
    pantry_items: ['Salt'],
    main_image: 'https://example.com/img.jpg',
    steps: [{ step_header: 'Cook', step_description: 'Cook it.' }],
    metadata: {
      source_type: 'url',
      source_url: 'https://example.com/recipe',
      language: 'en',
      warnings: [],
    },
    ...overrides,
  };
}

describe('finalSanitize', () => {
  it('passes a fully valid recipe through unchanged (structurally)', () => {
    const recipe = validRecipe();
    const result = finalSanitize(recipe, DEFAULT_IMAGE);
    expect(result).toEqual(recipe);
  });

  it('clamps an over-600-char step description to 600 chars and adds a warning', () => {
    const recipe = validRecipe({
      steps: [{ step_header: 'Cook', step_description: 'a'.repeat(700) }],
    });
    const result = finalSanitize(recipe, DEFAULT_IMAGE);
    expect(result.steps[0].step_description).toHaveLength(600);
    expect(result.metadata.warnings).toEqual([
      'Step 1 description was truncated to fit the 600-character limit; content may have been lost.',
    ]);
  });

  it('does not add a truncation warning when a step description is already within the limit', () => {
    const recipe = validRecipe({
      steps: [{ step_header: 'Cook', step_description: 'a'.repeat(600) }],
    });
    const result = finalSanitize(recipe, DEFAULT_IMAGE);
    expect(result.steps[0].step_description).toHaveLength(600);
    expect(result.metadata.warnings).toEqual([]);
  });

  it('applies the default main image when main_image is empty', () => {
    const recipe = validRecipe({ main_image: '' });
    const result = finalSanitize(recipe, DEFAULT_IMAGE);
    expect(result.main_image).toBe(DEFAULT_IMAGE);
  });

  it('collapses whitespace and trims strings', () => {
    const recipe = validRecipe({
      title: '  Messy    Title  ',
      steps: [{ step_header: '  Cook  ', step_description: 'Do   this\nthen  that.' }],
    });
    const result = finalSanitize(recipe, DEFAULT_IMAGE);
    expect(result.title).toBe('Messy Title');
    expect(result.steps[0].step_header).toBe('Cook');
    expect(result.steps[0].step_description).toBe('Do this then that.');
  });

  it('dedupes tags and pantry_items case-insensitively as a final guarantee', () => {
    const recipe = validRecipe({
      tags: ['Quick', 'quick'],
      pantry_items: ['Salt', 'salt'],
    });
    const result = finalSanitize(recipe, DEFAULT_IMAGE);
    expect(result.tags).toEqual(['Quick']);
    expect(result.pantry_items).toEqual(['Salt']);
  });

  it('throws SCHEMA_VALIDATION_FAILED with Zod issue details when still invalid', () => {
    const recipe = validRecipe({ steps: [] });
    try {
      finalSanitize(recipe, DEFAULT_IMAGE);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      const appErr = err as AppError;
      expect(appErr.code).toBe('SCHEMA_VALIDATION_FAILED');
      expect(appErr.details).toBeDefined();
      const details = appErr.details as { issues: unknown[] };
      expect(Array.isArray(details.issues)).toBe(true);
      expect(details.issues.length).toBeGreaterThan(0);
    }
  });
});
