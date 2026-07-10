import { PANTRY_ALLOWLIST, TAG_VOCABULARY } from 'shared';

// Compact description of the CanonicalRecipe shape (specs/02), not the full Zod
// schema. Field names must be reproduced exactly since the pipeline (Task 6)
// feeds the model's raw JSON straight into CanonicalRecipeSchema.parse.
const CANONICAL_RECIPE_SHAPE = `{
  "title": string (1-140 chars, required),
  "tags": string[] (max 5 tags, each 1-40 chars),
  "time": number | null (integer minutes, 0-1440, or null if unknown),
  "ingredients": [{ "name": string, "amount_text": string, "amount_value"?: number, "unit"?: string }],
  "pantry_items": string[] (fixed pantry-list items only, see below),
  "main_image": string (a URL from the candidate images, or "" if none apply),
  "steps": [{ "step_header": string, "step_description": string (max 600 chars) }] (1-6 steps),
  "metadata": {
    "source_type": "url",
    "source_url": string,
    "language": "en",
    "warnings": string[] (empty array if none)
  }
}`;

const PANTRY_LIST_TEXT = PANTRY_ALLOWLIST.join(', ');
const TAG_VOCABULARY_TEXT = TAG_VOCABULARY.join(', ');

const SHARED_INSTRUCTIONS = `You are extracting a recipe into a strict JSON schema. Output ONLY a single JSON
object matching this shape exactly (field names must match exactly):

<output_schema>
${CANONICAL_RECIPE_SHAPE}
</output_schema>

Rules:
- Preserve the original ingredient order exactly as it appears in the source content.
- Merge ingredients that name the same item and differ only by preparation words
  (sliced, chopped, diced, minced, grated, fresh, ground, etc.) into a single entry, and
  combine their amounts when they can be sensibly combined. Do NOT merge ingredients that
  differ in identity (e.g. "red onion" vs "onion", "green onion" vs "onion").
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
- Set "metadata.source_type" to "url", "metadata.language" to "en".`;

// Renders the optional JSON-LD section shared by both prompts. When a page
// embeds a schema.org Recipe node, it is the most reliable extraction input,
// so the model is told to prefer it over the visible page text.
function renderJsonLdSection(recipeJsonLd: Record<string, unknown> | null | undefined): string {
  if (!recipeJsonLd) return '';
  return `
Structured recipe metadata (schema.org JSON-LD embedded by the site - treat this as
the authoritative source; prefer it over the page content below when they disagree):
<structured_metadata>
${JSON.stringify(recipeJsonLd)}
</structured_metadata>
`;
}

export interface BuildUrlIngestionPromptParams {
  url: string
  cleanedText: string
  candidateImageUrls: string[]
  titleHint: string | null
  recipeJsonLd?: Record<string, unknown> | null
}

// Primary extraction prompt: full cleaned page content plus context.
export function buildUrlIngestionPrompt({
  url,
  cleanedText,
  candidateImageUrls,
  titleHint,
  recipeJsonLd,
}: BuildUrlIngestionPromptParams): string {
  return `${SHARED_INSTRUCTIONS}
- Set "metadata.source_url" to exactly: ${url}

Source URL: ${url}
Title hint (from the page's <title>/og:title, may be inaccurate or absent): ${titleHint ?? '(none)'}
Candidate image URLs (choose "main_image" from this list if a suitable one exists):
${candidateImageUrls.length > 0 ? candidateImageUrls.join('\n') : '(none)'}
${renderJsonLdSection(recipeJsonLd)}
Page content:
<page_content>
${cleanedText}
</page_content>

Return only the JSON object, no surrounding text or markdown fences.`;
}

export interface BuildUrlIngestionRetryPromptParams {
  url: string
  reducedText: string
  candidateImageUrls: string[]
  recipeJsonLd?: Record<string, unknown> | null
}

// Retry prompt used when the first attempt failed schema validation. Shorter,
// more focused content and an explicit warning to be strict about required fields.
export function buildUrlIngestionRetryPrompt({
  url,
  reducedText,
  candidateImageUrls,
  recipeJsonLd,
}: BuildUrlIngestionRetryPromptParams): string {
  return `${SHARED_INSTRUCTIONS}
- Set "metadata.source_url" to exactly: ${url}

IMPORTANT: A previous attempt to extract this recipe FAILED schema validation. Be
strict about required fields (title, tags, time, ingredients, pantry_items, main_image,
steps, metadata) and their exact types. Do not omit any required field - use null or
an empty array/string instead.

Source URL: ${url}
Candidate image URLs (choose "main_image" from this list if a suitable one exists):
${candidateImageUrls.length > 0 ? candidateImageUrls.join('\n') : '(none)'}
${renderJsonLdSection(recipeJsonLd)}
Reduced page content:
<page_content>
${reducedText}
</page_content>

Return only the JSON object, no surrounding text or markdown fences.`;
}
