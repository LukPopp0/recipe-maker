import { describe, expect, it } from 'vitest';
import { emphasizeIngredients } from './step-emphasis.ts';

describe('emphasizeIngredients', () => {
  it('bolds a case-insensitive whole-word ingredient mention', () => {
    expect(emphasizeIngredients('Cut Potatoes into rounds.', ['potatoes'])).toEqual([
      { text: 'Cut ', bold: false },
      { text: 'Potatoes', bold: true },
      { text: ' into rounds.', bold: false },
    ]);
  });

  it('matches simple s/es plural variants of a singular name', () => {
    const segments = emphasizeIngredients('Add the potatoes and 2 tomatoes.', ['potato', 'tomato']);
    expect(segments.filter((s) => s.bold).map((s) => s.text)).toEqual(['potatoes', 'tomatoes']);
  });

  it('does not bold partial-word matches', () => {
    const segments = emphasizeIngredients('Grease the pan generously.', ['pea']);
    expect(segments).toEqual([{ text: 'Grease the pan generously.', bold: false }]);
  });

  it('prefers the longest matching name on overlap', () => {
    const segments = emphasizeIngredients('Drizzle olive oil on top.', ['oil', 'olive oil']);
    expect(segments.filter((s) => s.bold).map((s) => s.text)).toEqual(['olive oil']);
  });

  it('escapes regex metacharacters in names instead of crashing', () => {
    const segments = emphasizeIngredients('Use chili (fresh) now.', ['chili (fresh']);
    expect(segments.map((s) => s.text).join('')).toBe('Use chili (fresh) now.');
  });

  it('returns one unbolded segment when there are no names', () => {
    expect(emphasizeIngredients('Just stir.', [])).toEqual([{ text: 'Just stir.', bold: false }]);
  });

  it('returns an empty array for an empty description', () => {
    expect(emphasizeIngredients('', ['potato'])).toEqual([]);
  });

  it('round-trips: concatenated segments equal the input', () => {
    const description = 'Add potatoes, then more potatoes, then salt the potatoes.';
    const segments = emphasizeIngredients(description, ['potatoes', 'salt']);
    expect(segments.map((s) => s.text).join('')).toBe(description);
  });
});
