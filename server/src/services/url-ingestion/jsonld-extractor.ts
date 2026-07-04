import type { HTMLElement } from 'node-html-parser';

// Maximum nesting depth when searching parsed JSON-LD for a Recipe node.
// Real-world documents nest Recipe at most a couple of levels deep
// (top-level, array entry, @graph entry); the cap guards against
// pathological/adversarial structures.
const MAX_SEARCH_DEPTH = 4;

// Returns true when a parsed JSON-LD node declares the schema.org Recipe
// type, handling "@type" as a plain string or an array of strings
// (e.g. "@type": ["Recipe", "NewsArticle"]).
function isRecipeNode(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const type = (value as Record<string, unknown>)['@type'];
  if (typeof type === 'string') return type === 'Recipe';
  if (Array.isArray(type)) return type.includes('Recipe');
  return false;
}

// Depth-limited search for a Recipe node inside a parsed JSON-LD value,
// covering the shapes recipe sites actually publish: a top-level Recipe
// object, a top-level array of nodes, and nodes wrapped in a "@graph" array.
function findRecipeNode(value: unknown, depth: number): Record<string, unknown> | null {
  if (depth > MAX_SEARCH_DEPTH) return null;

  if (isRecipeNode(value)) return value;

  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findRecipeNode(entry, depth + 1);
      if (found) return found;
    }
    return null;
  }

  if (typeof value === 'object' && value !== null) {
    const graph = (value as Record<string, unknown>)['@graph'];
    if (graph !== undefined) {
      return findRecipeNode(graph, depth + 1);
    }
  }

  return null;
}

// Extracts the first schema.org Recipe node from the page's
// <script type="application/ld+json"> blocks, if any. SEO-driven recipe
// sites embed complete structured recipe data this way in the initial HTML -
// even when the visible DOM is rendered client-side - making it the highest
// quality extraction input available. Must run on the parsed tree BEFORE
// script tags are stripped for text extraction. Never throws: malformed
// JSON blocks are skipped individually.
export function extractRecipeJsonLd(root: HTMLElement): Record<string, unknown> | null {
  for (const script of root.querySelectorAll('script[type="application/ld+json"]')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(script.text);
    } catch {
      continue;
    }

    const recipe = findRecipeNode(parsed, 0);
    if (recipe) return recipe;
  }

  return null;
}
