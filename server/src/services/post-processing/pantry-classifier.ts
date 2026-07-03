import { isPantryItem } from 'shared'

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
 * - Matching is case-insensitive via `isPantryItem` (shared, Task 1).
 * - Matches are removed from `ingredients`.
 * - `pantry_items` keeps the first-seen display form, deduped by lowercase key.
 * - Ingredient order is preserved for the non-pantry remainder.
 */
export function classifyPantryItems(ingredients: RawIngredient[]): {
  ingredients: RawIngredient[]
  pantry_items: string[]
} {
  const remaining: RawIngredient[] = []
  const pantryItems: string[] = []
  const seenKeys = new Set<string>()

  for (const ingredient of ingredients) {
    const name = (ingredient.name ?? '').trim()

    if (name && isPantryItem(name)) {
      const key = name.toLowerCase()
      if (!seenKeys.has(key)) {
        seenKeys.add(key)
        pantryItems.push(name)
      }
      continue
    }

    remaining.push(ingredient)
  }

  return { ingredients: remaining, pantry_items: pantryItems }
}
