import { describe, expect, it } from 'vitest';
import { PANTRY_ALLOWLIST, PANTRY_VARIANTS, isPantryItem, pantryCanonicalName } from './pantry-allowlist.js';

describe('PANTRY_ALLOWLIST', () => {
  it('contains the expected entries', () => {
    expect(PANTRY_ALLOWLIST).toEqual([
      'salt',
      'pepper',
      'sugar',
      'butter',
      'oil (olive and vegetable)',
      'milk',
      'flour',
      'water',
    ]);
  });

  it('has exactly 8 entries', () => {
    expect(PANTRY_ALLOWLIST).toHaveLength(8);
  });
});

describe('isPantryItem', () => {
  it('matches exact entries case-insensitively', () => {
    expect(isPantryItem('salt')).toBe(true);
    expect(isPantryItem('Salt')).toBe(true);
    expect(isPantryItem('SALT')).toBe(true);
    expect(isPantryItem('pepper')).toBe(true);
    expect(isPantryItem('Pepper')).toBe(true);
    expect(isPantryItem('sugar')).toBe(true);
    expect(isPantryItem('SUGAR')).toBe(true);
    expect(isPantryItem('butter')).toBe(true);
    expect(isPantryItem('Butter')).toBe(true);
    expect(isPantryItem('milk')).toBe(true);
    expect(isPantryItem('MILK')).toBe(true);
    expect(isPantryItem('flour')).toBe(true);
    expect(isPantryItem('Flour')).toBe(true);
    expect(isPantryItem('water')).toBe(true);
    expect(isPantryItem('Water')).toBe(true);
  });

  it('does not match "coconut water" (exact match only)', () => {
    expect(isPantryItem('coconut water')).toBe(false);
    expect(isPantryItem('Coconut Water')).toBe(false);
  });

  it('matches "olive oil" against the oil entry', () => {
    expect(isPantryItem('olive oil')).toBe(true);
    expect(isPantryItem('Olive Oil')).toBe(true);
    expect(isPantryItem('OLIVE OIL')).toBe(true);
  });

  it('matches "vegetable oil" against the oil entry', () => {
    expect(isPantryItem('vegetable oil')).toBe(true);
    expect(isPantryItem('Vegetable Oil')).toBe(true);
    expect(isPantryItem('VEGETABLE OIL')).toBe(true);
  });

  it('does not match "sesame oil" (not in the oil allowlist)', () => {
    expect(isPantryItem('sesame oil')).toBe(false);
    expect(isPantryItem('Sesame Oil')).toBe(false);
  });

  it('does not match oils other than olive and vegetable', () => {
    expect(isPantryItem('coconut oil')).toBe(false);
    expect(isPantryItem('peanut oil')).toBe(false);
    expect(isPantryItem('sunflower oil')).toBe(false);
  });

  it('does not match items not on the allowlist', () => {
    expect(isPantryItem('garlic')).toBe(false);
    expect(isPantryItem('onion')).toBe(false);
    expect(isPantryItem('basil')).toBe(false);
  });

  it('does not match partial strings', () => {
    expect(isPantryItem('salty')).toBe(false);
    expect(isPantryItem('peppercorn')).toBe(false);
    expect(isPantryItem('buttery')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isPantryItem('')).toBe(false);
  });
});

describe('pantryCanonicalName', () => {
  it('maps type variants to their pantry item (kosher salt is still salt)', () => {
    expect(pantryCanonicalName('Kosher Salt')).toBe('salt');
    expect(pantryCanonicalName('sea salt')).toBe('salt');
    expect(pantryCanonicalName('freshly ground black pepper')).toBe('pepper');
    expect(pantryCanonicalName('Unsalted Butter')).toBe('butter');
    expect(pantryCanonicalName('all-purpose flour')).toBe('flour');
    expect(pantryCanonicalName('granulated sugar')).toBe('sugar');
    expect(pantryCanonicalName('whole milk')).toBe('milk');
    expect(pantryCanonicalName('warm water')).toBe('water');
    expect(pantryCanonicalName('Extra-Virgin Olive Oil')).toBe('olive oil');
    expect(pantryCanonicalName('vegetable oil')).toBe('vegetable oil');
  });

  it('returns the item itself for exact entries, ignoring case and extra spaces', () => {
    expect(pantryCanonicalName('  SALT ')).toBe('salt');
    expect(pantryCanonicalName('water')).toBe('water');
  });

  it('keeps different products out of the pantry', () => {
    for (const name of [
      'brown sugar',
      'powdered sugar',
      'red pepper flakes',
      'bell pepper',
      'cayenne pepper',
      'buttermilk',
      'peanut butter',
      'coconut milk',
      'almond flour',
      'sesame oil',
      'garlic salt',
      'oil',
      '',
    ]) {
      expect(pantryCanonicalName(name)).toBeNull();
    }
  });

  it('isPantryItem accepts the same variants', () => {
    expect(isPantryItem('kosher salt')).toBe(true);
    expect(isPantryItem('brown sugar')).toBe(false);
  });
});

describe('PANTRY_VARIANTS', () => {
  it('has one entry per pantry item, each listing the item itself first', () => {
    expect(Object.keys(PANTRY_VARIANTS)).toEqual([
      'salt',
      'pepper',
      'sugar',
      'butter',
      'olive oil',
      'vegetable oil',
      'milk',
      'flour',
      'water',
    ]);
    for (const [item, variants] of Object.entries(PANTRY_VARIANTS)) {
      expect(variants[0]).toBe(item);
    }
  });
});
