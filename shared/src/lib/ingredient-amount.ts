// Ingredient amount/unit dedupe. Gemini keeps amount_text as the source
// amount ("5 oz") while also emitting a short unit ("oz"), so naive
// "{amount_text} {unit}" rendering doubles the unit ("5 oz oz"). Both the
// frontend (render-time, covers already-saved recipes) and the server
// post-process (strips the redundant unit before save) share this check.

// Synonyms map to one canonical token so "1 lb" + unit "lbs" still matches.
const UNIT_SYNONYMS: Record<string, string> = {
  lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb',
  tbsp: 'tbsp', tbs: 'tbsp', tablespoon: 'tbsp', tablespoons: 'tbsp',
  tsp: 'tsp', teaspoon: 'tsp', teaspoons: 'tsp',
  oz: 'oz', ounce: 'oz', ounces: 'oz',
  g: 'g', gram: 'g', grams: 'g',
  kg: 'kg', kilogram: 'kg', kilograms: 'kg',
  ml: 'ml', milliliter: 'ml', milliliters: 'ml', millilitre: 'ml', millilitres: 'ml',
  l: 'l', liter: 'l', liters: 'l', litre: 'l', litres: 'l',
  cup: 'cup', cups: 'cup',
  pc: 'pc', pcs: 'pc', piece: 'pc', pieces: 'pc',
};

function canonicalUnit(token: string): string {
  const lower = token.toLowerCase();
  return UNIT_SYNONYMS[lower] ?? lower;
}

/**
 * True when amount_text already names the unit, as a standalone word or
 * attached to a number ("200g"). Letter runs are extracted so "g" never
 * matches inside "large".
 */
export function amountContainsUnit(amountText: string, unit: string): boolean {
  const trimmedUnit = unit.trim();
  if (trimmedUnit.length === 0) return false;
  const target = canonicalUnit(trimmedUnit);
  const tokens = amountText.toLowerCase().match(/[a-z]+/g) ?? [];
  return tokens.some((token) => canonicalUnit(token) === target);
}

/** Display form: amount plus unit, unless the amount already includes it. */
export function formatIngredientAmount(amountText: string, unit?: string): string {
  const amount = amountText.trim();
  const trimmedUnit = (unit ?? '').trim();
  if (trimmedUnit.length === 0 || amountContainsUnit(amount, trimmedUnit)) {
    return amount;
  }
  return amount.length > 0 ? `${amount} ${trimmedUnit}` : trimmedUnit;
}
