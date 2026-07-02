// Shared types, schema, and constants - single entry point for the shared package.

export {
  IngredientSchema,
  StepSchema,
  MetadataSchema,
  CanonicalRecipeSchema,
  applyMainImageFallback,
} from './schema/canonical-recipe.js'
export type { Ingredient, Step, Metadata } from './schema/canonical-recipe.js'
export type { CanonicalRecipe } from './contracts/canonical-recipe.js'

export { IngestUrlRequestSchema, SaveRecipeRequestSchema, RecipeIdSchema } from './schema/requests.js'
export type { IngestUrlRequest, SaveRecipeRequest, RecipeId } from './schema/requests.js'

export { ERROR_CODES } from './contracts/envelope.js'
export type { ErrorCode, ApiError, ApiSuccessEnvelope, ApiErrorEnvelope, ApiResponse } from './contracts/envelope.js'

export type { RecipeSummary } from './contracts/recipe-repository.js'
