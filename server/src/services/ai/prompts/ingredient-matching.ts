import type { RawIngredient } from '../../post-processing/index.js';

// Compact description of the output shape (specs/08). A JSON array, same
// length and order as the input ingredient list.
const OUTPUT_SHAPE = `[{
  "name": string (title case),
  "amount_text": string,
  "unit"?: string (short form),
  "image": string (a filename from the catalog below, or "INGREDIENT_NOT_FOUND.png")
}]`;

const INSTRUCTIONS = `You are matching recipe ingredients to a catalog of ingredient image filenames.
Output ONLY a single JSON array matching this shape exactly (field names must match
exactly), with the same length and same order as the input ingredient list:

<output_schema>
${OUTPUT_SHAPE}
</output_schema>

Rules:
- Title-case each ingredient "name".
- Strip preparation-only details from the name (e.g. "red onions, finely chopped" ->
  "Red Onions") but keep product-form identity (e.g. "can of crushed tomatoes" ->
  "Crushed Tomatoes").
- Shorten units to their short form: pounds -> lbs, tablespoons -> tbsp,
  teaspoons -> tsp, ounces -> oz, grams -> g, milliliters -> ml.
- Preserve the input order exactly - the output array must have the same length and
  same order as the input list.
- For "image", choose the closest semantic filename from the catalog below.
- Never invent filenames that are not in the catalog.
- Prefer a specific catalog filename over a generic one when confident of the match.
- If uncertain or there is no close match, use "INGREDIENT_NOT_FOUND.png".`;

export interface BuildIngredientMatchingPromptParams {
  ingredients: RawIngredient[]
  catalogFilenames: readonly string[]
}

export function buildIngredientMatchingPrompt({
  ingredients,
  catalogFilenames,
}: BuildIngredientMatchingPromptParams): string {
  const ingredientsJson = JSON.stringify(
    ingredients.map(({ name, amount_text, unit }) => ({ name, amount_text, unit })),
  );

  return `${INSTRUCTIONS}

Ingredients:
<ingredients>
${ingredientsJson}
</ingredients>

Catalog filenames:
<catalog>
${catalogFilenames.join('\n')}
</catalog>

Return only the JSON object, no surrounding text or markdown fences.`;
}
