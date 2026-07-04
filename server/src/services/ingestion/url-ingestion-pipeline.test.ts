import dns from 'node:dns';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../lib/errors.js';
import { loadServerEnv } from '../../env.js';
import { loadGeminiConfig } from '../ai/config.js';
import type { GenerateCanonicalRecipeParams } from '../ai/gemini-client.js';
import type { GeminiCanonicalRecipeGenerator } from './url-ingestion-pipeline.js';
import { runUrlIngestionPipeline } from './url-ingestion-pipeline.js';

const RECIPE_HTML = `
  <html>
    <head><title>Grandma's Lasagna</title></head>
    <body>
      <article>
        <h1>Grandma's Lasagna</h1>
        <p>A classic baked lasagna recipe passed down for generations, full of rich tomato sauce, layers of pasta, and melted cheese.</p>
        <ul>
          <li>500g lasagna sheets</li>
          <li>400g ground beef</li>
          <li>2 cups tomato sauce</li>
          <li>1 cup mozzarella cheese</li>
        </ul>
        <ol>
          <li>Boil the lasagna sheets until al dente.</li>
          <li>Brown the ground beef and mix with tomato sauce.</li>
          <li>Layer sheets, meat sauce, and cheese in a baking dish.</li>
          <li>Bake at 180C for 30 minutes until golden.</li>
        </ol>
      </article>
    </body>
  </html>
`;

const EMPTY_HTML = '<html><head><title>Untitled</title></head><body></body></html>';

const VALID_CANDIDATE = {
  title: 'Grandma\'s Lasagna',
  tags: [],
  time: 60,
  ingredients: [{ name: 'lasagna sheets', amount_text: '500g' }],
  pantry_items: [],
  main_image: '',
  steps: [{ step_header: 'Boil', step_description: 'Boil the lasagna sheets.' }],
  metadata: { source_type: 'url', source_url: 'https://example.com/lasagna', language: 'en', warnings: [] },
};

const GARBAGE_CANDIDATE = { foo: 'bar' };

function makeGeminiConfig() {
  return loadGeminiConfig({});
}

// Fallback disabled: these tests cover the static-fetch flow; the browser
// fallback path has its own dedicated tests below with a fake fetcher.
const STATIC_ENV = loadServerEnv({ BROWSER_FALLBACK_ENABLED: 'false' });

function fakeGeminiClient(
  handler: (params: GenerateCanonicalRecipeParams) => Promise<unknown>,
): GeminiCanonicalRecipeGenerator {
  return { generateCanonicalRecipe: handler };
}

