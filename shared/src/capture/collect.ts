// Must stay self-contained: the extension serializes it via scripting.executeScript({ func }).
export function collectCapture(doc: Document = document): { url: string; html: string; mainImageUrl?: string } {
  const base = doc.location.href;

  const firstImage = (img: unknown): string | undefined => {
    if (typeof img === 'string') return img || undefined;
    if (Array.isArray(img)) {
      for (const item of img) {
        const found = firstImage(item);
        if (found) return found;
      }
      return undefined;
    }
    if (img && typeof img === 'object') {
      const o = img as Record<string, unknown>;
      if (typeof o.url === 'string' && o.url) return o.url;
      if (typeof o['@id'] === 'string' && o['@id']) return o['@id'];
    }
    return undefined;
  };

  const isRecipe = (t: unknown): boolean =>
    t === 'Recipe' || (Array.isArray(t) && t.includes('Recipe'));

  const findRecipe = (node: unknown): Record<string, unknown> | undefined => {
    if (Array.isArray(node)) {
      for (const item of node) {
        const found = findRecipe(item);
        if (found) return found;
      }
      return undefined;
    }
    if (node && typeof node === 'object') {
      const o = node as Record<string, unknown>;
      if (isRecipe(o['@type'])) return o;
      if (o['@graph']) return findRecipe(o['@graph']);
    }
    return undefined;
  };

  let raw: string | undefined;
  const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
  for (const script of Array.from(scripts)) {
    try {
      const recipe = findRecipe(JSON.parse(script.textContent ?? ''));
      const img = recipe ? firstImage(recipe.image) : undefined;
      if (img) {
        raw = img;
        break;
      }
    } catch {
      // invalid JSON-LD: ignore
    }
  }
  if (!raw) {
    const og = doc.querySelector('meta[property="og:image"]')?.getAttribute('content');
    if (og) raw = og;
  }

  let mainImageUrl: string | undefined;
  if (raw) {
    try {
      mainImageUrl = new URL(raw, base).toString();
    } catch {
      mainImageUrl = undefined;
    }
  }

  const result: { url: string; html: string; mainImageUrl?: string } = {
    url: base,
    html: doc.documentElement.outerHTML,
  };
  if (mainImageUrl) result.mainImageUrl = mainImageUrl;
  return result;
}
