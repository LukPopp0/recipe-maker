# Spec 04: Option A URL Ingestion

## Goal
Ingest a recipe from a URL, normalize it, and return canonical JSON.

## Pipeline
1. Validate URL format and protocol (http/https only).
2. Security filter:
   - block localhost/private network addresses.
   - enforce redirect and size limits.
3. Fetch HTML with timeout.
4. Invoke Gemini extraction and normalization as the primary path:
   - provide URL and fetched page content/context.
   - request canonical schema output directly.
5. Optional fallback path if Gemini primary extraction fails:
   - pass reduced/cleaned page content chunks back to Gemini in a retry prompt.
6. Post-process and validate:
   - pantry split.
   - tags normalization.
   - step compaction.
   - step_description length clamp to 600 chars.
   - default main_image fallback when missing/invalid.
   - image hosting.
7. Return canonical recipe.

## Gemini Prompting Requirements
- Enforce output fields exactly.
- Instruct model to preserve ingredient ordering.
- Instruct model to summarize/merge steps only when count > 6.
- Instruct model to shorten step description per step to below 600 characters if this number is exceeded.
- Instruct model to route fixed pantry-list items into pantry_items and exclude them from ingredients.
- Instruct model to avoid hallucinating missing fields; use null/empty with warning.

## Failure Conditions
- Not a recipe page.
- Missing minimum required content (title + ingredients + at least one step).
- Fetch/parsing failures.
- Gemini response fails schema validation after retry.

## User-Facing Error Messaging
- Must include reason and suggested action.
- Example: "This page does not contain a recognizable recipe. Try another URL or use manual input."

## Acceptance Criteria
- Works on common recipe domains and many arbitrary pages.
- Returns explicit failure for non-recipe content.
- Produces canonical output validated by schema.