describe('runUrlIngestionPipeline', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.spyOn(dns.promises, 'lookup').mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
    ] as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = originalFetch;
  });

  it('returns the primary result when the primary Gemini call succeeds', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(RECIPE_HTML));
    const generateCanonicalRecipe = vi.fn().mockResolvedValue(VALID_CANDIDATE);
    const geminiClient = fakeGeminiClient(generateCanonicalRecipe);

    const result = await runUrlIngestionPipeline({
      url: 'https://example.com/lasagna',
      geminiClient,
      geminiConfig: makeGeminiConfig(),
      env: STATIC_ENV,
      requestId: 'req-1',
    });

    expect(result.recipeCandidate).toBe(VALID_CANDIDATE);
    expect(result.diagnostics.extractor).toBe('gemini-primary');
    expect(result.diagnostics.model).toBe('gemini-2.5-pro');
    expect(result.diagnostics.durationMs).toBeGreaterThanOrEqual(0);
    expect(generateCanonicalRecipe).toHaveBeenCalledTimes(1);
  });

  it('falls back to the retry model when the primary call fails the structural pre-check', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(RECIPE_HTML));
    const generateCanonicalRecipe = vi
      .fn()
      .mockResolvedValueOnce(GARBAGE_CANDIDATE)
      .mockResolvedValueOnce(VALID_CANDIDATE);
    const geminiClient = fakeGeminiClient(generateCanonicalRecipe);

    const result = await runUrlIngestionPipeline({
      url: 'https://example.com/lasagna',
      geminiClient,
      geminiConfig: makeGeminiConfig(),
      env: STATIC_ENV,
      requestId: 'req-2',
    });

    expect(result.recipeCandidate).toBe(VALID_CANDIDATE);
    expect(result.diagnostics.extractor).toBe('gemini-retry');
    expect(result.diagnostics.model).toBe('gemini-2.5-flash');
    expect(generateCanonicalRecipe).toHaveBeenCalledTimes(2);
    expect(generateCanonicalRecipe.mock.calls[1][0].model).toBe('gemini-2.5-flash');
  });

  it('falls back to retry when the primary call throws', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(RECIPE_HTML));
    const generateCanonicalRecipe = vi
      .fn()
      .mockRejectedValueOnce(new AppError('AI_NORMALIZATION_FAILED', 'boom'))
      .mockResolvedValueOnce(VALID_CANDIDATE);
    const geminiClient = fakeGeminiClient(generateCanonicalRecipe);

    const result = await runUrlIngestionPipeline({
      url: 'https://example.com/lasagna',
      geminiClient,
      geminiConfig: makeGeminiConfig(),
      env: STATIC_ENV,
      requestId: 'req-3',
    });

    expect(result.diagnostics.extractor).toBe('gemini-retry');
  });

  it('throws URL_EXTRACTION_FAILED when both primary and retry fail', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(RECIPE_HTML));
    const generateCanonicalRecipe = vi.fn().mockResolvedValue(GARBAGE_CANDIDATE);
    const geminiClient = fakeGeminiClient(generateCanonicalRecipe);

    await expect(
      runUrlIngestionPipeline({
        url: 'https://example.com/lasagna',
        geminiClient,
        geminiConfig: makeGeminiConfig(),
        env: STATIC_ENV,
      requestId: 'req-4',
      }),
    ).rejects.toMatchObject({ code: 'URL_EXTRACTION_FAILED' });

    expect(generateCanonicalRecipe).toHaveBeenCalledTimes(2);
  });

  it('throws INVALID_URL for a blocked address before calling Gemini', async () => {
    const generateCanonicalRecipe = vi.fn();
    const geminiClient = fakeGeminiClient(generateCanonicalRecipe);

    await expect(
      runUrlIngestionPipeline({
        url: 'http://127.0.0.1/recipe',
        geminiClient,
        geminiConfig: makeGeminiConfig(),
        env: STATIC_ENV,
      requestId: 'req-5',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_URL' });

    expect(generateCanonicalRecipe).not.toHaveBeenCalled();
  });

  describe('JSON-LD and browser fallback', () => {
    const JSONLD_RECIPE = {
      '@type': 'Recipe',
      name: 'Overnight Oats',
      recipeIngredient: ['1 cup oats', '2 tbsp peanut butter'],
      recipeInstructions: [{ '@type': 'HowToStep', text: 'Mix and refrigerate overnight.' }],
    };

    // A JS-shell page: almost no visible text, no JSON-LD.
    const SHELL_HTML = '<html><head><title>App</title></head><body><div id="root"></div></body></html>';

    // The same page after client-side rendering: JSON-LD injected plus text.
    const RENDERED_HTML = `<html><head><title>Overnight Oats</title>
      <script type="application/ld+json">${JSON.stringify(JSONLD_RECIPE)}</script></head>
      <body><article><h1>Overnight Oats</h1><p>${'Mix oats with peanut butter. '.repeat(30)}</p></article></body></html>`;

    const JSONLD_STATIC_HTML = `<html><head><title>Overnight Oats</title>
      <script type="application/ld+json">${JSON.stringify(JSONLD_RECIPE)}</script></head>
      <body><div id="root"></div></body></html>`;

    const FALLBACK_ENV = loadServerEnv({});

    function fakeBrowserFetcher(html: string) {
      const fetchWithBrowser = vi.fn().mockResolvedValue({
        html,
        effectiveUrl: 'https://example.com/lasagna',
      });
      return { fetcher: { fetchWithBrowser }, fetchWithBrowser };
    }

    it('uses the browser fallback for a JS shell page and reports fetchMode browser', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(new Response(SHELL_HTML));
      const { fetcher, fetchWithBrowser } = fakeBrowserFetcher(RENDERED_HTML);
      const geminiClient = fakeGeminiClient(vi.fn().mockResolvedValue(VALID_CANDIDATE));

      const result = await runUrlIngestionPipeline({
        url: 'https://example.com/lasagna',
        geminiClient,
        geminiConfig: makeGeminiConfig(),
        env: FALLBACK_ENV,
        browserFetcher: fetcher,
        requestId: 'req-7',
      });

      expect(fetchWithBrowser).toHaveBeenCalledTimes(1);
      expect(result.diagnostics.fetchMode).toBe('browser');
      expect(result.diagnostics.usedJsonLd).toBe(true);
    });

    it('skips the browser fallback when the static HTML already has JSON-LD', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSONLD_STATIC_HTML));
      const { fetcher, fetchWithBrowser } = fakeBrowserFetcher(RENDERED_HTML);
      const geminiClient = fakeGeminiClient(vi.fn().mockResolvedValue(VALID_CANDIDATE));

      const result = await runUrlIngestionPipeline({
        url: 'https://example.com/lasagna',
        geminiClient,
        geminiConfig: makeGeminiConfig(),
        env: FALLBACK_ENV,
        browserFetcher: fetcher,
        requestId: 'req-8',
      });

      expect(fetchWithBrowser).not.toHaveBeenCalled();
      expect(result.diagnostics.fetchMode).toBe('static');
      expect(result.diagnostics.usedJsonLd).toBe(true);
    });

    it('skips the browser fallback when the static page has enough visible text', async () => {
      const richHtml = `<html><body><article><p>${'Real recipe content. '.repeat(50)}</p></article></body></html>`;
      globalThis.fetch = vi.fn().mockResolvedValue(new Response(richHtml));
      const { fetcher, fetchWithBrowser } = fakeBrowserFetcher(RENDERED_HTML);
      const geminiClient = fakeGeminiClient(vi.fn().mockResolvedValue(VALID_CANDIDATE));

      const result = await runUrlIngestionPipeline({
        url: 'https://example.com/lasagna',
        geminiClient,
        geminiConfig: makeGeminiConfig(),
        env: FALLBACK_ENV,
        browserFetcher: fetcher,
        requestId: 'req-9',
      });

      expect(fetchWithBrowser).not.toHaveBeenCalled();
      expect(result.diagnostics.fetchMode).toBe('static');
      expect(result.diagnostics.usedJsonLd).toBe(false);
    });

    it('skips the browser fallback when disabled via env', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(new Response(SHELL_HTML));
      const { fetcher, fetchWithBrowser } = fakeBrowserFetcher(RENDERED_HTML);
      const geminiClient = fakeGeminiClient(vi.fn());

      await expect(
        runUrlIngestionPipeline({
          url: 'https://example.com/lasagna',
          geminiClient,
          geminiConfig: makeGeminiConfig(),
          env: STATIC_ENV,
          browserFetcher: fetcher,
          requestId: 'req-10',
        }),
      ).rejects.toMatchObject({ code: 'URL_EXTRACTION_FAILED' });

      expect(fetchWithBrowser).not.toHaveBeenCalled();
    });

    it('keeps the static result and fails cleanly when the rendered page is not richer', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(new Response(SHELL_HTML));
      const { fetcher } = fakeBrowserFetcher(SHELL_HTML);
      const geminiClient = fakeGeminiClient(vi.fn());

      await expect(
        runUrlIngestionPipeline({
          url: 'https://example.com/lasagna',
          geminiClient,
          geminiConfig: makeGeminiConfig(),
          env: FALLBACK_ENV,
          browserFetcher: fetcher,
          requestId: 'req-11',
        }),
      ).rejects.toMatchObject({ code: 'URL_EXTRACTION_FAILED' });
    });
  });

  it('throws URL_EXTRACTION_FAILED for empty page content without calling Gemini', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(EMPTY_HTML));
    const generateCanonicalRecipe = vi.fn();
    const geminiClient = fakeGeminiClient(generateCanonicalRecipe);

    await expect(
      runUrlIngestionPipeline({
        url: 'https://example.com/empty',
        geminiClient,
        geminiConfig: makeGeminiConfig(),
        env: STATIC_ENV,
      requestId: 'req-6',
      }),
    ).rejects.toMatchObject({ code: 'URL_EXTRACTION_FAILED' });

    expect(generateCanonicalRecipe).not.toHaveBeenCalled();
  });
});
