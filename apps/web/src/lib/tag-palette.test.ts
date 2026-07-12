import { describe, expect, it } from 'vitest';
import { TAG_VOCABULARY } from 'shared';
import { tagColorClass, tagPaletteIndex, TAG_PALETTE_SIZE } from './tag-palette.ts';

describe('tagPaletteIndex', () => {
  it('is deterministic for the same tag', () => {
    expect(tagPaletteIndex('High Protein')).toBe(tagPaletteIndex('High Protein'));
  });

  it('always returns an index within the palette', () => {
    for (const tag of ['Spicy', 'vegan', 'quick', 'Comfort Food', 'x']) {
      const index = tagPaletteIndex(tag);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(TAG_PALETTE_SIZE);
      expect(Number.isInteger(index)).toBe(true);
    }
  });
});

describe('tagColorClass', () => {
  it('maps preset tags to their slug class', () => {
    expect(tagColorClass('Spicy')).toBe('tag-color-spicy');
    expect(tagColorClass('High Protein')).toBe('tag-color-high-protein');
  });

  it('matches preset tags case-insensitively', () => {
    expect(tagColorClass('spicy')).toBe('tag-color-spicy');
    expect(tagColorClass('FAMILY FRIENDLY')).toBe('tag-color-family-friendly');
  });

  it('gives every preset tag its own class', () => {
    const classes = TAG_VOCABULARY.map(tagColorClass);
    expect(new Set(classes).size).toBe(TAG_VOCABULARY.length);
  });

  it('falls back to the hash palette for custom tags', () => {
    expect(tagColorClass('Grandma Style')).toBe(
      `tag-color-fallback-${tagPaletteIndex('Grandma Style')}`,
    );
  });
});
