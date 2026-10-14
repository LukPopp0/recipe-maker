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

type MatchEntry = z.infer<typeof matchEntrySchema>;

// One attempt's entries aligned to the input list: aligned[i] is the model
// entry for input ingredient i, or undefined when none could be aligned.
interface AlignedMatch {
  aligned: (MatchEntry | undefined)[]
  unmatched: number
}

// Lowercase, punctuation collapsed to single spaces, so "Red Onions" and
// "red onions, finely chopped" compare on words.
function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// Whole-word containment either way: the model strips preparation details
// ("red onions, finely chopped" -> "Red Onions"), so exact equality is too strict.
function namesOverlap(a: string, b: string): boolean {
  if (!a || !b) return false;
  return ` ${a} `.includes(` ${b} `) || ` ${b} `.includes(` ${a} `);
}

// Aligns a response whose length differs from the input (phase 8.5 item 9).
// 1. Walk inputs in order; for each, take the first unused entry at or after
//    the previous match whose name equals it, else whose name overlaps it.
// 2. Fill gaps by position: a run of unaligned inputs between two aligned
//    neighbours is paired one-to-one with the entries between those
//    neighbours' entries, but only when the two counts are equal (unambiguous).
function alignByName(ingredients: RawIngredient[], entries: MatchEntry[]): (number | undefined)[] {
  const entryIndexFor: (number | undefined)[] = new Array(ingredients.length).fill(undefined);
  const entryNames = entries.map((entry) => normalizeName(entry.name));
  let cursor = 0;

  ingredients.forEach((ingredient, i) => {
    const inputName = normalizeName(ingredient.name ?? '');
    let found = entryNames.findIndex((name, k) => k >= cursor && name === inputName);
    if (found === -1) {
      found = entryNames.findIndex((name, k) => k >= cursor && namesOverlap(name, inputName));
    }
    if (found !== -1) {
      entryIndexFor[i] = found;
      cursor = found + 1;
    }
  });

  let i = 0;
  while (i < ingredients.length) {
    if (entryIndexFor[i] !== undefined) {
      i += 1;
      continue;
    }
    const runStart = i;
    while (i < ingredients.length && entryIndexFor[i] === undefined) i += 1;
    const runLength = i - runStart;
    const prevEntry = runStart > 0 ? (entryIndexFor[runStart - 1] as number) : -1;
    const nextEntry = i < ingredients.length ? (entryIndexFor[i] as number) : entries.length;
    if (nextEntry - prevEntry - 1 === runLength) {
      for (let offset = 0; offset < runLength; offset += 1) {
        entryIndexFor[runStart + offset] = prevEntry + 1 + offset;
      }
    }
  }

  return entryIndexFor;
}

// Runs one matching attempt against a given model. Returns the entries
// aligned to the input list, or null if the attempt failed outright
// (transport/timeout errors from the client, or a schema mismatch in the
// response). A length mismatch is salvaged by name alignment rather than
// discarded. Never throws. Logs one diagnostic line per attempt (ok, the
// salvage outcome, or the classified failure reason) so recurring degrade
// causes are visible.
async function attemptMatch(
  geminiClient: Pick<GeminiClient, 'generateCanonicalRecipe'>,
  model: string,
  timeoutMs: number,
  prompt: string,
  ingredients: RawIngredient[],
): Promise<AlignedMatch | null> {
  const expectedLength = ingredients.length;
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
    const entryIndexFor = alignByName(ingredients, parsed);
    const aligned = entryIndexFor.map((k) => (k === undefined ? undefined : parsed[k]));
    const unmatched = aligned.filter((entry) => entry === undefined).length;
    logMatchAttempt({
      model,
      outcome: unmatched === 0 ? 'salvaged' : 'partial',
      reason: 'length-mismatch',
      expectedLength,
      actualLength: parsed.length,
      unmatched,
    });
    return { aligned, unmatched };
  }

  logMatchAttempt({ model, outcome: 'ok', count: parsed.length });
  return { aligned: parsed, unmatched: 0 };
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
        ingredients,
      );

      // A fully aligned primary is used as-is. Otherwise retry, and keep
      // whichever attempt left fewer inputs unaligned (primary on a tie).
      let matched = primary;
      if (!primary || primary.unmatched > 0) {
        const retry = await attemptMatch(
          geminiClient,
          geminiConfig.retryModel,
          geminiConfig.timeoutMs,
          prompt,
          ingredients,
        );
        if (retry && (!primary || retry.unmatched < primary.unmatched)) {
          matched = retry;
        }
      }

      if (!matched) {
        return degradedResult(ingredients);
      }

      const warnings: string[] = [];
      const resultIngredients = matched.aligned.map((entry, index) => {
        if (!entry) {
          warnings.push(
            `Ingredient '${ingredients[index].name}' was missing from the image-matching response; using ${INGREDIENT_NOT_FOUND_IMAGE}.`,
          );
          return { ...ingredients[index], image: INGREDIENT_NOT_FOUND_IMAGE };
        }

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
