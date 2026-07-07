import { describe, expect, it } from 'vitest';
import { tagPaletteIndex, TAG_PALETTE_SIZE } from './tag-palette.ts';

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
