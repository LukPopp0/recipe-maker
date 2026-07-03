import { PANTRY_ALLOWLIST, TAG_VOCABULARY } from 'shared'

// Compact description of the CanonicalRecipe shape (specs/02), not the full Zod
// schema. Field names must be reproduced exactly since the pipeline feeds the
// model's raw JSON straight into CanonicalRecipeSchema.parse. Unlike the URL
// ingestion prompt, "main_image" is intentionally omitted here - the backend
// sets it directly after hosting the user's uploaded images (Scope Decision 5).
const MANUAL_RECIPE_SHAPE = `{
  "title": string (1-140 chars, required),
  "tags": string[] (max 5 tags, each 1-40 chars),
  "time": number | null (integer minutes, 0-1440, or null if unknown),
  "ingredients": [{ "name": string, "amount_text": string, "amount_value"?: number, "unit"?: string }],
  "pantry_items": string[] (fixed pantry-list items only, see below),
  "steps": [{ "step_header": string, "step_description": string (max 600 chars) }] (1-6 steps),
  "metadata": {
    "source_type": "manual",
    "language": "en",
    "warnings": string[] (empty array if none)
  }
}`

const PANTRY_LIST_TEXT = PANTRY_ALLOWLIST.join(', ')
const TAG_VOCABULARY_TEXT = TAG_VOCABULARY.join(', ')

const SHARED_INSTRUCTIONS = `You are extracting a recipe into a strict JSON schema. Output ONLY a single JSON
object matching this shape exactly (field names must match exactly):

${MANUAL_RECIPE_SHAPE}

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
- Select tags primarily from this controlled vocabulary: ${TAG_VOCABULARY_TEXT}. Custom
  tags are allowed if none of these fit, but prefer the vocabulary above.
- Set "metadata.source_type" to "manual", "metadata.language" to "en".
- Do not select or reference a main image or step images - those are hosted and
  assigned deterministically by the backend, not by you.`

export interface BuildManualIngestionPromptParams {
  ingredientsText: string
  stepsText: string
  stepImageCount: number
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
"""
${ingredientsText}
"""

Steps (raw user text):
"""
${stepsText}
"""

Return only the JSON object, no surrounding text or markdown fences.`
}
