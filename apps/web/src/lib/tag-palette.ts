// Deterministic tag pill color assignment (specs/10). Preset tags (matched
// case-insensitively against TAG_VOCABULARY) get a fixed per-tag class;
// custom tags hash into a small fallback palette so the same tag gets the
// same color on every recipe. Colors live in tag-colors.css.
import { TAG_VOCABULARY } from 'shared';

export const TAG_PALETTE_SIZE = 3;

export function tagPaletteIndex(tag: string): number {
  let sum = 0;
  for (let i = 0; i < tag.length; i += 1) {
    sum = (sum + tag.charCodeAt(i)) % TAG_PALETTE_SIZE;
  }
  return sum;
}

const PRESET_SLUGS = new Map(
  TAG_VOCABULARY.map((tag) => [tag.toLowerCase(), tag.toLowerCase().replace(/\s+/g, '-')]),
);

export function tagColorClass(tag: string): string {
  const slug = PRESET_SLUGS.get(tag.toLowerCase());
  return slug ? `tag-color-${slug}` : `tag-color-fallback-${tagPaletteIndex(tag)}`;
}
