// Pure helpers for the review panel's image slots ('main' or a step index).
import type { CanonicalRecipe, ImageSlot, UnhostedImage } from 'shared';

export const DEFAULT_PLACEHOLDER_IMAGE_URL = '/images/placeholder-recipe.png';

export function isMissingMainImage(mainImage: string, placeholderUrl: string): boolean {
  return mainImage.trim() === '' || mainImage === placeholderUrl;
}

// Server warnings for an unhosted image start with these prefixes (see
// image-rehoster.ts); step numbers are 1-based.
function slotWarningPrefix(slot: ImageSlot): string {
  return slot === 'main' ? 'Main image was not re-hosted' : `Step ${slot + 1} image was not re-hosted`;
}

export function removeSlotWarnings(warnings: string[], slot: ImageSlot, extra: string[] = []): string[] {
  const prefix = slotWarningPrefix(slot);
  return warnings.filter(
    (w) => !(w === prefix || w.startsWith(`${prefix}:`) || w.startsWith(`${prefix} `)) && !extra.includes(w),
  );
}

export function setSlotImage(
  recipe: CanonicalRecipe,
  slot: ImageSlot,
  url: string | null,
  opts: { placeholderUrl: string; unhosted?: UnhostedImage[] },
): CanonicalRecipe {
  const extra = (opts.unhosted ?? []).filter((u) => u.slot === slot).map((u) => u.warning);
  const metadata = { ...recipe.metadata, warnings: removeSlotWarnings(recipe.metadata.warnings, slot, extra) };

  if (slot === 'main') {
    return { ...recipe, main_image: url ?? opts.placeholderUrl, metadata };
  }
  const steps = recipe.steps.map((step, i) => {
    if (i !== slot) return step;
    if (url === null) {
      const { image: _image, ...rest } = step;
      void _image;
      return rest;
    }
    return { ...step, image: url };
  });
  return { ...recipe, steps, metadata };
}

export function isSlotEmpty(recipe: CanonicalRecipe, slot: ImageSlot, placeholderUrl: string): boolean {
  if (slot === 'main') return isMissingMainImage(recipe.main_image, placeholderUrl);
  const image = recipe.steps[slot]?.image;
  return image === undefined || image.trim() === '';
}
