// Extracts per-instruction image URLs from a schema.org Recipe JSON-LD node's
// recipeInstructions. HowToStep.image is the highest-confidence step-image
// source available: the site itself declares which photo belongs to which
// step, so no model guessing is involved. Mirrors jsonld-extractor.ts's
// defensive stance - any malformed shape degrades to "no image", never throws.

interface JsonLdStepImages {
  // Number of instruction entries found (HowToSections flattened). Used by the
  // pipeline to decide whether an index-based overlay onto the extracted
  // steps is safe.
  instructionCount: number
  // One entry per instruction, in source order; null when that instruction
  // carries no usable image.
  images: (string | null)[]
}

// Resolves a possibly-relative URL against the effective page URL; null when
// the value cannot form a usable absolute URL.
function resolveUrl(value: string, baseUrl: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed, baseUrl).toString();
  } catch {
    return null;
  }
}

// Pulls a single image URL out of a HowToStep "image" value, handling the
// shapes sites actually publish: a bare string, an ImageObject ({url: ...}),
// or an array of either (first usable entry wins).
function extractImageUrl(image: unknown, baseUrl: string): string | null {
  if (typeof image === 'string') return resolveUrl(image, baseUrl);

  if (Array.isArray(image)) {
    for (const entry of image) {
      const found = extractImageUrl(entry, baseUrl);
      if (found) return found;
    }
    return null;
  }

  if (typeof image === 'object' && image !== null) {
    const url = (image as Record<string, unknown>).url;
    if (typeof url === 'string') return resolveUrl(url, baseUrl);
  }

  return null;
}

function isHowToSection(value: Record<string, unknown>): boolean {
  const type = value['@type'];
  if (typeof type === 'string') return type === 'HowToSection';
  if (Array.isArray(type)) return type.includes('HowToSection');
  return false;
}

// Flattens recipeInstructions into an ordered list of instruction entries,
// expanding HowToSection.itemListElement in place. Plain strings count as
// image-less instructions so instructionCount stays aligned with what the
// extraction model sees.
function flattenInstructions(value: unknown): unknown[] {
  if (typeof value === 'string') return [value];
  if (!Array.isArray(value)) return [];

  const flattened: unknown[] = [];
  for (const entry of value) {
    if (typeof entry === 'object' && entry !== null && !Array.isArray(entry) && isHowToSection(entry as Record<string, unknown>)) {
      const items = (entry as Record<string, unknown>).itemListElement;
      if (Array.isArray(items)) flattened.push(...items);
      continue;
    }
    flattened.push(entry);
  }
  return flattened;
}

// Returns per-instruction image URLs for a Recipe JSON-LD node, or an empty
// result when the node is absent or has no instruction images at all.
export function extractJsonLdStepImages(
  recipeJsonLd: Record<string, unknown> | null,
  baseUrl: string,
): JsonLdStepImages {
  if (!recipeJsonLd) return { instructionCount: 0, images: [] };

  const instructions = flattenInstructions(recipeJsonLd.recipeInstructions);
  const images = instructions.map((entry) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return null;
    return extractImageUrl((entry as Record<string, unknown>).image, baseUrl);
  });

  return { instructionCount: instructions.length, images };
}
