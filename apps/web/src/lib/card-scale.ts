// Preview scaling for the fixed letter-size card pages (specs/10): the pages
// themselves never reflow, only this scale changes. Side-by-side preview is
// used while each scaled page stays at least ~45% size (readable); below
// that the pages stack vertically.
export const CARD_PAGE_WIDTH_PX = 816; // 8.5in at 96dpi
export const CARD_PAGE_HEIGHT_PX = 1056; // 11in at 96dpi
export const CARD_PAGE_GAP_PX = 24;

const MIN_SIDE_BY_SIDE_SCALE = 0.45;

export type CardScaleLayout = { scale: number; sideBySide: boolean };

export function computeCardScale(containerWidth: number): CardScaleLayout {
  if (containerWidth <= 0) return { scale: 1, sideBySide: false };

  const sideBySideScale = (containerWidth - CARD_PAGE_GAP_PX) / (2 * CARD_PAGE_WIDTH_PX);
  if (sideBySideScale >= MIN_SIDE_BY_SIDE_SCALE) {
    return { scale: Math.min(1, sideBySideScale), sideBySide: true };
  }
  return { scale: Math.min(1, containerWidth / CARD_PAGE_WIDTH_PX), sideBySide: false };
}
