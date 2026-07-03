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
    const html = `<html><body><p>Step   one.\n\n\tStep  two.</p></body></html>`;

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

    expect(result.candidateImageUrls).toContain('https://example.com/images/hero.jpg');
  });

  it('extracts twitter:image content', () => {
    const html = `
      <html><head>
        <meta name="twitter:image" content="https://cdn.example.com/twit.jpg" />
      </head><body></body></html>
    `;

    const result = cleanHtmlForExtraction(html, 1000, BASE_URL);

    expect(result.candidateImageUrls).toContain('https://cdn.example.com/twit.jpg');
  });

  it('resolves relative <img> src values to absolute URLs', () => {
    const html = `
      <html><body>
        <img src="../assets/step1.jpg" />
        <img src="https://cdn.example.com/absolute.jpg" />
      </body></html>
    `;

    const result = cleanHtmlForExtraction(html, 1000, BASE_URL);

    expect(result.candidateImageUrls).toContain('https://example.com/assets/step1.jpg');
    expect(result.candidateImageUrls).toContain('https://cdn.example.com/absolute.jpg');
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

    expect(result.candidateImageUrls).toEqual(['https://cdn.example.com/hero.jpg']);
  });

  it('caps candidate image URLs at 10', () => {
    const imgs = Array.from({ length: 15 }, (_, i) => `<img src="https://cdn.example.com/${i}.jpg" />`).join('\n');
    const html = `<html><body>${imgs}</body></html>`;

    const result = cleanHtmlForExtraction(html, 1000, BASE_URL);

    expect(result.candidateImageUrls).toHaveLength(10);
  });

  it('ignores empty/missing img src values without throwing', () => {
    const html = `<html><body><img src="" /><img /></body></html>`;

    expect(() => cleanHtmlForExtraction(html, 1000, BASE_URL)).not.toThrow();
    const result = cleanHtmlForExtraction(html, 1000, BASE_URL);

    expect(result.candidateImageUrls).toEqual([]);
  });

  it('extracts the title from <title>', () => {
    const html = `<html><head><title>  Best Lasagna Ever  </title></head><body></body></html>`;

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
    const html = `<html><body><p>No title here.</p></body></html>`;

    const result = cleanHtmlForExtraction(html, 1000, BASE_URL);

    expect(result.titleHint).toBeNull();
  });

  it('truncates long input to the character budget', () => {
    const longText = 'word '.repeat(5000);
    const html = `<html><body><p>${longText}</p></body></html>`;

    const result = cleanHtmlForExtraction(html, 100, BASE_URL);

    expect(result.cleanedText.length).toBeLessThanOrEqual(100);
  });

  it('handles empty HTML without throwing', () => {
    expect(() => cleanHtmlForExtraction('', 1000, BASE_URL)).not.toThrow();
    const result = cleanHtmlForExtraction('', 1000, BASE_URL);
    expect(result).toEqual({ cleanedText: '', candidateImageUrls: [], titleHint: null });
  });

  it('handles malformed HTML without throwing', () => {
    const malformed = '<html><body><p>Unclosed tag <div>nested</p></body>';

    expect(() => cleanHtmlForExtraction(malformed, 1000, BASE_URL)).not.toThrow();
    const result = cleanHtmlForExtraction(malformed, 1000, BASE_URL);
    expect(result.cleanedText).toContain('Unclosed tag');
  });

  it('inserts a text boundary between adjacent block elements with no whitespace in the source', () => {
    const html = `<html><body><article><p>A</p><p>B</p><div>C</div><span>D</span></article></body></html>`;

    const result = cleanHtmlForExtraction(html, 1000, BASE_URL);

    expect(result.cleanedText).toBe('A B C D');
  });

  it('inserts a text boundary between minified list items', () => {
    const html = `<html><body><article><ul><li>Flour</li><li>Water</li></ul></article></body></html>`;

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
