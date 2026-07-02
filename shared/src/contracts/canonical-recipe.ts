// Re-export of the canonical recipe type derived from the Zod schema (single
// source of truth lives in shared/src/schema/canonical-recipe.ts). No duplicate
// hand-written type here.
export type { CanonicalRecipe, Ingredient, Step, Metadata } from '../schema/canonical-recipe.js'
