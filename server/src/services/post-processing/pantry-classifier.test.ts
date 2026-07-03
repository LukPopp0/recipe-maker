import { describe, it, expect } from 'vitest';
import { classifyPantryItems, type RawIngredient } from './pantry-classifier.js';

function ing(name: string): RawIngredient {
  return { name, amount_text: '1' };
}

describe('classifyPantryItems', () => {
  it('routes pantry items into pantry_items and removes them from ingredients', () => {
    const input: RawIngredient[] = [ing('Salt'), ing('Chicken breast'), ing('Pepper')];

    const result = classifyPantryItems(input);

    expect(result.pantry_items).toEqual(['Salt', 'Pepper']);
    expect(result.ingredients.map((i) => i.name)).toEqual(['Chicken breast']);
  });

  it('keeps non-allowlisted oils in ingredients', () => {
    const input: RawIngredient[] = [ing('Sesame oil'), ing('Olive oil')];

    const result = classifyPantryItems(input);

    // olive oil is a pantry staple, sesame oil is not
    expect(result.pantry_items).toEqual(['Olive oil']);
    expect(result.ingredients.map((i) => i.name)).toEqual(['Sesame oil']);
  });

  it('deduplicates when the same pantry item appears twice (case-insensitive)', () => {
    const input: RawIngredient[] = [ing('Salt'), ing('salt'), ing('SALT')];

    const result = classifyPantryItems(input);

    // dedup by lowercase key, first display form wins
    expect(result.pantry_items).toEqual(['Salt']);
    expect(result.ingredients).toEqual([]);
  });

  it('preserves display form while matching case-insensitively', () => {
    const input: RawIngredient[] = [ing('BUTTER')];

    const result = classifyPantryItems(input);

    expect(result.pantry_items).toEqual(['BUTTER']);
  });

  it('preserves ingredient order and passes through non-pantry ingredients untouched', () => {
    const flour: RawIngredient = { name: 'Flour', amount_text: '2 cups' };
    const eggs: RawIngredient = { name: 'Eggs', amount_text: '3', amount_value: 3 };
    const result = classifyPantryItems([eggs, flour]);

    expect(result.ingredients).toEqual([eggs]);
    expect(result.pantry_items).toEqual(['Flour']);
  });
});
