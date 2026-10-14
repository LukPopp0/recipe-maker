import { pantryCanonicalName } from 'shared';

// Raw ingredient as produced by Gemini extraction, before schema validation.
// Same shape as the canonical Ingredient but treated as untrusted input.
export interface RawIngredient {
  name: string
  amount_text: string
  amount_value?: number
  unit?: string
  image?: string
}

/**
 * Routes pantry-staple ingredients out of the ingredients list and into a
 * deduplicated pantry_items list (specs/02 conflict rule + normalization rule
 * "lowercase matching keys but preserve display form").
 *
 * - Matching uses `pantryCanonicalName` (shared): type variants count as their
 *   staple ("Kosher salt" is salt), so they route and dedupe together.
 * - `modelPantryItems` (the model's own pantry_items) come first; any that are
 *   not staples move back to the end of `ingredients` with an empty amount and
 *   a warning, so the deterministic list is the only pantry definition.
 * - `pantry_items` keeps the first-seen display form, deduped by pantry item.
 * - Ingredient order is preserved for the non-pantry remainder.
 */
export function classifyPantryItems(
  ingredients: RawIngredient[],
  modelPantryItems: string[] = [],
): {
  ingredients: RawIngredient[]
  pantry_items: string[]
  warnings: string[]
} {
  const remaining: RawIngredient[] = [];
  const pantryItems: string[] = [];
  const movedBack: RawIngredient[] = [];
  const warnings: string[] = [];
  const seenItems = new Set<string>();

  const addPantryItem = (name: string, item: string) => {
    if (!seenItems.has(item)) {
      seenItems.add(item);
      pantryItems.push(name);
    }
  };

  for (const raw of modelPantryItems) {
    const name = (raw ?? '').trim();
    if (!name) continue;
    const item = pantryCanonicalName(name);
    if (item) {
      addPantryItem(name, item);
    } else {
      movedBack.push({ name, amount_text: '' });
      warnings.push(`'${name}' is not a pantry staple; moved to ingredients without an amount.`);
    }
  }

  for (const ingredient of ingredients) {
    const name = (ingredient.name ?? '').trim();
    const item = name ? pantryCanonicalName(name) : null;
    if (item) {
      addPantryItem(name, item);
      continue;
    }
    remaining.push(ingredient);
  }

  return { ingredients: [...remaining, ...movedBack], pantry_items: pantryItems, warnings };
}
