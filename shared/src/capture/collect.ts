// Must stay self-contained: the extension serializes it via scripting.executeScript({ func }).
export function collectCapture(doc: Document = document): { url: string; html: string; mainImageUrl?: string } {
  const base = doc.location.href;
  const byId = new Map<string, Record<string, unknown>>();

  const indexNodes = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(indexNodes);
    } else if (node && typeof node === 'object') {
      const o = node as Record<string, unknown>;
      if (typeof o['@id'] === 'string' && !byId.has(o['@id'])) byId.set(o['@id'], o);
      if (o['@graph']) indexNodes(o['@graph']);
    }
  };

  const firstImage = (img: unknown, depth = 0): string | undefined => {
    if (depth > 5) return undefined;
    if (typeof img === 'string') return img || undefined;
    if (Array.isArray(img)) {
      for (const item of img) {
        const found = firstImage(item, depth + 1);
        if (found) return found;
      }
      return undefined;
    }
    if (img && typeof img === 'object') {
      const o = img as Record<string, unknown>;
      if (typeof o.url === 'string' && o.url) return o.url;
      if (typeof o.contentUrl === 'string' && o.contentUrl) return o.contentUrl;
      if (typeof o['@id'] === 'string') {
        const target = byId.get(o['@id']);
        if (target && target !== o) return firstImage(target, depth + 1);
      }
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

  const toHttpUrl = (raw: string | undefined): string | undefined => {
    if (!raw) return undefined;
    try {
      const u = new URL(raw, base);
      return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : undefined;
    } catch {
      return undefined;
    }
  };

  const parsed: unknown[] = [];
  for (const script of Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))) {
    try {
      const data = JSON.parse(script.textContent ?? '');
      parsed.push(data);
      indexNodes(data);
    } catch {
      // invalid JSON-LD: ignore
    }
  }

  let mainImageUrl: string | undefined;
  for (const data of parsed) {
    const recipe = findRecipe(data);
    mainImageUrl = recipe ? toHttpUrl(firstImage(recipe.image)) : undefined;
    if (mainImageUrl) break;
  }
  if (!mainImageUrl) {
    mainImageUrl = toHttpUrl(doc.querySelector('meta[property="og:image"]')?.getAttribute('content') ?? undefined);
  }

  const result: { url: string; html: string; mainImageUrl?: string } = {
    url: base,
    html: doc.documentElement.outerHTML,
  };
  if (mainImageUrl) result.mainImageUrl = mainImageUrl;
  return result;
}
