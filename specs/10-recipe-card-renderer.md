# Spec 10: Recipe Card Renderer (Milestone 2)

## Goal
Render a standardized two-page recipe card from canonical JSON.

## Inputs
- CanonicalRecipe object.
- Ingredient image URLs (local asset match output).
- Optional step images.

## Page 1 Requirements
- Title at top.
- Tags row/list.
- Total time indicator.
- Main image area.
- Ingredients list on the right with:
  - name
  - amount_text
  - image thumbnail
- Pantry Items list on the bottom below the main image

## Page 2 Requirements
- Steps block containing 1-6 items.
- Each step:
  - step number
  - step_header
  - optional image
  - step_description

## Rendering Rules
- Never render more than 6 steps.
- If step image missing, render text-only step variant.
- If ingredient image missing, render placeholder icon.

## Responsiveness
- Desktop: side-by-side page preview.
- Mobile: stacked pages with page labels.

## Print/PDF
- Add print stylesheet:
  - fixed card dimensions.
  - hide app controls.
  - force page breaks between card pages.

## Styling Constraints
- Final visual design can evolve, but data placement hierarchy must remain stable.

## Acceptance Criteria
- Any valid canonical recipe renders without layout overflow.
- Print output preserves both pages and all content.
- Missing media handled gracefully.