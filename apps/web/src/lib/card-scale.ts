// Preview scaling for the fixed letter-size card pages (specs/10): the pages
// themselves never reflow, only this scale changes. Side-by-side preview is
// used while each scaled page stays at least ~45% size (readable); below
// that the pages stack vertically.
export type CardPageDimensions = { width: number; height: number };

export const CARD_PORTRAIT: CardPageDimensions = { width: 816, height: 1056 }; // 8.5in x 11in at 96dpi
export const CARD_LANDSCAPE: CardPageDimensions = { width: 1056, height: 816 }; // 11in x 8.5in at 96dpi

// Kept for existing callers/tests; portrait is the original geometry.
export const CARD_PAGE_WIDTH_PX = CARD_PORTRAIT.width;
export const CARD_PAGE_HEIGHT_PX = CARD_PORTRAIT.height;
export const CARD_PAGE_GAP_PX = 24;

const MIN_SIDE_BY_SIDE_SCALE = 0.45;

export type CardScaleLayout = { scale: number; sideBySide: boolean };

export function computeCardScale(
  containerWidth: number,
  pageWidth: number = CARD_PORTRAIT.width,
): CardScaleLayout {
  if (containerWidth <= 0) return { scale: 1, sideBySide: false };

  const sideBySideScale = (containerWidth - CARD_PAGE_GAP_PX) / (2 * pageWidth);
  if (sideBySideScale >= MIN_SIDE_BY_SIDE_SCALE) {
    return { scale: Math.min(1, sideBySideScale), sideBySide: true };
  }
  return { scale: Math.min(1, containerWidth / pageWidth), sideBySide: false };
}
