# Spec 02: Canonical Recipe Schema

## Goal
Define the canonical normalized recipe format and strict validation rules.

## Canonical Type
```ts
type CanonicalRecipe = {
  title: string
  tags: string[]
  time: number | null
  ingredients: {
    name: string
    amount_text: string
    amount_value?: number
    unit?: string
    image?: string
  }[]
  pantry_items: string[]
  main_image: string
  steps: {
    step_header: string
    step_description: string
    image?: string
  }[]
  metadata: {
    source_type: 'url' | 'manual'
    source_url?: string
    language: 'en'
    warnings: string[]
  }
}
```

## Validation Rules
1. title required, trimmed, 1-140 chars.
2. tags required array, max 5 entries, each 1-40 chars. Selected primarily from the controlled vocabulary in specs/12-shared-constants.md; custom tags allowed if none fit.
3. time nullable; if present, integer minutes >= 0 and <= 1440.
4. ingredients required array; may be empty when all detected items are classified as pantry items.
5. ingredient name required, trimmed.
6. amount_text required for each ingredient (supports fractions and free text).
7. pantry_items required array, deduplicated.
8. main_image required URL/path string. If no valid image is found, use a configured default image URL.
9. steps required array, length 1-6 after compaction.
10. each step header/description required and non-empty.
11. each step_description has a maximum of 600 characters
12. metadata.warnings always present (possibly empty).

## Normalization Rules
- Trim all strings.
- Collapse multi-spaces to single spaces.
- Deduplicate tags case-insensitively.
- Preserve ordering for ingredients and steps.
- Lowercase pantry item matching keys but preserve display form.
- Pantry routing is based on a fixed pantry allowlist defined in shared constants (see specs/12-shared-constants.md for the exact list).

## Conflict Rules
- If an ingredient matches the fixed pantry allowlist, move it to pantry_items and remove it from ingredients.
- If steps exceed 6 after extraction, invoke compaction algorithm before final validation.

## Serialization Rules
- All outputs are valid JSON objects.
- No undefined values in response payload.

## Acceptance Criteria
- Every backend success response validates against this schema.
- All schema violations produce structured error with exact failing fields.