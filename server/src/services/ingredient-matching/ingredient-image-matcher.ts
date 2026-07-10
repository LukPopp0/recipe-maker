import { z } from 'zod';
import { buildIngredientMatchingPrompt } from '../ai/prompts/ingredient-matching.js';
import type { GeminiClient } from '../ai/gemini-client.js';
import type { GeminiConfig } from '../ai/config.js';
import type { RawIngredient } from '../post-processing/index.js';
import { AppError } from '../../lib/errors.js';
import { INGREDIENT_NOT_FOUND_IMAGE, type IngredientCatalog } from './catalog.js';

// Only name + image are consumed from the match response. amount_text/unit
// are accepted but ignored - the matching model's job is image selection, and
// trusting it to re-transcribe amounts made it hallucinate ("not specified")
// and drop units. Amounts/units are preserved from the extraction input below.
const matchEntrySchema = z.object({
  name: z.string().trim().min(1),
  amount_text: z.string().optional(),
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

const RAW_SNIPPET_MAX = 200;

// Best-effort stringify of the model's raw response for diagnostics; never
// throws (e.g. on circular structures) so logging can't break the attempt.
function safeStringify(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

// Emits one structured JSON diagnostic line for an image-matching attempt.
// Mirrors the logStage shape (stage/model/outcome/reason) but the matcher has
// no requestId in scope, so it logs locally rather than via logStage. Purpose
// (phase 8.5 item 9): make the whole-batch degrade cause observable - which of
// transport / schema / length-mismatch fired, and on which model.
function logMatchAttempt(fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ stage: 'image-match', ...fields }));
}

// Runs one matching attempt against a given model. Returns the parsed,
// length-checked entries, or null if anything about the attempt failed
// (transport/timeout errors from the client, or schema/length mismatches in
// the response). Never throws. Logs one diagnostic line per attempt (ok or
// the classified failure reason) so recurring degrade causes are visible.
async function attemptMatch(
  geminiClient: Pick<GeminiClient, 'generateCanonicalRecipe'>,
  model: string,
  timeoutMs: number,
  prompt: string,
  expectedLength: number,
): Promise<z.infer<typeof matchResponseSchema> | null> {
  let raw: unknown;
  try {
    raw = await geminiClient.generateCanonicalRecipe({ model, prompt, timeoutMs });
  } catch (err) {
    logMatchAttempt({
      model,
      outcome: 'error',
      reason: 'transport',
      errorCode: err instanceof AppError ? err.code : err instanceof Error ? err.name : 'unknown',
      expectedLength,
    });
    return null;
  }

  const parseResult = matchResponseSchema.safeParse(raw);
  if (!parseResult.success) {
    const rawStr = safeStringify(raw);
    logMatchAttempt({
      model,
      outcome: 'error',
      reason: 'schema',
      errorCode: parseResult.error.issues[0]?.code,
      expectedLength,
      rawLength: rawStr.length,
      rawSnippet: rawStr.slice(0, RAW_SNIPPET_MAX),
    });
    return null;
  }

  const parsed = parseResult.data;
  if (parsed.length !== expectedLength) {
    logMatchAttempt({
      model,
      outcome: 'error',
      reason: 'length-mismatch',
      expectedLength,
      actualLength: parsed.length,
    });
    return null;
  }

  logMatchAttempt({ model, outcome: 'ok', count: parsed.length });
  return parsed;
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

        // Keep amount_text, amount_value, and unit from the extraction input
        // (spread); take only the title-cased name and the matched image from
        // the model response.
        return {
          ...ingredients[index],
          name: entry.name,
          image,
        };
      });

      return { ingredients: resultIngredients, warnings };
    },
  };
}
