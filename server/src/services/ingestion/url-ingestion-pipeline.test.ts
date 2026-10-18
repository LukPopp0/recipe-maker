import dns from 'node:dns';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../lib/errors.js';
import { loadServerEnv } from '../../env.js';
import { loadGeminiConfig } from '../ai/config.js';
import { URL_RECIPE_OUTPUT_JSON_SCHEMA } from '../ai/output-schemas.js';
import { QUOTA_MESSAGE, type GenerateCanonicalRecipeParams } from '../ai/gemini-client.js';
import type { GeminiCanonicalRecipeGenerator } from './url-ingestion-pipeline.js';
import type { BrowserHtmlFetcher } from '../url-ingestion/browser-fetcher.js';
import { describeExtractionFailure, runUrlIngestionPipeline } from './url-ingestion-pipeline.js';

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

function stageLogLines(logSpy: { mock: { calls: unknown[][] } }) {
  return logSpy.mock.calls
    .map((call: unknown[]) => call[0] as string)
    .map((line: string) => {
      try {
        return JSON.parse(line) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter((parsed: Record<string, unknown> | null): parsed is Record<string, unknown> => parsed !== null && 'stage' in parsed);
}

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
    expect(result.diagnostics.model).toBe('gemini-3.5-flash-lite');
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
    expect(result.diagnostics.model).toBe('gemini-3.1-flash-lite');
    expect(generateCanonicalRecipe).toHaveBeenCalledTimes(2);
    expect(generateCanonicalRecipe.mock.calls[1][0].model).toBe('gemini-3.1-flash-lite');
    // Both attempts request structured output.
    expect(generateCanonicalRecipe.mock.calls[0][0].responseJsonSchema).toBe(URL_RECIPE_OUTPUT_JSON_SCHEMA);
    expect(generateCanonicalRecipe.mock.calls[1][0].responseJsonSchema).toBe(URL_RECIPE_OUTPUT_JSON_SCHEMA);
    // The retry prompt names what was wrong with the primary response and
    // carries the page title hint.
    const retryPrompt = generateCanonicalRecipe.mock.calls[1][0].prompt as string;
    expect(retryPrompt).toContain(`failed: ${describeExtractionFailure(GARBAGE_CANDIDATE)}.`);
    expect(retryPrompt).toContain("Title hint (from the page's <title>/og:title, may be inaccurate or absent): Grandma's Lasagna");
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

    it('uses the browser fallback when JSON-LD is present but carries no ingredients', async () => {
      // recime.app-style page: authoritative JSON-LD has steps/times but no
      // recipeIngredient, so amounts live only in the client-rendered DOM.
      const noIngredientsJsonLd = {
        '@type': 'Recipe',
        name: 'Dumpling Lasagna',
        recipeInstructions: [{ '@type': 'HowToStep', text: 'Layer and steam.' }],
      };
      const staticNoIngredients = `<html><head><title>Dumpling Lasagna</title>
        <script type="application/ld+json">${JSON.stringify(noIngredientsJsonLd)}</script></head>
        <body><div id="root"></div></body></html>`;
      globalThis.fetch = vi.fn().mockResolvedValue(new Response(staticNoIngredients));
      const { fetcher, fetchWithBrowser } = fakeBrowserFetcher(RENDERED_HTML);
      const geminiClient = fakeGeminiClient(vi.fn().mockResolvedValue(VALID_CANDIDATE));

      const result = await runUrlIngestionPipeline({
        url: 'https://example.com/lasagna',
        geminiClient,
        geminiConfig: makeGeminiConfig(),
        env: FALLBACK_ENV,
        browserFetcher: fetcher,
        requestId: 'req-8b',
      });

      expect(fetchWithBrowser).toHaveBeenCalledTimes(1);
      expect(result.diagnostics.fetchMode).toBe('browser');
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

    const run403 = (
      fetcher: BrowserHtmlFetcher,
      env: typeof FALLBACK_ENV,
      generate = vi.fn(),
      requestId = 'req-403',
    ) =>
      runUrlIngestionPipeline({
        url: 'https://example.com/lasagna',
        geminiClient: fakeGeminiClient(generate),
        geminiConfig: makeGeminiConfig(),
        env,
        browserFetcher: fetcher,
        requestId,
      });

    it('tries the browser on a static 403 and continues with the rendered HTML', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(new Response('denied', { status: 403 }));
      const { fetcher, fetchWithBrowser } = fakeBrowserFetcher(RENDERED_HTML);

      const result = await run403(fetcher, FALLBACK_ENV, vi.fn().mockResolvedValue(VALID_CANDIDATE));

      expect(fetchWithBrowser).toHaveBeenCalledTimes(1);
      expect(result.diagnostics.fetchMode).toBe('browser');
    });

    it('throws URL_FETCH_BLOCKED when the browser also gets 403', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(new Response('denied', { status: 403 }));
      const fetchWithBrowser = vi.fn().mockRejectedValue(new AppError('URL_FETCH_BLOCKED', 'x', { status: 403 }));
      const generate = vi.fn();

      await expect(run403({ fetchWithBrowser }, FALLBACK_ENV, generate)).rejects.toMatchObject({
        code: 'URL_FETCH_BLOCKED',
      });
      expect(generate).not.toHaveBeenCalled();
    });

    it('keeps the browser error code when the 403 fallback fails another way', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(new Response('denied', { status: 403 }));
      const fetchWithBrowser = vi.fn().mockRejectedValue(new AppError('URL_FETCH_TIMEOUT', 'slow'));

      await expect(run403({ fetchWithBrowser }, FALLBACK_ENV)).rejects.toMatchObject({
        code: 'URL_FETCH_TIMEOUT',
      });
    });

    it('throws URL_FETCH_BLOCKED without a browser attempt when the fallback is disabled', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(new Response('denied', { status: 403 }));
      const fetchWithBrowser = vi.fn();

      await expect(run403({ fetchWithBrowser }, STATIC_ENV)).rejects.toMatchObject({
        code: 'URL_FETCH_BLOCKED',
      });
      expect(fetchWithBrowser).not.toHaveBeenCalled();
    });

    it('logs a fetch error line for a blocked static fetch', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      globalThis.fetch = vi.fn().mockResolvedValue(new Response('denied', { status: 403 }));

      await expect(run403({ fetchWithBrowser: vi.fn() }, STATIC_ENV)).rejects.toMatchObject({
        code: 'URL_FETCH_BLOCKED',
      });

      expect(stageLogLines(logSpy).find((l) => l.stage === 'fetch')).toMatchObject({
        stage: 'fetch',
        outcome: 'error',
        errorCode: 'URL_FETCH_BLOCKED',
        status: 403,
        fetchMode: 'static',
        url: 'https://example.com/lasagna',
      });
    });

    it('logs fetchMode browser when the 403 fallback is blocked too', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      globalThis.fetch = vi.fn().mockResolvedValue(new Response('denied', { status: 403 }));
      const fetchWithBrowser = vi.fn().mockRejectedValue(new AppError('URL_FETCH_BLOCKED', 'x', { status: 403 }));

      await expect(run403({ fetchWithBrowser }, FALLBACK_ENV)).rejects.toMatchObject({
        code: 'URL_FETCH_BLOCKED',
      });

      expect(stageLogLines(logSpy).find((l) => l.stage === 'fetch')).toMatchObject({
        outcome: 'error',
        errorCode: 'URL_FETCH_BLOCKED',
        status: 403,
        fetchMode: 'browser',
      });
    });

    it('logs a fetch error line for a non-403 HTTP error', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      globalThis.fetch = vi.fn().mockResolvedValue(new Response('boom', { status: 500 }));

      await expect(run403({ fetchWithBrowser: vi.fn() }, FALLBACK_ENV)).rejects.toMatchObject({
        code: 'URL_FETCH_FAILED',
      });

      expect(stageLogLines(logSpy).find((l) => l.stage === 'fetch')).toMatchObject({
        outcome: 'error',
        errorCode: 'URL_FETCH_FAILED',
        status: 500,
        fetchMode: 'static',
      });
    });

    it('logs a fetch error line without status for a timeout', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      globalThis.fetch = vi.fn().mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));

      await expect(run403({ fetchWithBrowser: vi.fn() }, FALLBACK_ENV)).rejects.toMatchObject({
        code: 'URL_FETCH_TIMEOUT',
      });

      const line = stageLogLines(logSpy).find((l) => l.stage === 'fetch');
      expect(line).toMatchObject({ outcome: 'error', errorCode: 'URL_FETCH_TIMEOUT', fetchMode: 'static' });
      expect(line).not.toHaveProperty('status');
    });

    it('does not call the browser twice when the 403 fallback page is itself thin', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      globalThis.fetch = vi.fn().mockResolvedValue(new Response('denied', { status: 403 }));
      const { fetcher, fetchWithBrowser } = fakeBrowserFetcher(SHELL_HTML);
      const generate = vi.fn();

      await expect(run403(fetcher, FALLBACK_ENV, generate)).rejects.toMatchObject({
        code: 'URL_EXTRACTION_FAILED',
      });

      expect(fetchWithBrowser).toHaveBeenCalledTimes(1);
      expect(generate).not.toHaveBeenCalled();
      expect(stageLogLines(logSpy).find((l) => l.stage === 'fetch')).toMatchObject({
        outcome: 'error',
        errorCode: 'URL_EXTRACTION_FAILED',
        fetchMode: 'browser',
      });
    });

    it('logs a fetch error line when the JS-shell browser fallback throws', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      globalThis.fetch = vi.fn().mockResolvedValue(new Response(SHELL_HTML));
      const fetchWithBrowser = vi.fn().mockRejectedValue(new AppError('URL_FETCH_FAILED', 'x', { status: 500 }));

      await expect(run403({ fetchWithBrowser }, FALLBACK_ENV)).rejects.toMatchObject({
        code: 'URL_FETCH_FAILED',
      });

      expect(stageLogLines(logSpy).find((l) => l.stage === 'fetch')).toMatchObject({
        outcome: 'error',
        errorCode: 'URL_FETCH_FAILED',
        status: 500,
        fetchMode: 'browser',
      });
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

  describe('Gemini quota', () => {
    const quota = () => new AppError('AI_QUOTA_EXCEEDED', QUOTA_MESSAGE, { model: 'x' });

    function run(generateCanonicalRecipe: (params: GenerateCanonicalRecipeParams) => Promise<unknown>) {
      globalThis.fetch = vi.fn().mockResolvedValue(new Response(RECIPE_HTML));
      return runUrlIngestionPipeline({
        url: 'https://example.com/lasagna',
        geminiClient: fakeGeminiClient(generateCanonicalRecipe),
        geminiConfig: makeGeminiConfig(),
        env: STATIC_ENV,
        requestId: 'req-quota',
      });
    }

    it('reports AI_QUOTA_EXCEEDED when both attempts hit the quota', async () => {
      const generate = vi.fn().mockRejectedValueOnce(quota()).mockRejectedValueOnce(quota());

      await expect(run(generate)).rejects.toMatchObject({ code: 'AI_QUOTA_EXCEEDED' });
    });

    it('uses the retry result when only the primary model hit the quota', async () => {
      const generate = vi.fn().mockRejectedValueOnce(quota()).mockResolvedValueOnce(VALID_CANDIDATE);

      const result = await run(generate);

      expect(result.diagnostics.extractor).toBe('gemini-retry');
    });

    it('keeps URL_EXTRACTION_FAILED when the retry fails for a non-quota reason', async () => {
      const generate = vi.fn().mockRejectedValueOnce(quota()).mockResolvedValueOnce(GARBAGE_CANDIDATE);

      await expect(run(generate)).rejects.toMatchObject({ code: 'URL_EXTRACTION_FAILED' });
    });

    // The final attempt decides the reported error (docs/specs/04).
    it('reports AI_QUOTA_EXCEEDED when the primary returns garbage and the retry hits the quota', async () => {
      const generate = vi.fn().mockResolvedValueOnce(GARBAGE_CANDIDATE).mockRejectedValueOnce(quota());

      await expect(run(generate)).rejects.toMatchObject({ code: 'AI_QUOTA_EXCEEDED' });
    });
  });

  describe('stage logging', () => {
    it('emits fetch and extract ok logs on the happy path', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      globalThis.fetch = vi.fn().mockResolvedValue(new Response(RECIPE_HTML));
      const generateCanonicalRecipe = vi.fn().mockResolvedValue(VALID_CANDIDATE);
      const geminiClient = fakeGeminiClient(generateCanonicalRecipe);

      await runUrlIngestionPipeline({
        url: 'https://example.com/lasagna',
        geminiClient,
        geminiConfig: makeGeminiConfig(),
        env: STATIC_ENV,
        requestId: 'req-log-1',
      });

      const lines = stageLogLines(logSpy);
      const fetchLine = lines.find((l) => l.stage === 'fetch');
      const extractLine = lines.find((l) => l.stage === 'extract');

      expect(fetchLine).toMatchObject({
        requestId: 'req-log-1',
        stage: 'fetch',
        outcome: 'ok',
        fetchMode: 'static',
        url: 'https://example.com/lasagna',
      });
      expect(extractLine).toMatchObject({
        requestId: 'req-log-1',
        stage: 'extract',
        outcome: 'ok',
      });
    });

    it('emits an extract error log when both attempts fail', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      globalThis.fetch = vi.fn().mockResolvedValue(new Response(RECIPE_HTML));
      const generateCanonicalRecipe = vi.fn().mockResolvedValue(GARBAGE_CANDIDATE);
      const geminiClient = fakeGeminiClient(generateCanonicalRecipe);

      await expect(
        runUrlIngestionPipeline({
          url: 'https://example.com/lasagna',
          geminiClient,
          geminiConfig: makeGeminiConfig(),
          env: STATIC_ENV,
          requestId: 'req-log-2',
        }),
      ).rejects.toMatchObject({ code: 'URL_EXTRACTION_FAILED' });

      const lines = stageLogLines(logSpy);
      const extractErrorLine = lines.find((l) => l.stage === 'extract' && l.outcome === 'error' && !l.attempt);

      expect(extractErrorLine).toMatchObject({
        requestId: 'req-log-2',
        stage: 'extract',
        outcome: 'error',
        errorCode: 'URL_EXTRACTION_FAILED',
      });
    });

    async function runLogged(generate: (params: GenerateCanonicalRecipeParams) => Promise<unknown>) {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      globalThis.fetch = vi.fn().mockResolvedValue(new Response(RECIPE_HTML));
      const result = await runUrlIngestionPipeline({
        url: 'https://example.com/lasagna',
        geminiClient: fakeGeminiClient(generate),
        geminiConfig: makeGeminiConfig(),
        env: STATIC_ENV,
        requestId: 'req-log-attempt',
      }).then(
        () => null,
        (err: unknown) => err,
      );
      return { lines: stageLogLines(logSpy), result };
    }

    it('logs a thrown primary attempt with its code, message and cause', async () => {
      const generate = vi
        .fn()
        .mockRejectedValueOnce(
          new AppError('AI_NORMALIZATION_FAILED', 'Gemini request failed', { cause: 'socket hang up' }),
        )
        .mockResolvedValueOnce(VALID_CANDIDATE);

      const { lines } = await runLogged(generate);

      const attempts = lines.filter((l) => l.stage === 'extract' && l.attempt);
      expect(attempts).toEqual([
        expect.objectContaining({
          outcome: 'error',
          attempt: 'primary',
          errorCode: 'AI_NORMALIZATION_FAILED',
          message: 'Gemini request failed',
          cause: 'socket hang up',
          url: 'https://example.com/lasagna',
        }),
      ]);
      const finalLine = lines.find((l) => l.stage === 'extract' && !l.attempt);
      expect(finalLine).toMatchObject({ outcome: 'ok', url: 'https://example.com/lasagna' });
    });

    it('logs a pre-check failure with its reason', async () => {
      const generate = vi.fn().mockResolvedValueOnce(GARBAGE_CANDIDATE).mockResolvedValueOnce(VALID_CANDIDATE);

      const { lines } = await runLogged(generate);

      const attempts = lines.filter((l) => l.stage === 'extract' && l.attempt);
      expect(attempts).toEqual([
        expect.objectContaining({
          outcome: 'error',
          attempt: 'primary',
          reason: 'the response was missing a title, ingredients and steps',
          url: 'https://example.com/lasagna',
        }),
      ]);
      expect(attempts[0]).not.toHaveProperty('errorCode');
    });

    it('times the retry attempt from its own start, not the extract stage start', async () => {
      let now = 1_000_000;
      vi.spyOn(Date, 'now').mockImplementation(() => now);
      const generate = vi
        .fn()
        .mockImplementationOnce(async () => {
          now += 1000;
          throw new AppError('AI_NORMALIZATION_FAILED', 'first failed');
        })
        .mockImplementationOnce(async () => {
          now += 200;
          throw new AppError('AI_NORMALIZATION_FAILED', 'second failed');
        });

      const { lines } = await runLogged(generate);

      const attempts = lines.filter((l) => l.stage === 'extract' && l.attempt);
      expect(attempts.map((l) => l.durationMs)).toEqual([1000, 200]);
    });

    it('logs both failed attempts and the final stage line', async () => {
      const generate = vi
        .fn()
        .mockRejectedValueOnce(new AppError('AI_NORMALIZATION_FAILED', 'first failed'))
        .mockRejectedValueOnce(new AppError('AI_NORMALIZATION_FAILED', 'second failed'));

      const { lines } = await runLogged(generate);

      const attempts = lines.filter((l) => l.stage === 'extract' && l.attempt);
      expect(attempts.map((l) => l.attempt)).toEqual(['primary', 'retry']);
      expect(attempts[0]).not.toHaveProperty('cause');
      const finalLine = lines.find((l) => l.stage === 'extract' && !l.attempt);
      expect(finalLine).toMatchObject({
        outcome: 'error',
        errorCode: 'URL_EXTRACTION_FAILED',
        url: 'https://example.com/lasagna',
      });
    });

    it('emits a fetch error log for the min-content throw', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      globalThis.fetch = vi.fn().mockResolvedValue(new Response(EMPTY_HTML));
      const geminiClient = fakeGeminiClient(vi.fn());

      await expect(
        runUrlIngestionPipeline({
          url: 'https://example.com/empty',
          geminiClient,
          geminiConfig: makeGeminiConfig(),
          env: STATIC_ENV,
          requestId: 'req-log-3',
        }),
      ).rejects.toMatchObject({ code: 'URL_EXTRACTION_FAILED' });

      const lines = stageLogLines(logSpy);
      const fetchErrorLine = lines.find((l) => l.stage === 'fetch' && l.outcome === 'error');

      expect(fetchErrorLine).toMatchObject({
        requestId: 'req-log-3',
        stage: 'fetch',
        outcome: 'error',
        errorCode: 'URL_EXTRACTION_FAILED',
        url: 'https://example.com/empty',
        fetchMode: 'static',
      });
    });
  });
});

describe('describeExtractionFailure', () => {
  it('returns null for a candidate with a title, ingredients and steps', () => {
    expect(describeExtractionFailure({ title: 'Soup', ingredients: [{}], steps: [{}] })).toBeNull();
  });

  it('names a swallowed request error', () => {
    expect(describeExtractionFailure(null)).toBe(
      'the request errored or timed out, or the response was not valid JSON',
    );
  });

  it('rejects arrays and non-objects', () => {
    expect(describeExtractionFailure([])).toBe('the response was not a single JSON object');
    expect(describeExtractionFailure('soup')).toBe('the response was not a single JSON object');
  });

  it('lists every missing required part', () => {
    expect(describeExtractionFailure({ title: 'Soup', ingredients: [{}], steps: [] })).toBe('the response was missing steps');
    expect(describeExtractionFailure({ title: ' ', ingredients: [], steps: [] })).toBe(
      'the response was missing a title, ingredients and steps',
    );
  });
});
