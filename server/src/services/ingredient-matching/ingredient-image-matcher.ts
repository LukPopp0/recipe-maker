import { z } from 'zod';
import { buildIngredientMatchingPrompt } from '../ai/prompts/ingredient-matching.js';
import type { GeminiClient } from '../ai/gemini-client.js';
import type { GeminiConfig } from '../ai/config.js';
import type { RawIngredient } from '../post-processing/index.js';
import { INGREDIENT_NOT_FOUND_IMAGE, type IngredientCatalog } from './catalog.js';

const matchEntrySchema = z.object({
  name: z.string().trim().min(1),
  amount_text: z.string().trim().min(1),
  unit: z.string().optional(),
  image: z.string().min(1),
});

const matchResponseSchema = z.array(matchEntrySchema);

export interface IngredientImageMatchResult {
  ingredients: RawIngredient[]
  warnings: string[]
}

export interface IngredientImageMatcher {
  matchIngredientImages(ingredients: RawIngredient[]): Promise<IngredientImageMatchResult>
}

export interface CreateIngredientImageMatcherParams {
  geminiClient: Pick<GeminiClient, 'generateCanonicalRecipe'>
  geminiConfig: GeminiConfig
  catalog: IngredientCatalog
}

// Builds the degraded fallback result: every input ingredient is kept as-is
// except its image is forced to the not-found placeholder, plus a single
// warning summarizing the degradation.
function degradedResult(ingredients: RawIngredient[]): IngredientImageMatchResult {
  return {
    ingredients: ingredients.map((ingredient) => ({ ...ingredient, image: INGREDIENT_NOT_FOUND_IMAGE })),
    warnings: ['Ingredient image matching failed after retry; all ingredients set to INGREDIENT_NOT_FOUND.png.'],
  };
}

// Runs one matching attempt against a given model. Returns the parsed,
// length-checked entries, or null if anything about the attempt failed
// (transport/timeout/parse errors from the client, or schema/length
// mismatches in the response). Never throws.
async function attemptMatch(
  geminiClient: Pick<GeminiClient, 'generateCanonicalRecipe'>,
  model: string,
  timeoutMs: number,
  prompt: string,
  expectedLength: number,
): Promise<z.infer<typeof matchResponseSchema> | null> {
  try {
    const raw = await geminiClient.generateCanonicalRecipe({ model, prompt, timeoutMs });
    const parsed = matchResponseSchema.parse(raw);
    if (parsed.length !== expectedLength) return null;
    return parsed;
  } catch {
    // Covers AppError (transport/timeout/unparseable) and ZodError (bad shape).
    return null;
  }
}

export function createIngredientImageMatcher(
  params: CreateIngredientImageMatcherParams,
): IngredientImageMatcher {
  const { geminiClient, geminiConfig, catalog } = params;

  return {
    async matchIngredientImages(ingredients: RawIngredient[]): Promise<IngredientImageMatchResult> {
      if (ingredients.length === 0) {
        return { ingredients: [], warnings: [] };
      }

      const prompt = buildIngredientMatchingPrompt({ ingredients, catalogFilenames: catalog.filenames });

      const primary = await attemptMatch(
        geminiClient,
        geminiConfig.primaryModel,
        geminiConfig.timeoutMs,
        prompt,
        ingredients.length,
      );
      const matched = primary
        ?? (await attemptMatch(geminiClient, geminiConfig.retryModel, geminiConfig.timeoutMs, prompt, ingredients.length));

      if (!matched) {
        return degradedResult(ingredients);
      }

      const warnings: string[] = [];
      const resultIngredients = matched.map((entry, index) => {
        let image = entry.image;
        if (!catalog.has(image) && image !== INGREDIENT_NOT_FOUND_IMAGE) {
          warnings.push(
            `Ingredient '${entry.name}' matched a filename not in the catalog ('${image}'); using ${INGREDIENT_NOT_FOUND_IMAGE} instead.`,
          );
          image = INGREDIENT_NOT_FOUND_IMAGE;
        } else if (image === INGREDIENT_NOT_FOUND_IMAGE) {
          warnings.push(`No image match found for ingredient '${entry.name}'.`);
        }

        return {
          ...ingredients[index],
          name: entry.name,
          amount_text: entry.amount_text,
          // Intentional overwrite: re-normalized unit from the model response,
          // including when the model omits it (dropped deliberately).
          unit: entry.unit,
          image,
        };
      });

      return { ingredients: resultIngredients, warnings };
    },
  };
}
