import { z } from 'zod'

// Per specs/02, rule 5-6: ingredient name is required/trimmed, amount_text is required
// free text (supports fractions, e.g. "1 1/2 cups").
export const IngredientSchema = z.object({
  name: z.string().trim().min(1),
  amount_text: z.string().min(1),
  amount_value: z.number().optional(),
  unit: z.string().optional(),
  image: z.string().optional(),
})

// Per specs/02, rule 10-11: step_header/step_description required non-empty,
// step_description max 600 chars.
export const StepSchema = z.object({
  step_header: z.string().trim().min(1),
  step_description: z.string().trim().min(1).max(600),
  image: z.string().optional(),
})

// Per specs/02, rule 12: metadata.warnings always present (possibly empty).
export const MetadataSchema = z.object({
  source_type: z.enum(['url', 'manual']),
  source_url: z.string().optional(),
  language: z.literal('en'),
  warnings: z.array(z.string()).default([]),
})

// Canonical recipe schema per specs/02. Validation rules implemented exactly:
// 1. title required/trimmed/1-140 chars.
// 2. tags required array, max 5 entries, each 1-40 chars.
// 3. time nullable; if present, integer minutes 0-1440.
// 4. ingredients required array (may be empty).
// 7. pantry_items required array.
// 8. main_image required non-empty string (the "apply default if missing" fallback
//    logic lives in applyMainImageFallback below, called BEFORE schema validation).
// 9. steps required array, length 1-6.
export const CanonicalRecipeSchema = z.object({
  title: z.string().trim().min(1).max(140),
  tags: z.array(z.string().trim().min(1).max(40)).max(5),
  time: z.number().int().min(0).max(1440).nullable(),
  ingredients: z.array(IngredientSchema),
  pantry_items: z.array(z.string()),
  main_image: z.string().min(1),
  steps: z.array(StepSchema).min(1).max(6),
  metadata: MetadataSchema,
})

export type Ingredient = z.infer<typeof IngredientSchema>
export type Step = z.infer<typeof StepSchema>
export type Metadata = z.infer<typeof MetadataSchema>
export type CanonicalRecipe = z.infer<typeof CanonicalRecipeSchema>

/**
 * Applies specs/02 rule 8: main_image is required by the schema, so callers must
 * resolve a fallback BEFORE validation when no valid image was found during ingestion.
 * The schema itself only enforces "non-empty string"; it does not know about defaults.
 */
export function applyMainImageFallback(candidate: string | undefined | null, fallbackUrl: string): string {
  if (candidate && candidate.trim().length > 0) {
    return candidate
  }
  return fallbackUrl
}
