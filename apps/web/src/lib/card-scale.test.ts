import { describe, expect, it } from 'vitest';
import { computeCardScale, CARD_PAGE_WIDTH_PX, CARD_PAGE_GAP_PX } from './card-scale.ts';

describe('computeCardScale', () => {
  it('caps at 1 and goes side by side on very wide containers', () => {
    expect(computeCardScale(4000)).toEqual({ scale: 1, sideBySide: true });
  });

  it('shrinks side-by-side pages to fill a desktop-width container', () => {
    const width = 1200;
    const { scale, sideBySide } = computeCardScale(width);
    expect(sideBySide).toBe(true);
    expect(2 * CARD_PAGE_WIDTH_PX * scale + CARD_PAGE_GAP_PX).toBeLessThanOrEqual(width);
    expect(scale).toBeGreaterThan(0.45);
  });

  it('stacks pages when side by side would be unreadably small', () => {
    const { scale, sideBySide } = computeCardScale(600);
    expect(sideBySide).toBe(false);
    expect(CARD_PAGE_WIDTH_PX * scale).toBeLessThanOrEqual(600);
  });

  it('handles zero/negative widths without NaN', () => {
    expect(computeCardScale(0)).toEqual({ scale: 1, sideBySide: false });
    expect(computeCardScale(-5)).toEqual({ scale: 1, sideBySide: false });
  });
});
