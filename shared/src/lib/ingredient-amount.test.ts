import { describe, it, expect } from 'vitest';
import { amountContainsUnit, formatIngredientAmount } from './ingredient-amount.js';

describe('amountContainsUnit', () => {
  it('detects the unit as a separate token', () => {
    expect(amountContainsUnit('5 oz', 'oz')).toBe(true);
    expect(amountContainsUnit('3 tbsp', 'tbsp')).toBe(true);
    expect(amountContainsUnit('2-3 tbsp', 'tbsp')).toBe(true);
  });

  it('detects the unit attached to a number', () => {
    expect(amountContainsUnit('200g', 'g')).toBe(true);
    expect(amountContainsUnit('60g/2¼oz', 'g')).toBe(true);
    expect(amountContainsUnit('60g/2¼oz', 'oz')).toBe(true);
  });

  it('matches unit synonyms (lb vs lbs, tablespoons vs tbsp)', () => {
    expect(amountContainsUnit('1 lb', 'lbs')).toBe(true);
    expect(amountContainsUnit('2 pounds', 'lbs')).toBe(true);
    expect(amountContainsUnit('2 tablespoons', 'tbsp')).toBe(true);
    expect(amountContainsUnit('1 teaspoon', 'tsp')).toBe(true);
    expect(amountContainsUnit('3 ounces', 'oz')).toBe(true);
    expect(amountContainsUnit('100 grams', 'g')).toBe(true);
    expect(amountContainsUnit('250 milliliters', 'ml')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(amountContainsUnit('5 OZ', 'oz')).toBe(true);
  });

  it('returns false when the unit is absent', () => {
    expect(amountContainsUnit('5', 'oz')).toBe(false);
    expect(amountContainsUnit('to taste', 'tbsp')).toBe(false);
    expect(amountContainsUnit('Juice of 1 lime', 'ml')).toBe(false);
  });

  it('does not treat substring overlaps as matches', () => {
    // 'g' must not match inside 'large'
    expect(amountContainsUnit('3 large eggs', 'g')).toBe(false);
  });

  it('returns false for an empty unit', () => {
    expect(amountContainsUnit('5 oz', '')).toBe(false);
  });
});

describe('formatIngredientAmount', () => {
  it('appends the unit when the amount does not contain it', () => {
    expect(formatIngredientAmount('2', 'pc')).toBe('2 pc');
    expect(formatIngredientAmount('5', 'oz')).toBe('5 oz');
  });

  it('does not double the unit when the amount already contains it', () => {
    expect(formatIngredientAmount('5 oz', 'oz')).toBe('5 oz');
    expect(formatIngredientAmount('1 lb', 'lbs')).toBe('1 lb');
    expect(formatIngredientAmount('200g', 'g')).toBe('200g');
    expect(formatIngredientAmount('2 tbsp', 'tbsp')).toBe('2 tbsp');
  });

  it('returns the amount alone when unit is missing or empty', () => {
    expect(formatIngredientAmount('to taste', undefined)).toBe('to taste');
    expect(formatIngredientAmount('4', '')).toBe('4');
  });

  it('trims surrounding whitespace', () => {
    expect(formatIngredientAmount(' 5 ', 'oz')).toBe('5 oz');
  });
});
