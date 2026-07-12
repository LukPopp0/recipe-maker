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
- Merge ingredients that name the same item and differ only by preparation words
  (sliced, chopped, diced, minced, grated, fresh, ground, etc.) into a single entry, and
  combine their amounts when they can be sensibly combined. Do NOT merge ingredients that
  differ in identity (e.g. "red onion" vs "onion", "green onion" vs "onion").
- For "unit", use the short form: pounds -> lbs, tablespoons -> tbsp, teaspoons -> tsp,
  ounces -> oz, grams -> g, milliliters -> ml. Keep "amount_text" as the source amount.
- Preserve the sequence and core meaning of the user's steps - do not reorder, invent, or
  drop steps (adding missing cutting prep at the start, per the rule below, is the one
  allowed exception).
- Ingredient lists often carry cutting instructions ("1 onion, diced", "chicken breast,
  cut into strips"). When the steps never tell the cook to do that cutting, add the
  missing cutting instructions to the start of the recipe so no knife work is lost when
  ingredient names are normalized: either prepend them to the first step's description
  (e.g. "Dice the onion and cut the chicken into strips. " before its existing text) or,
  if the recipe would still have at most 6 steps, add them as a new first preparation
  step. Only carry over cutting/knife work (dice, slice, chop, mince, cube, julienne,
  halve, cut into ...); do not move other preparation (rinsing, peeling, draining), and
  do not duplicate cutting the steps already describe.
- For "time", give the active hands-on time in minutes (prep plus cooking). For a range
  like "30 minutes to 1 hour" use the upper bound (60). EXCLUDE long passive/unattended
  waits such as overnight freezing, marinating, soaking, resting, chilling, rising, or
  proofing - do not add these to the total. Typical recipes run from 1 minute to about 4
  hours; never sum unrelated durations.
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
