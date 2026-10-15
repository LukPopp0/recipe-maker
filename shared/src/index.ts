// Shared types, schema, and constants - single entry point for the shared package.

export {
  IngredientSchema,
  StepSchema,
  MetadataSchema,
  CanonicalRecipeSchema,
  applyMainImageFallback,
} from './schema/canonical-recipe.js';
export type { Ingredient, Step, Metadata } from './schema/canonical-recipe.js';
export type { CanonicalRecipe } from './contracts/canonical-recipe.js';

export { IngestUrlRequestSchema, SaveRecipeRequestSchema, RecipeIdSchema } from './schema/requests.js';
export type { IngestUrlRequest, SaveRecipeRequest, RecipeId } from './schema/requests.js';

export { ERROR_CODES } from './contracts/envelope.js';
export type { ErrorCode, ApiError, ApiSuccessEnvelope, ApiErrorEnvelope, ApiResponse } from './contracts/envelope.js';

export type { RecipeMeta, RecipeSummary, LibraryScope } from './contracts/recipe-repository.js';
export type { CurrentUser } from './contracts/user.js';

export { amountContainsUnit, formatIngredientAmount } from './lib/ingredient-amount.js';

export { PANTRY_ALLOWLIST, PANTRY_VARIANTS, isPantryItem, pantryCanonicalName } from './constants/pantry-allowlist.js';
export { TAG_VOCABULARY } from './constants/tag-vocabulary.js';

export { INGREDIENT_IMAGE_MANIFEST } from './generated/ingredient-manifest.js';
