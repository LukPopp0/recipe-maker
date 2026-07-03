import type { CanonicalRecipe, Metadata } from 'shared'
import { classifyPantryItems, type RawIngredient } from './pantry-classifier.js'
import { normalizeTags } from './tag-normalizer.js'
import { compactSteps, type RawStep } from './step-compaction.js'
import { finalSanitize } from './sanitize.js'

export type { RawIngredient } from './pantry-classifier.js'
export type { RawStep } from './step-compaction.js'
export { classifyPantryItems } from './pantry-classifier.js'
export { normalizeTags } from './tag-normalizer.js'
export { compactSteps } from './step-compaction.js'
export { finalSanitize } from './sanitize.js'

// Loosely-typed recipe as produced by Gemini extraction, before deterministic
// post-processing turns it into a schema-valid CanonicalRecipe. Fields mirror
// CanonicalRecipe but pantry routing / tag normalization / step compaction and
// the main_image default have not been applied yet.
export interface RawRecipeCandidate {
  title: string
  tags: string[]
  time: number | null
  ingredients: RawIngredient[]
  pantry_items?: string[]
  main_image?: string
  steps: RawStep[]
  metadata: Metadata
}

export interface ApplyPostProcessingOptions {
  defaultMainImageUrl: string
}

/**
 * Deterministic canonical post-processing pipeline (specs/04 step 6 ordering):
 *   1. pantry classification  (route staples out of ingredients)
 *   2. tag normalization      (vocabulary casing, dedupe, cap at 5)
 *   3. step compaction        (<= 6 steps)
 *   4. final sanitize         (trim, clamp, main_image fallback, re-validate)
 *
 * Returns a fully schema-valid CanonicalRecipe or throws
 * AppError('SCHEMA_VALIDATION_FAILED', ...) via finalSanitize.
 */
export function applyPostProcessing(
  candidate: RawRecipeCandidate,
  { defaultMainImageUrl }: ApplyPostProcessingOptions,
): CanonicalRecipe {
  const { ingredients, pantry_items: classifiedPantry } = classifyPantryItems(candidate.ingredients ?? [])
  const tags = normalizeTags(candidate.tags ?? [])
  const steps = compactSteps(candidate.steps ?? [])
  const pantryItems = [...(candidate.pantry_items ?? []), ...classifiedPantry]

  const assembled: CanonicalRecipe = {
    title: candidate.title,
    tags,
    time: candidate.time ?? null,
    ingredients,
    pantry_items: pantryItems,
    main_image: candidate.main_image ?? '',
    steps,
    metadata: candidate.metadata,
  }

  return finalSanitize(assembled, defaultMainImageUrl)
}
