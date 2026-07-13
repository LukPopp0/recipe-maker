import { describe, expect, it } from 'vitest';
import { cleanHtmlForExtraction } from './html-cleaner.js';

const BASE_URL = 'https://example.com/recipes/lasagna';

describe('cleanHtmlForExtraction', () => {
  it('strips script and style tags from the extracted text', () => {
    const html = `
      <html>
        <head><style>.a { color: red; }</style></head>
        <body>
          <script>console.log('should not appear')</script>
          <p>Mix flour and water.</p>
          <style>body { margin: 0; }</style>
        </body>
      </html>
    `;

    const result = cleanHtmlForExtraction(html, 1000, BASE_URL);

    expect(result.cleanedText).toContain('Mix flour and water.');
    expect(result.cleanedText).not.toContain('console.log');
    expect(result.cleanedText).not.toContain('color: red');
    expect(result.cleanedText).not.toContain('margin: 0');
  });

  it('strips noscript and comment content', () => {
    const html = `
      <html><body>
        <noscript>Enable JavaScript</noscript>
        <!-- a hidden comment -->
        <p>Visible recipe text.</p>
      </body></html>
    `;

    const result = cleanHtmlForExtraction(html, 1000, BASE_URL);

    expect(result.cleanedText).toContain('Visible recipe text.');
    expect(result.cleanedText).not.toContain('Enable JavaScript');
    expect(result.cleanedText).not.toContain('hidden comment');
  });

  it('collapses whitespace in the extracted text', () => {
    const html = '<html><body><p>Step   one.\n\n\tStep  two.</p></body></html>';

    const result = cleanHtmlForExtraction(html, 1000, BASE_URL);

    expect(result.cleanedText).toBe('Step one. Step two.');
  });

  it('prefers the largest contiguous block inside <article> over surrounding chrome', () => {
    const html = `
      <html><body>
        <nav>Home About Contact</nav>
        <article><p>${'Recipe body text. '.repeat(50)}</p></article>
        <footer>Copyright 2026</footer>
      </body></html>
    `;

    const result = cleanHtmlForExtraction(html, 5000, BASE_URL);

    expect(result.cleanedText).toContain('Recipe body text.');
    expect(result.cleanedText).not.toContain('Home About Contact');
    expect(result.cleanedText).not.toContain('Copyright 2026');
  });

  it('extracts og:image content resolved to an absolute URL', () => {
    const html = `
      <html><head>
        <meta property="og:image" content="/images/hero.jpg" />
      </head><body></body></html>
    `;

    const result = cleanHtmlForExtraction(html, 1000, BASE_URL);

    expect(result.candidateImages).toContainEqual({ url: 'https://example.com/images/hero.jpg' });
  });

  it('extracts twitter:image content', () => {
    const html = `
      <html><head>
        <meta name="twitter:image" content="https://cdn.example.com/twit.jpg" />
      </head><body></body></html>
    `;

    const result = cleanHtmlForExtraction(html, 1000, BASE_URL);

    expect(result.candidateImages).toContainEqual({ url: 'https://cdn.example.com/twit.jpg' });
  });

  it('resolves relative <img> src values to absolute URLs', () => {
    const html = `
      <html><body>
        <img src="../assets/step1.jpg" />
        <img src="https://cdn.example.com/absolute.jpg" />
      </body></html>
    `;

    const result = cleanHtmlForExtraction(html, 1000, BASE_URL);

    expect(result.candidateImages).toContainEqual({ url: 'https://example.com/assets/step1.jpg' });
    expect(result.candidateImages).toContainEqual({ url: 'https://cdn.example.com/absolute.jpg' });
  });

  it('carries <img> alt text along as a step-mapping hint', () => {
    const html = `
      <html><body>
        <img src="https://cdn.example.com/step2.jpg" alt="  browning   the beef " />
        <img src="https://cdn.example.com/plain.jpg" alt="" />
      </body></html>
    `;

    const result = cleanHtmlForExtraction(html, 1000, BASE_URL);

    expect(result.candidateImages).toContainEqual({
      url: 'https://cdn.example.com/step2.jpg',
      alt: 'browning the beef',
    });
    expect(result.candidateImages).toContainEqual({ url: 'https://cdn.example.com/plain.jpg' });
  });

  it('reads lazy-load attributes (data-src, srcset) when src is absent', () => {
    const html = `
      <html><body>
        <img data-src="https://cdn.example.com/lazy.jpg" />
        <img data-lazy-src="https://cdn.example.com/lazier.jpg" />
        <img srcset="https://cdn.example.com/small.jpg 480w, https://cdn.example.com/large.jpg 1024w" />
      </body></html>
    `;

    const result = cleanHtmlForExtraction(html, 1000, BASE_URL);
    const urls = result.candidateImages.map((img) => img.url);

    expect(urls).toContain('https://cdn.example.com/lazy.jpg');
    expect(urls).toContain('https://cdn.example.com/lazier.jpg');
    expect(urls).toContain('https://cdn.example.com/small.jpg');
  });

  it('skips data: URIs, SVGs, and tiny icon-sized images', () => {
    const html = `
      <html><body>
        <img src="data:image/png;base64,AAAA" />
        <img src="https://cdn.example.com/sprite.svg" />
        <img src="https://cdn.example.com/icon.jpg" width="32" height="32" />
        <img src="https://cdn.example.com/photo.jpg" width="800" height="600" />
      </body></html>
    `;

    const result = cleanHtmlForExtraction(html, 1000, BASE_URL);
    const urls = result.candidateImages.map((img) => img.url);

    expect(urls).toEqual(['https://cdn.example.com/photo.jpg']);
  });

  it('deduplicates candidate image URLs', () => {
    const html = `
      <html><head>
        <meta property="og:image" content="https://cdn.example.com/hero.jpg" />
      </head><body>
        <img src="https://cdn.example.com/hero.jpg" />
        <img src="https://cdn.example.com/hero.jpg" />
      </body></html>
    `;

    const result = cleanHtmlForExtraction(html, 1000, BASE_URL);

    expect(result.candidateImages).toEqual([{ url: 'https://cdn.example.com/hero.jpg' }]);
  });

  it('caps candidate images at 30', () => {
    const imgs = Array.from({ length: 40 }, (_, i) => `<img src="https://cdn.example.com/${i}.jpg" />`).join('\n');
    const html = `<html><body>${imgs}</body></html>`;

    const result = cleanHtmlForExtraction(html, 1000, BASE_URL);

    expect(result.candidateImages).toHaveLength(30);
  });

  it('ignores empty/missing img src values without throwing', () => {
    const html = '<html><body><img src="" /><img /></body></html>';

    expect(() => cleanHtmlForExtraction(html, 1000, BASE_URL)).not.toThrow();
    const result = cleanHtmlForExtraction(html, 1000, BASE_URL);

    expect(result.candidateImages).toEqual([]);
  });

  it('extracts the title from <title>', () => {
    const html = '<html><head><title>  Best Lasagna Ever  </title></head><body></body></html>';

    const result = cleanHtmlForExtraction(html, 1000, BASE_URL);

    expect(result.titleHint).toBe('Best Lasagna Ever');
  });

  it('falls back to og:title when <title> is absent', () => {
    const html = `
      <html><head>
        <meta property="og:title" content="Fallback Title" />
      </head><body></body></html>
    `;

    const result = cleanHtmlForExtraction(html, 1000, BASE_URL);

    expect(result.titleHint).toBe('Fallback Title');
  });

  it('returns null titleHint when neither title nor og:title is present', () => {
    const html = '<html><body><p>No title here.</p></body></html>';

    const result = cleanHtmlForExtraction(html, 1000, BASE_URL);

    expect(result.titleHint).toBeNull();
  });

  it('truncates long input to the character budget', () => {
    const longText = 'word '.repeat(5000);
    const html = `<html><body><p>${longText}</p></body></html>`;

    const result = cleanHtmlForExtraction(html, 100, BASE_URL);

    expect(result.cleanedText.length).toBeLessThanOrEqual(100);
  });

  it('surfaces schema.org Recipe JSON-LD while keeping script text out of cleanedText', () => {
    const recipe = { '@type': 'Recipe', name: 'Oats', recipeIngredient: ['1 cup oats'] };
    const html = `<html><head><script type="application/ld+json">${JSON.stringify(recipe)}</script></head>
      <body><p>Visible page text about oats.</p></body></html>`;

    const result = cleanHtmlForExtraction(html, 5000, BASE_URL);

    expect(result.recipeJsonLd).toMatchObject({ name: 'Oats' });
    expect(result.cleanedText).not.toContain('@type');
    expect(result.cleanedText).toContain('Visible page text');
  });

  it('counts JSON-LD length against the character budget before slicing cleanedText', () => {
    const recipe = { '@type': 'Recipe', name: 'Oats', recipeIngredient: ['1 cup oats'] };
    const jsonLdChars = JSON.stringify(recipe).length;
    const html = `<html><head><script type="application/ld+json">${JSON.stringify(recipe)}</script></head>
      <body><p>${'word '.repeat(1000)}</p></body></html>`;

    const budget = jsonLdChars + 50;
    const result = cleanHtmlForExtraction(html, budget, BASE_URL);

    expect(result.recipeJsonLd).not.toBeNull();
    expect(result.cleanedText.length).toBeLessThanOrEqual(50);
  });

  it('handles empty HTML without throwing', () => {
    expect(() => cleanHtmlForExtraction('', 1000, BASE_URL)).not.toThrow();
    const result = cleanHtmlForExtraction('', 1000, BASE_URL);
    expect(result).toEqual({ cleanedText: '', candidateImages: [], titleHint: null, recipeJsonLd: null });
  });

  it('handles malformed HTML without throwing', () => {
    const malformed = '<html><body><p>Unclosed tag <div>nested</p></body>';

    expect(() => cleanHtmlForExtraction(malformed, 1000, BASE_URL)).not.toThrow();
    const result = cleanHtmlForExtraction(malformed, 1000, BASE_URL);
    expect(result.cleanedText).toContain('Unclosed tag');
  });

  it('inserts a text boundary between adjacent block elements with no whitespace in the source', () => {
    const html = '<html><body><article><p>A</p><p>B</p><div>C</div><span>D</span></article></body></html>';

    const result = cleanHtmlForExtraction(html, 1000, BASE_URL);

    expect(result.cleanedText).toBe('A B C D');
  });

  it('inserts a text boundary between minified list items', () => {
    const html = '<html><body><article><ul><li>Flour</li><li>Water</li></ul></article></body></html>';

    const result = cleanHtmlForExtraction(html, 1000, BASE_URL);

    expect(result.cleanedText).toBe('Flour Water');
  });

  it('handles HTML with no body without throwing', () => {
    const html = '<html><head><title>Only Head</title></head></html>';

    expect(() => cleanHtmlForExtraction(html, 1000, BASE_URL)).not.toThrow();
    const result = cleanHtmlForExtraction(html, 1000, BASE_URL);
    expect(result.titleHint).toBe('Only Head');
  });
});
