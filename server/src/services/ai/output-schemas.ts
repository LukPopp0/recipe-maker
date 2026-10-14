import { z } from 'zod';
import { CanonicalRecipeSchema, IngredientSchema, StepSchema } from 'shared';

// Response schemas for the model calls, passed as structured output so the
// model is constrained to the right shape while generating instead of only
// being asked for it in the prompt. Built from the shared Zod schemas and
// converted to plain JSON Schema, which is provider-neutral (Gemini's
// responseJsonSchema; Claude's structured outputs take JSON Schema too).
// The model output is still validated by Zod in post-processing - these
// schemas cannot express every rule (e.g. the 600-char step limit).

// The model's raw extraction output, not the final CanonicalRecipe: no
// ingredient images (the matcher assigns them) and a main_image that may be
// "" (post-processing applies the fallback).
const ExtractedIngredientSchema = IngredientSchema.omit({ image: true });
const recipe = CanonicalRecipeSchema.shape;

export const UrlRecipeOutputSchema = z.object({
  title: recipe.title,
  tags: recipe.tags,
  time: recipe.time,
  ingredients: z.array(ExtractedIngredientSchema),
  pantry_items: recipe.pantry_items,
  main_image: z.string(),
  steps: z.array(StepSchema).min(1).max(6),
  metadata: z.object({
    source_type: z.literal('url'),
    source_url: z.string(),
    language: z.literal('en'),
    warnings: z.array(z.string()),
  }),
});

// Manual ingestion: tags are user-set and main/step images are assigned by
// the backend, so the model is not given those fields at all.
export const ManualRecipeOutputSchema = z.object({
  title: recipe.title,
  time: recipe.time,
  ingredients: z.array(ExtractedIngredientSchema),
  pantry_items: recipe.pantry_items,
  steps: z.array(StepSchema.omit({ image: true })).min(1).max(6),
  metadata: z.object({
    source_type: z.literal('manual'),
    language: z.literal('en'),
    warnings: z.array(z.string()),
  }),
});

type JsonSchema = Record<string, unknown>;

// JSON Schema keywords kept in model schemas. A conservative subset that
// Gemini's responseJsonSchema documents as supported; anything else (string
// lengths, defaults, $schema) is dropped rather than risk a rejected request.
const SUPPORTED_KEYWORDS = new Set([
  'type',
  'properties',
  'required',
  'items',
  'enum',
  'anyOf',
  'minItems',
  'maxItems',
  'minimum',
  'maximum',
  'description',
  'additionalProperties',
]);

// Largest integer bound Zod emits for an unbounded int; meaningless to the model.
const UNBOUNDED_INT = Number.MAX_SAFE_INTEGER;

function simplify(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(simplify);
  if (!node || typeof node !== 'object') return node;

  const out: JsonSchema = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === 'const') {
      out.enum = [value];
    } else if (key === 'properties') {
      out.properties = Object.fromEntries(
        Object.entries(value as JsonSchema).map(([field, child]) => [field, simplify(child)]),
      );
    } else if (key === 'maximum' && value === UNBOUNDED_INT) {
      continue;
    } else if (key === 'minimum' && value === -UNBOUNDED_INT) {
      continue;
    } else if (SUPPORTED_KEYWORDS.has(key)) {
      out[key] = simplify(value);
    }
  }
  return out;
}

// Converts a Zod schema to a JSON Schema limited to SUPPORTED_KEYWORDS.
export function toModelJsonSchema(schema: z.ZodType): JsonSchema {
  return simplify(z.toJSONSchema(schema, { io: 'output' })) as JsonSchema;
}

export const URL_RECIPE_OUTPUT_JSON_SCHEMA = toModelJsonSchema(UrlRecipeOutputSchema);
export const MANUAL_RECIPE_OUTPUT_JSON_SCHEMA = toModelJsonSchema(ManualRecipeOutputSchema);

// Image matching: one entry per input ingredient, with "image" limited to the
// catalog filenames so the model cannot invent one.
export function buildIngredientMatchOutputJsonSchema(catalogFilenames: readonly string[]): JsonSchema {
  return toModelJsonSchema(
    z.array(
      z.object({
        i: z.number().int().min(0),
        name: z.string(),
        image: z.enum(catalogFilenames as [string, ...string[]]),
      }),
    ),
  );
}
