import { describe, expect, it } from 'vitest';
import { buildIngredientMatchingPrompt } from './ingredient-matching.js';

const ingredients = [
  { name: 'Red onions, finely chopped', amount_text: '2', unit: 'tablespoons' },
  { name: 'Crushed tomatoes', amount_text: '1 can' },
];

const catalogFilenames = ['ONION.png', 'TOMATO_CRUSHED.png', 'GARLIC.png'];

describe('buildIngredientMatchingPrompt', () => {
  const prompt = buildIngredientMatchingPrompt({ ingredients, catalogFilenames });

  it('includes every catalog filename', () => {
    for (const filename of catalogFilenames) {
      expect(prompt).toContain(filename);
    }
  });

  it('includes each input ingredient name', () => {
    for (const ingredient of ingredients) {
      expect(prompt).toContain(ingredient.name);
    }
  });

  it('instructs to use the INGREDIENT_NOT_FOUND fallback', () => {
    expect(prompt).toContain('INGREDIENT_NOT_FOUND.png');
  });

  it('instructs never to invent filenames', () => {
    expect(prompt).toMatch(/never invent filenames/i);
  });

  it('instructs same length and order as input', () => {
    expect(prompt).toMatch(/same length/i);
    expect(prompt).toMatch(/same order|preserve.*order|order exactly/i);
  });

  it('does not request amounts or units in the output', () => {
    expect(prompt).toMatch(/do not output amounts or units/i);
    expect(prompt).not.toContain('amount_text');
  });

  it('ends with a closing instruction that asks for the JSON array', () => {
    expect(prompt.trim().endsWith('Return only the JSON array, no surrounding text or markdown fences.')).toBe(true);
    expect(prompt).not.toContain('JSON object');
  });

  it('numbers each input ingredient and asks for the number to be copied back', () => {
    expect(prompt).toContain('{"i":0,"name":"Red onions, finely chopped"}');
    expect(prompt).toContain('{"i":1,"name":"Crushed tomatoes"}');
    expect(prompt).toMatch(/"i": number \(copied unchanged from the input ingredient\)/);
  });
});
