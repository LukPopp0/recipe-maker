import { z } from 'zod'
import { CanonicalRecipeSchema } from './canonical-recipe.js'

// POST /api/ingest/url request body per specs/03.
export const IngestUrlRequestSchema = z.object({
  url: z.string().trim().url(),
})

export type IngestUrlRequest = z.infer<typeof IngestUrlRequestSchema>

// POST /api/recipe/save request body per specs/03: a canonical recipe candidate.
export const SaveRecipeRequestSchema = CanonicalRecipeSchema

export type SaveRecipeRequest = z.infer<typeof SaveRecipeRequestSchema>

// Recipe ids are always server-generated via crypto.randomUUID() (see
// LocalJsonFileRecipeRepository.save). Any :id route param must be validated
// against this schema before it reaches a repository, since repositories may
// build filesystem paths from it - an unvalidated id is a path traversal risk.
export const RecipeIdSchema = z.string().uuid()

export type RecipeId = z.infer<typeof RecipeIdSchema>
