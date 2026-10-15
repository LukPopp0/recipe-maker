import { TAG_VOCABULARY } from 'shared';
import type { CandidateImage } from '../../url-ingestion/html-cleaner.js';
import { buildSharedRules, CLOSING_REMINDER } from './shared-rules.js';

// Compact description of the CanonicalRecipe shape (docs/specs/02), not the full Zod
// schema. Field names must be reproduced exactly since the pipeline (Task 6)
// feeds the model's raw JSON straight into CanonicalRecipeSchema.parse.
const CANONICAL_RECIPE_SHAPE = `{
  "title": string (1-140 chars, required),
  "tags": string[] (max 5 tags, each 1-40 chars),
  "time": number | null (integer minutes, 0-1440, or null if unknown),
  "ingredients": [{ "name": string, "amount_text": string, "amount_value"?: number, "unit"?: string }],
  "pantry_items": string[] (fixed pantry-list items only, see below),
  "main_image": string (a URL from the candidate images, or "" if none apply),
  "steps": [{ "step_header": string, "step_description": string (max 600 chars), "image"?: string (optional URL of an image that shows THIS step, from the candidate images or structured metadata) }] (1-6 steps),
  "metadata": {
    "source_type": "url",
    "source_url": string,
    "language": "en",
    "warnings": string[] (empty array if none)
  }
}`;

const TAG_VOCABULARY_TEXT = TAG_VOCABULARY.join(', ');

const SHARED_INSTRUCTIONS = `You are extracting a recipe into a strict JSON schema. Output ONLY a single JSON
object matching this shape exactly (field names must match exactly):

<output_schema>
${CANONICAL_RECIPE_SHAPE}
</output_schema>

Rules:
${buildSharedRules({
  structuredTimeNote: ' even if the source lists them (e.g. a structured prepTime of "PT12H" for freezing overnight)',
})}
- Select tags primarily from this controlled vocabulary: ${TAG_VOCABULARY_TEXT}. Custom
  tags are allowed if none of these fit, but prefer the vocabulary above.
- Assign a step's "image" only when a candidate or structured-metadata image clearly
  shows that specific step (an in-progress/step photo, not the finished-dish hero
  shot). Omit the field when unsure. Output the bare URL only.
- Set "metadata.source_type" to "url", "metadata.language" to "en".`;

// Renders the optional JSON-LD section shared by both prompts. When a page
// embeds a schema.org Recipe node, it is the most reliable extraction input,
// so the model is told to prefer it over the visible page text.
function renderJsonLdSection(recipeJsonLd: Record<string, unknown> | null | undefined): string {
  if (!recipeJsonLd) return '';
  return `
Structured recipe metadata (schema.org JSON-LD embedded by the site - treat this as
the authoritative source; prefer it over the page content below when they disagree.
Exception: JSON-LD often flattens or omits ingredient section headings and sometimes
omits ingredients entirely; use the page content for ingredient grouping and for
anything missing here):
<structured_metadata>
${JSON.stringify(recipeJsonLd)}
</structured_metadata>
`;
}

// Renders candidate images one per line, with alt text (when present) as the
// step-mapping hint, e.g. `https://... (alt: "browning the beef")`.
function renderCandidateImages(candidateImages: CandidateImage[]): string {
  if (candidateImages.length === 0) return '(none)';
  return candidateImages
    .map((img) => (img.alt ? `${img.url} (alt: "${img.alt}")` : img.url))
    .join('\n');
}

export interface BuildUrlIngestionPromptParams {
  url: string
  cleanedText: string
  candidateImages: CandidateImage[]
  titleHint: string | null
  recipeJsonLd?: Record<string, unknown> | null
}

// Primary extraction prompt: full cleaned page content plus context.
export function buildUrlIngestionPrompt({
  url,
  cleanedText,
  candidateImages,
  titleHint,
  recipeJsonLd,
}: BuildUrlIngestionPromptParams): string {
  return `${SHARED_INSTRUCTIONS}
- Set "metadata.source_url" to exactly: ${url}

Source URL: ${url}
Title hint (from the page's <title>/og:title, may be inaccurate or absent): ${titleHint ?? '(none)'}
Candidate image URLs (choose "main_image" and per-step "image" values from this list
when suitable ones exist):
${renderCandidateImages(candidateImages)}
${renderJsonLdSection(recipeJsonLd)}
Page content:
<page_content>
${cleanedText}
</page_content>

${CLOSING_REMINDER}

Return only the JSON object, no surrounding text or markdown fences.`;
}

export interface BuildUrlIngestionRetryPromptParams {
  url: string
  reducedText: string
  candidateImages: CandidateImage[]
  titleHint?: string | null
  recipeJsonLd?: Record<string, unknown> | null
  // Why the first attempt was rejected, in plain words (e.g. "the response had
  // no steps"), so the model knows what to fix.
  previousFailure: string
}

// Retry prompt used when the first attempt failed (request error/timeout or a
// response missing title/ingredients/steps). Shorter, more focused content,
// the concrete failure reason, and a warning to be strict about required fields.
export function buildUrlIngestionRetryPrompt({
  url,
  reducedText,
  candidateImages,
  titleHint,
  recipeJsonLd,
  previousFailure,
}: BuildUrlIngestionRetryPromptParams): string {
  return `${SHARED_INSTRUCTIONS}
- Set "metadata.source_url" to exactly: ${url}

IMPORTANT: A previous attempt to extract this recipe failed: ${previousFailure}. Be
strict about required fields (title, tags, time, ingredients, pantry_items, main_image,
steps, metadata) and their exact types. Do not omit any required field - use null or
an empty array/string instead.

Source URL: ${url}
Title hint (from the page's <title>/og:title, may be inaccurate or absent): ${titleHint ?? '(none)'}
Candidate image URLs (choose "main_image" and per-step "image" values from this list
when suitable ones exist):
${renderCandidateImages(candidateImages)}
${renderJsonLdSection(recipeJsonLd)}
Reduced page content:
<page_content>
${reducedText}
</page_content>

${CLOSING_REMINDER}

Return only the JSON object, no surrounding text or markdown fences.`;
}
