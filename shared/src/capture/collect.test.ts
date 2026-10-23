// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { collectCapture } from './collect.js';

const ld = (json: string) => `<script type="application/ld+json">${json}</script>`;
const abs = (p: string) => new URL(p, document.location.href).toString();

describe('collectCapture', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '<p>hi</p>';
  });

  it('takes the main image from Recipe JSON-LD before og:image and makes it absolute', () => {
    document.head.innerHTML =
      '<meta property="og:image" content="https://x/og.jpg">' +
      ld('{"@graph":[{"@type":"Recipe","image":["/thmb/main.jpg"]}]}');
    expect(collectCapture(document).mainImageUrl).toBe(abs('/thmb/main.jpg'));
  });

  it('falls back to og:image', () => {
    document.head.innerHTML = '<meta property="og:image" content="/og.jpg">';
    expect(collectCapture(document).mainImageUrl).toBe(abs('/og.jpg'));
  });

  it('handles ImageObject images and @type arrays', () => {
    document.head.innerHTML = ld('{"@type":["Recipe","NewsArticle"],"image":{"url":"https://x/a.jpg"}}');
    expect(collectCapture(document).mainImageUrl).toBe('https://x/a.jpg');
  });

  it('omits mainImageUrl when the page has none, and survives invalid JSON-LD', () => {
    document.head.innerHTML = ld('{not json');
    const result = collectCapture(document);
    expect(result.mainImageUrl).toBeUndefined();
    expect('mainImageUrl' in result).toBe(false);
  });

  it('returns the full outerHTML and location.href', () => {
    const result = collectCapture(document);
    expect(result.html).toBe(document.documentElement.outerHTML);
    expect(result.url).toBe(document.location.href);
  });

  it('works when serialized and rebuilt from its source text', () => {
    document.head.innerHTML = '<meta property="og:image" content="https://x/og.jpg">';
    const rebuilt = new Function(`return (${collectCapture.toString()})`)();
    expect(rebuilt(document).url).toBe(document.location.href);
    expect(rebuilt(document).mainImageUrl).toBe('https://x/og.jpg');
  });
});
