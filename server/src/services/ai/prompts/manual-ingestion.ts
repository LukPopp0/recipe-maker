import { PANTRY_ALLOWLIST } from 'shared';

// Compact description of the CanonicalRecipe shape (specs/02), not the full Zod
// schema. Field names must be reproduced exactly since the pipeline feeds the
// model's raw JSON straight into CanonicalRecipeSchema.parse. Unlike the URL
// ingestion prompt, "main_image" is intentionally omitted here - the backend
// sets it directly after hosting the user's uploaded images (Scope Decision 5).
// "tags" is also omitted - for manual ingestion tags are fully user-set in the
// review UI, not assigned by Gemini (Scope Decision 7); the pipeline forces
// candidate.tags = [] after this call regardless of what the model returns.
const MANUAL_RECIPE_SHAPE = `{
  "title": string (1-140 chars, required),
  "time": number | null (integer minutes, 0-1440, or null if unknown),
  "ingredients": [{ "name": string, "amount_text": string, "amount_value"?: number, "unit"?: string }],
  "pantry_items": string[] (fixed pantry-list items only, see below),
  "steps": [{ "step_header": string, "step_description": string (max 600 chars) }] (1-6 steps),
  "metadata": {
    "source_type": "manual",
    "language": "en",
    "warnings": string[] (empty array if none)
  }
}`;

const PANTRY_LIST_TEXT = PANTRY_ALLOWLIST.join(', ');

const SHARED_INSTRUCTIONS = `You are extracting a recipe into a strict JSON schema. Output ONLY a single JSON
object matching this shape exactly (field names must match exactly):

<output_schema>
${MANUAL_RECIPE_SHAPE}
</output_schema>

Rules:
- Preserve the original ingredient order exactly as it appears in the source content.
- Preserve the sequence and core meaning of the user's steps - do not reorder, invent, or drop steps.
- The "steps" array must have at most 6 entries. Only merge or summarize steps if the
  source has more than 6 steps; otherwise leave the step count as extracted - do not
  merge steps just because you can.
- Each "step_description" must be under 600 characters. Shorten if needed without
  losing key instructions.
- Route any ingredient that matches this fixed pantry list into "pantry_items" (as
  plain strings) and exclude it from "ingredients": ${PANTRY_LIST_TEXT}.
- Never hallucinate missing fields. If a field is not present in the source, use null
  or an empty value as appropriate and add a short note explaining what is missing to
  "metadata.warnings".
- Set "metadata.source_type" to "manual", "metadata.language" to "en".
- Do not select or reference a main image or step images - those are hosted and
  assigned deterministically by the backend, not by you.`;

export interface BuildManualIngestionPromptParams {
  ingredientsText: string;
  stepsText: string;
  stepImageCount: number;
}

// Primary extraction prompt for manual (Option B) ingestion: raw user-typed
// ingredients and steps text, plus a count of step images the user attached
// (context only - the model must not describe or reference them).
export function buildManualIngestionPrompt({
  ingredientsText,
  stepsText,
  stepImageCount,
}: BuildManualIngestionPromptParams): string {
  return `${SHARED_INSTRUCTIONS}

Context: the user uploaded ${stepImageCount} step image(s), which will be attached to
steps by the backend after normalization - do not attempt to describe or reference them.

Ingredients (raw user text):
<ingredients>
${ingredientsText}
</ingredients>

Steps (raw user text):
<steps>
${stepsText}
</steps>

Return only the JSON object, no surrounding text or markdown fences.`;
}
