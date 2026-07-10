import type { RawIngredient } from './pantry-classifier.js';

// Preparation descriptors stripped when comparing ingredient names, so that
// "sliced green onions" and "green onions" collapse to one entry (phase 8.5
// item 6). Deliberately small and limited to words that describe how an
// ingredient is cut/prepared - never words that change identity (e.g. "red",
// "smoked", "green"), so "red onion" and "onion" stay distinct.
const PREP_PHRASES = [
  'freshly ground',
  'finely chopped',
  'roughly chopped',
  'thinly sliced',
  'finely diced',
  'finely grated',
];

const PREP_WORDS = new Set([
  'sliced',
  'chopped',
  'diced',
  'minced',
  'grated',
  'fresh',
  'ground',
  'shredded',
  'crushed',
  'halved',
  'quartered',
  'cubed',
  'peeled',
  'trimmed',
  'drained',
  'rinsed',
]);

// Reduce a display name to a comparison key: lowercased, punctuation flattened
// to spaces, with preparation words/phrases removed. Falls back to the plain
// cleaned name when stripping would leave nothing (e.g. the name was only a
// preparation word), so distinct items never collapse to an empty key.
function normalizeKey(name: string): string {
  const cleaned = (name ?? '')
    .toLowerCase()
    .replace(/[.,;()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  let text = cleaned;
  for (const phrase of PREP_PHRASES) {
    text = text.replace(new RegExp(`\\b${phrase}\\b`, 'g'), ' ');
  }

  const core = text.split(/\s+/).filter((word) => word.length > 0 && !PREP_WORDS.has(word));
  const key = core.join(' ');
  return key.length > 0 ? key : cleaned;
}

/**
 * Deterministic safety net for near-duplicate ingredients (phase 8.5 item 6),
 * run before image matching so the matcher sees a clean, shorter list.
 *
 * Two ingredients merge when their names are equal after preparation words are
 * stripped (see normalizeKey). The first occurrence's display name and amount
 * are kept; each dropped duplicate produces a metadata.warnings entry naming it
 * and its amount so the review UI surfaces the merge. No quantity arithmetic is
 * attempted (amount_text is freeform) - the first amount is kept as-is.
 */
export function dedupeIngredients(ingredients: RawIngredient[]): {
  ingredients: RawIngredient[]
  warnings: string[]
} {
  const kept: RawIngredient[] = [];
  const warnings: string[] = [];
  const keyToKept = new Map<string, RawIngredient>();

  for (const ingredient of ingredients) {
    const key = normalizeKey(ingredient.name ?? '');
    const existing = keyToKept.get(key);
    if (existing) {
      const droppedName = (ingredient.name ?? '').trim();
      const droppedAmount = (ingredient.amount_text ?? '').trim();
      warnings.push(
        `Merged duplicate ingredient "${droppedName}"` +
          (droppedAmount ? ` (${droppedAmount})` : '') +
          ` into "${(existing.name ?? '').trim()}"; kept the first amount.`,
      );
      continue;
    }
    keyToKept.set(key, ingredient);
    kept.push(ingredient);
  }

  return { ingredients: kept, warnings };
}
