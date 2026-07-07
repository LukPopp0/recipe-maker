// Deterministic tag pill color assignment (specs/10): hash of the tag name
// into a fixed 3-color palette, so the same tag gets the same color on
// every recipe. The palette itself lives in card.css (.card-tag-0/1/2).
export const TAG_PALETTE_SIZE = 3;

export function tagPaletteIndex(tag: string): number {
  let sum = 0;
  for (let i = 0; i < tag.length; i += 1) {
    sum = (sum + tag.charCodeAt(i)) % TAG_PALETTE_SIZE;
  }
  return sum;
}
