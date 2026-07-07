// Render-time bolding of ingredient mentions in step descriptions (specs/10).
// The schema stores plain text; this only affects display. Whole-word,
// case-insensitive, longest name first so "olive oil" wins over "oil", with
// a cheap s/es plural suffix. Misses are acceptable - this is decoration.
export type TextSegment = { text: string; bold: boolean };

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function emphasizeIngredients(description: string, ingredientNames: string[]): TextSegment[] {
  if (description.length === 0) return [];

  const names = ingredientNames
    .map((name) => name.trim())
    .filter((name) => name.length > 0)
    .sort((a, b) => b.length - a.length);
  if (names.length === 0) return [{ text: description, bold: false }];

  const pattern = new RegExp(`\\b(?:${names.map(escapeRegExp).join('|')})(?:es|s)?\\b`, 'gi');
  const segments: TextSegment[] = [];
  let last = 0;
  for (const match of description.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) segments.push({ text: description.slice(last, index), bold: false });
    segments.push({ text: match[0], bold: true });
    last = index + match[0].length;
  }
  if (last < description.length) segments.push({ text: description.slice(last), bold: false });
  return segments;
}
