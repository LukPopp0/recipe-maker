# Spec 08: Ingredient Image Matching

## Goal
Use Gemini to normalize recipe ingredients and map each ingredient to the best matching local image asset from shared/assets/ingredients.

## Input
- Ingredient entries after pantry classification (pantry items are never matched; they have no image field).
- Asset filenames from the ingredient library (the committed manifest generated from shared/assets/ingredients, including INGREDIENT_NOT_FOUND.png).

## Output
Gemini must return a normalized ingredient list where each ingredient includes:
- name: normalized display name in title case.
- amount_text: normalized amount string.
- unit: short unit format when applicable.
- image: matched asset filename (including extension).

If no image can be matched, image must be set to INGREDIENT_NOT_FOUND.png.

The canonical recipe stores the bare catalog filename (e.g. broccoli.png), not a
served path or URL, so exported JSON stays portable. Resolving filenames to
displayable URLs is a frontend concern (via the ingredient manifest); static
serving of ingredient assets is deferred to Phase 5.

## Gemini-First Matching Strategy
1. Build an ingredient-image catalog from available filenames in shared/assets/ingredients.
2. Send Gemini:
   - raw ingredient list,
   - ingredient-image catalog,
   - normalization and matching instructions,
   - canonical response schema.
3. Gemini normalizes ingredient names and units, then assigns image filenames.
4. Backend validates Gemini output:
   - image filename exists in catalog or equals INGREDIENT_NOT_FOUND.png,
   - name and amount_text are non-empty,
   - output conforms to canonical schema.

## Normalization Rules for Gemini
1. Ingredient names must be title case.
2. Remove preparation details from ingredient name when they describe processing only.
   - Example: red onions, finely chopped -> Red Onions
   - Example: medium avocado, cubed -> Medium Avocado
3. Keep product-form identity in name when the ingredient is sold in that form.
   - Example: can of crushed tomatoes -> Crushed Tomatoes
4. Normalize units to short forms where possible:
   - pounds -> lbs
   - tablespoons -> tbsp
   - teaspoons -> tsp
   - ounces -> oz
   - grams -> g
   - milliliters -> ml
5. Preserve ingredient order from source recipe.

## Matching Rules for Gemini
1. Choose the closest semantic asset filename from the provided catalog.
2. Do not invent new filenames.
3. If uncertain or no close match exists, set image to INGREDIENT_NOT_FOUND.png.
4. Prefer specific matches over generic matches when confidence is high.

## Determinism Rules
- Gemini prompt version must be fixed per release.
- For the same input and same catalog, backend should request deterministic output settings where available.
- Backend must reject non-catalog filenames.

## Post-Processing
1. Keep the bare catalog filename in the canonical recipe (path/URL resolution is a frontend concern, see Output section).
2. Add warning entries (metadata.warnings strings) for INGREDIENT_NOT_FOUND.png matches and for coerced non-catalog filenames.
3. Keep unmatched ingredients valid for downstream rendering.

## Failure Behavior
- Matching never fails an ingestion request that already produced a valid recipe.
- One retry with the configured retry model on a failed matching call (error, unparseable output, or count/order mismatch).
- If the retry also fails, every ingredient gets INGREDIENT_NOT_FOUND.png and a single warning is added.

## Acceptance Criteria
- Gemini response conforms to schema and filename constraints.
- Ingredient naming and unit formatting follow normalization rules.
- Unknown ingredients reliably map to INGREDIENT_NOT_FOUND.png.
- Rendering never fails when unmatched ingredients are present.