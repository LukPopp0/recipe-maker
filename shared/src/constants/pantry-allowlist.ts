/**
 * Pantry Allowlist - ingredients that are categorized as pantry staples
 * and routed to pantry_items instead of ingredients.
 *
 * Matching is case-insensitive and the "oil" entry matches both
 * "olive oil" and "vegetable oil" but no other oils.
 */
export const PANTRY_ALLOWLIST = [
  'salt',
  'pepper',
  'sugar',
  'butter',
  'oil (olive and vegetable)',
  'milk',
  'flour',
];

/**
 * Check if a normalized ingredient name is in the pantry allowlist.
 * Case-insensitive matching. The "oil" entry matches both "olive oil"
 * and "vegetable oil" but not other oils like sesame oil.
 */
export function isPantryItem(normalizedName: string): boolean {
  if (!normalizedName || normalizedName.trim() === '') {
    return false;
  }

  const lower = normalizedName.toLowerCase();

  // Special handling for oil: only match olive oil and vegetable oil
  if (lower === 'olive oil' || lower === 'vegetable oil') {
    return true;
  }

  // Check exact matches against the allowlist (case-insensitive)
  return PANTRY_ALLOWLIST.some(item => item.toLowerCase() === lower);
}
