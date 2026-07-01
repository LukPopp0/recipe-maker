# Spec 05: Option B Manual Ingestion

## Goal
Convert manually entered recipe text and uploaded images into canonical JSON.

## UI Input Contract
- ingredientsText: required multiline text.
- stepsText: required multiline text.
- mainImage: image file.
- stepImages: optional array of image files.

## Parsing Rules
### Input preprocessing
- Preserve raw ingredient and step text as provided by user.
- Trim obvious leading/trailing whitespace and normalize newlines.
- Avoid deep manual parsing to reduce brittle heuristics.

## Step Image Assignment
- Sort uploaded step image filenames ascending (case-insensitive).
- Map images to parsed steps by index.
- If more images than steps, ignore extras with warning.
- If fewer images than steps, remaining steps have no image.

## Gemini Normalization
- Send raw ingredientsText + stepsText + image metadata to Gemini.
- Ask Gemini to extract and normalize directly into canonical schema.
- Keep sequence and core meaning from user input.
- Enforce pantry routing from fixed pantry allowlist:
	- pantry items must be in pantry_items only.
	- pantry items must not remain in ingredients.
- Enforce step_description <= 600 characters.
- Enforce required main_image; use configured default image URL when uploaded main image is missing/invalid.

## Validation and Post-Processing
- Apply same post-processors as Option A.
- Enforce max 6 steps using compaction.
- Validate against canonical schema.

## Acceptance Criteria
- Manual input always returns canonical recipe or actionable parse error.
- Step image order deterministic based on filename sorting.
- User intent preserved from manual text.