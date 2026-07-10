import { describe, it, expect } from 'vitest';
import { dedupeIngredients } from './dedupe-ingredients.js';
import type { RawIngredient } from './pantry-classifier.js';

function ing(name: string, amount_text = '1'): RawIngredient {
  return { name, amount_text };
}

describe('dedupeIngredients', () => {
  it('merges names that differ only by preparation words, keeping the first', () => {
    const input: RawIngredient[] = [ing('sliced green onions', '2'), ing('green onions', '3')];

    const result = dedupeIngredients(input);

    expect(result.ingredients.map((i) => i.name)).toEqual(['sliced green onions']);
    // First occurrence's amount is kept untouched.
    expect(result.ingredients[0].amount_text).toBe('2');
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('green onions');
    expect(result.warnings[0]).toContain('(3)');
    expect(result.warnings[0]).toContain('sliced green onions');
  });

  it('does not merge ingredients that differ in identity ("red onion" vs "onion")', () => {
    const input: RawIngredient[] = [ing('red onion'), ing('onion')];

    const result = dedupeIngredients(input);

    expect(result.ingredients.map((i) => i.name)).toEqual(['red onion', 'onion']);
    expect(result.warnings).toEqual([]);
  });

  it('does not merge different green vegetables ("green onion" vs "onion")', () => {
    const input: RawIngredient[] = [ing('green onion'), ing('onion')];

    const result = dedupeIngredients(input);

    expect(result.ingredients.map((i) => i.name)).toEqual(['green onion', 'onion']);
    expect(result.warnings).toEqual([]);
  });

  it('merges case-insensitive exact duplicates', () => {
    const input: RawIngredient[] = [ing('Garlic'), ing('garlic')];

    const result = dedupeIngredients(input);

    expect(result.ingredients.map((i) => i.name)).toEqual(['Garlic']);
    expect(result.warnings).toHaveLength(1);
  });

  it('strips multi-word preparation phrases and trailing comma descriptors', () => {
    const input: RawIngredient[] = [ing('freshly ground black pepper'), ing('black pepper, ground')];

    const result = dedupeIngredients(input);

    expect(result.ingredients.map((i) => i.name)).toEqual(['freshly ground black pepper']);
    expect(result.warnings).toHaveLength(1);
  });

  it('leaves a list with no duplicates unchanged and emits no warnings', () => {
    const input: RawIngredient[] = [ing('carrot'), ing('potato'), ing('chicken breast')];

    const result = dedupeIngredients(input);

    expect(result.ingredients.map((i) => i.name)).toEqual(['carrot', 'potato', 'chicken breast']);
    expect(result.warnings).toEqual([]);
  });

  it('omits the amount from the warning when the dropped duplicate has none', () => {
    const input: RawIngredient[] = [ing('diced tomatoes', '1 can'), ing('tomatoes', '')];

    const result = dedupeIngredients(input);

    expect(result.ingredients).toHaveLength(1);
    expect(result.warnings[0]).not.toContain('()');
  });
});
