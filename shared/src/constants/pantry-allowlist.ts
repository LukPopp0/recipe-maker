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
  'water',
];

/**
 * Accepted names per pantry item, keyed by the item. A variant that only names
 * the type of the same staple counts as that staple ("kosher salt" is still
 * salt); different products stay out ("brown sugar", "red pepper flakes",
 * "buttermilk"). Explicit lists, not word stripping, so "bell pepper" and
 * "garlic salt" can never match. The first entry of each list is the item.
 */
export const PANTRY_VARIANTS: Readonly<Record<string, readonly string[]>> = {
  salt: [
    'salt', 'kosher salt', 'sea salt', 'table salt', 'fine salt', 'coarse salt',
    'flaky salt', 'fine sea salt', 'coarse sea salt', 'flaky sea salt',
  ],
  pepper: [
    'pepper', 'black pepper', 'ground black pepper', 'freshly ground black pepper',
    'ground pepper', 'freshly ground pepper', 'cracked black pepper',
  ],
  sugar: ['sugar', 'granulated sugar', 'white sugar'],
  butter: ['butter', 'unsalted butter', 'salted butter'],
  'olive oil': ['olive oil', 'extra virgin olive oil'],
  'vegetable oil': ['vegetable oil'],
  milk: ['milk', 'whole milk'],
  flour: ['flour', 'all purpose flour', 'plain flour'],
  water: ['water', 'cold water', 'warm water', 'hot water', 'lukewarm water', 'boiling water'],
};

// Lowercase, hyphens as spaces, single spaces ("Extra-Virgin  Olive Oil" ->
// "extra virgin olive oil").
function normalizePantryName(name: string): string {
  return name.toLowerCase().replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
}

const VARIANT_TO_ITEM = new Map<string, string>(
  Object.entries(PANTRY_VARIANTS).flatMap(([item, variants]) =>
    variants.map((variant): [string, string] => [variant, item]),
  ),
);

/**
 * Returns the pantry item a name belongs to ("Kosher Salt" -> "salt"), or null
 * when it is not a pantry staple. Case-, hyphen- and whitespace-insensitive.
 */
export function pantryCanonicalName(name: string): string | null {
  if (!name) return null;
  return VARIANT_TO_ITEM.get(normalizePantryName(name)) ?? null;
}

/**
 * Check if an ingredient name is a pantry staple (see PANTRY_VARIANTS).
 * The "oil" entry matches olive oil and vegetable oil but not other oils.
 */
export function isPantryItem(normalizedName: string): boolean {
  return pantryCanonicalName(normalizedName) !== null;
}
