import { describe, expect, it } from 'vitest';
import { computeCardScale, CARD_PAGE_WIDTH_PX, CARD_PAGE_GAP_PX, CARD_LANDSCAPE, CARD_PORTRAIT } from './card-scale.ts';

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

describe('orientation dimensions', () => {
  it('exports portrait and landscape letter dimensions', () => {
    expect(CARD_PORTRAIT).toEqual({ width: 816, height: 1056 });
    expect(CARD_LANDSCAPE).toEqual({ width: 1056, height: 816 });
  });

  it('computes side-by-side scale from the given page width', () => {
    // 2 landscape pages + gap: (2136 - 24) / (2 * 1056) = 1.0
    expect(computeCardScale(2136, CARD_LANDSCAPE.width)).toEqual({ scale: 1, sideBySide: true });
    // Same container with portrait width scales differently (default arg)
    expect(computeCardScale(2136).sideBySide).toBe(true);
  });

  it('stacks landscape pages when side-by-side would be unreadable', () => {
    const layout = computeCardScale(900, CARD_LANDSCAPE.width);
    expect(layout.sideBySide).toBe(false);
    expect(layout.scale).toBeCloseTo(900 / 1056);
  });
});
