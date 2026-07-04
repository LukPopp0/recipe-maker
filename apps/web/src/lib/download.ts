// Client-side "download as JSON" helper, used when the user wants a local
// copy of a recipe without going through the server's own download route.

// Slugifies a recipe title for use in a filename: lowercase, non-alphanumeric
// runs collapsed to a single hyphen, leading/trailing hyphens trimmed. Falls
// back to "recipe" if the title slugifies to empty (e.g. all punctuation).
// Mirrors server/src/routes/recipe.ts's slugifyTitle so filenames match.
export function slugifyTitle(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug.length > 0 ? slug : 'recipe';
}

function pad2(value: number): string {
  return value.toString().padStart(2, '0');
}

// Builds "recipe-{slug}-{YYYYMMDD}.json". `date` is injectable so callers
// (and tests) get deterministic filenames instead of depending on "now".
export function buildRecipeFilename(title: string, date: Date = new Date()): string {
  const slug = slugifyTitle(title);
  const stamp = `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`;

  return `recipe-${slug}-${stamp}.json`;
}

// Triggers a browser download of `payload` as pretty-printed JSON, via a
// throwaway Blob object URL and a synthetic anchor click.
export function downloadJson(filename: string, payload: unknown): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();

  URL.revokeObjectURL(url);
}
