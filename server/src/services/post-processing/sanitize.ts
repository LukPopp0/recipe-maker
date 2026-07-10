import { applyMainImageFallback, CanonicalRecipeSchema, type CanonicalRecipe } from 'shared';
import { AppError } from '../../lib/errors.js';

const MAX_STEP_DESCRIPTION_LENGTH = 600;

// Above this, the extracted total time is likely wrong (e.g. summed unrelated
// durations). We flag it for review but never clamp - time stays user-editable.
const IMPLAUSIBLE_TIME_MINUTES = 240;

// Trim + collapse internal whitespace (specs/02 normalization rules).
function clean(value: string): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

// Deduplicate strings case-insensitively, preserving first-seen display form.
function dedupeCaseInsensitive(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

/**
 * Final safety net before a recipe is considered canonical (specs/04 step 6):
 * - trims all strings and collapses multi-spaces,
 * - hard-clamps each step_description to 600 chars, recording a metadata.warnings entry
 *   whenever a description was actually truncated (content may have been lost),
 * - flags an implausible time (over 240 min) with a metadata.warnings entry, without
 *   clamping it (time stays user-editable in the review UI),
 * - resolves the main_image default via applyMainImageFallback,
 * - dedupes tags and pantry_items case-insensitively,
 * - re-validates against CanonicalRecipeSchema.
 *
 * Throws AppError('SCHEMA_VALIDATION_FAILED', ...) with the Zod issues attached
 * as `details.issues` when the object still does not conform.
 */
export function finalSanitize(recipe: CanonicalRecipe, defaultMainImageUrl: string): CanonicalRecipe {
  const truncationWarnings: string[] = [];

  const timeWarnings: string[] =
    recipe.time !== null && recipe.time > IMPLAUSIBLE_TIME_MINUTES
      ? [`Extracted time is ${recipe.time} minutes (over 4 hours); please verify.`]
      : [];

  const steps = recipe.steps.map((step, index) => {
    const cleanedDescription = clean(step.step_description);
    if (cleanedDescription.length > MAX_STEP_DESCRIPTION_LENGTH) {
      truncationWarnings.push(
        `Step ${index + 1} description was truncated to fit the 600-character limit; content may have been lost.`,
      );
    }
    return {
      step_header: clean(step.step_header),
      step_description: cleanedDescription.slice(0, MAX_STEP_DESCRIPTION_LENGTH).trim(),
      ...(step.image !== undefined && step.image !== null ? { image: step.image.trim() } : {}),
    };
  });

  const sanitized: CanonicalRecipe = {
    title: clean(recipe.title),
    tags: dedupeCaseInsensitive(recipe.tags.map(clean).filter((tag) => tag.length > 0)),
    time: recipe.time,
    ingredients: recipe.ingredients.map((ingredient) => ({
      name: clean(ingredient.name),
      amount_text: clean(ingredient.amount_text),
      // Gemini emits null (not omission) when it has no value; treat both as "absent".
      ...(ingredient.amount_value !== undefined && ingredient.amount_value !== null
        ? { amount_value: ingredient.amount_value }
        : {}),
      ...(ingredient.unit !== undefined && ingredient.unit !== null ? { unit: clean(ingredient.unit) } : {}),
      ...(ingredient.image !== undefined && ingredient.image !== null ? { image: ingredient.image.trim() } : {}),
    })),
    pantry_items: dedupeCaseInsensitive(recipe.pantry_items.map(clean).filter((item) => item.length > 0)),
    main_image: applyMainImageFallback((recipe.main_image ?? '').trim(), defaultMainImageUrl),
    steps,
    metadata: {
      source_type: recipe.metadata.source_type,
      ...(recipe.metadata.source_url !== undefined && recipe.metadata.source_url !== null
        ? { source_url: recipe.metadata.source_url.trim() }
        : {}),
      language: recipe.metadata.language,
      warnings: [
        ...(recipe.metadata.warnings ?? []).map(clean).filter((warning) => warning.length > 0),
        ...truncationWarnings,
        ...timeWarnings,
      ],
    },
  };

  const parsed = CanonicalRecipeSchema.safeParse(sanitized);
  if (!parsed.success) {
    throw new AppError(
      'SCHEMA_VALIDATION_FAILED',
      'The recipe failed schema validation after post-processing.',
      { issues: parsed.error.issues },
    );
  }

  return parsed.data;
}
