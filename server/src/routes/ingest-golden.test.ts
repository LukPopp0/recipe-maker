import dns from 'node:dns';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ApiErrorEnvelope, ApiSuccessEnvelope, CanonicalRecipe } from 'shared';
import { CanonicalRecipeSchema } from 'shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { loadServerEnv } from '../env.js';
import { loadGeminiConfig } from '../services/ai/config.js';
import type { GeminiClient } from '../services/ai/gemini-client.js';
import { LocalDiskStorageAdapter } from '../services/storage/local-disk-storage-adapter.js';
import { LocalJsonFileRecipeRepository } from '../services/recipes/local-json-file-recipe-repository.js';

// Golden-fixture integration tests for POST /api/ingest/url (specs/04). Reuses
// ingest.test.ts's exact harness patterns (mkdtemp dirs, dns spy, makeApp,
// fakeGeminiSequence, mocked fetch) against fixture files instead of inline
// literals, so the full pipeline (fetch -> JSON-LD/text extraction -> Gemini
// -> post-processing -> ingredient matching -> image re-hosting) is exercised
// end-to-end against a captured golden output.

const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../test-support/fixtures');

function readFixture(...segments: string[]): string {
  return readFileSync(path.join(FIXTURES_DIR, ...segments), 'utf-8');
}

function readJsonFixture<T>(...segments: string[]): T {
  return JSON.parse(readFixture(...segments)) as T;
}

const RECIPE_PLAIN_HTML = readFixture('html', 'recipe-plain.html');
const RECIPE_JSON_LD_HTML = readFixture('html', 'recipe-json-ld.html');
const NON_RECIPE_HTML = readFixture('html', 'non-recipe.html');

const URL_CANDIDATE = readJsonFixture<unknown>('gemini', 'url-candidate.json');
const INGREDIENT_MATCH = readJsonFixture<unknown>('gemini', 'ingredient-match.json');
const EXPECTED_URL_RECIPE = readJsonFixture<unknown>('expected', 'url-recipe.json');

const MANUAL_CANDIDATE = readJsonFixture<unknown>('gemini', 'manual-candidate.json');
const MANUAL_INGREDIENT_MATCH = readJsonFixture<unknown>('gemini', 'manual-ingredient-match.json');
const EXPECTED_MANUAL_WITH_IMAGES = readJsonFixture<unknown>('expected', 'manual-with-images.json');
const EXPECTED_MANUAL_WITHOUT_STEP_IMAGES = readJsonFixture<unknown>('expected', 'manual-without-step-images.json');

const REQUEST_URL = 'https://example.com/golden-chili';

type IngestUrlSuccess = ApiSuccessEnvelope<{
  recipe: CanonicalRecipe
  diagnostics: { extractor: string; model: string; durationMs: number; fetchMode: string; usedJsonLd: boolean }
}>

// Strips nondeterministic fields from a successful response body so it can be
// deep-equal-compared against a captured golden fixture:
// - main_image's UUID-namespaced storage path -> a stable placeholder.
// - diagnostics.durationMs (wall-clock, never deterministic).
function normalizeResponseBody(body: IngestUrlSuccess): unknown {
  return {
    ...body,
    recipe: {
      ...body.recipe,
      main_image: body.recipe.main_image.replace(
        /\/images\/recipes\/[0-9a-f-]{36}\//,
        '/images/recipes/__ID__/',
      ),
    },
    diagnostics: {
      ...body.diagnostics,
      durationMs: undefined,
    },
  };
}

type IngestManualSuccess = ApiSuccessEnvelope<{
  recipe: CanonicalRecipe
  diagnostics: { extractor: string; model: string; durationMs: number }
}>

// Generalized version of normalizeResponseBody for the manual pipeline: also
// strips the UUID-namespaced storage path out of each step's hosted image
// (main_image only carries a UUID segment for the URL pipeline; manual
// ingestion additionally hosts per-step images the same way).
function normalizeManualResponseBody(body: IngestManualSuccess): unknown {
  const stripId = (url: string) => url.replace(/\/images\/recipes\/[0-9a-f-]{36}\//, '/images/recipes/__ID__/');
  return {
    ...body,
    recipe: {
      ...body.recipe,
      main_image: stripId(body.recipe.main_image),
      steps: body.recipe.steps.map((step) => (step.image ? { ...step, image: stripId(step.image) } : step)),
    },
    diagnostics: {
      ...body.diagnostics,
      durationMs: undefined,
    },
  };
}

describe('POST /api/ingest/url golden fixtures', () => {
  const originalFetch = globalThis.fetch;
  let dataDir: string;
  let imageDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'ingest-golden-recipes-'));
    imageDir = await mkdtemp(path.join(tmpdir(), 'ingest-golden-images-'));
    // Resolve any hostname to a public IP so the SSRF guard lets the fetch through.
    vi.spyOn(dns.promises, 'lookup').mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    globalThis.fetch = originalFetch;
    await rm(dataDir, { recursive: true, force: true });
    await rm(imageDir, { recursive: true, force: true });
  });

  function fakeGemini(handler: () => Promise<unknown>): GeminiClient {
    return { generateCanonicalRecipe: vi.fn(handler) } as unknown as GeminiClient;
  }

  function fakeGeminiSequence(...handlers: Array<() => Promise<unknown>>): GeminiClient {
    const fn = vi.fn();
    for (const handler of handlers) fn.mockImplementationOnce(handler);
    return { generateCanonicalRecipe: fn } as unknown as GeminiClient;
  }

  function makeApp(geminiClient: GeminiClient) {
    const env = loadServerEnv({ RECIPE_DATA_DIR: dataDir, IMAGE_DATA_DIR: imageDir, BROWSER_FALLBACK_ENABLED: 'false' });
    const recipeRepository = new LocalJsonFileRecipeRepository(dataDir);
    const storageAdapter = new LocalDiskStorageAdapter(env.IMAGE_DATA_DIR, env.PUBLIC_BASE_URL);
    return createApp({
      env,
      checkStorageReady: () => true,
      recipeRepository,
      geminiClient,
      geminiConfig: loadGeminiConfig({}),
      storageAdapter,
      defaultMainImageUrl: '/images/placeholder-recipe.png',
    });
  }

  // Serves the given page HTML for the page fetch and a tiny byte buffer for
  // the cdn.example.com main_image download, dispatched by URL - same
  // dispatch pattern as ingest.test.ts's mockFetch.
  function mockFetch(pageHtml: string) {
    globalThis.fetch = vi.fn(async (input: string | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('cdn.example.com')) {
        return new Response(new Uint8Array([1, 2, 3, 4]), {
          status: 200,
          headers: { 'content-type': 'image/jpeg' },
        });
      }
      return new Response(pageHtml, { status: 200, headers: { 'content-type': 'text/html' } });
    }) as unknown as typeof fetch;
  }

  it('plain-HTML happy path deep-equals the golden fixture', async () => {
    mockFetch(RECIPE_PLAIN_HTML);
    const app = makeApp(fakeGeminiSequence(
      () => Promise.resolve(URL_CANDIDATE),
      () => Promise.resolve(INGREDIENT_MATCH),
    ));

    // Fixed request id so the whole envelope (including requestId) is
    // deterministic and comparable against the captured golden fixture.
    const res = await app.request('/api/ingest/url', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-request-id': 'golden-test-request-id' },
      body: JSON.stringify({ url: REQUEST_URL }),
    });
    const body = (await res.json()) as IngestUrlSuccess;

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(CanonicalRecipeSchema.safeParse(body.recipe).success).toBe(true);
    expect(body.diagnostics.extractor).toBe('gemini-primary');

    const normalized = normalizeResponseBody(body);
    expect(normalized).toEqual(EXPECTED_URL_RECIPE);
  });

  it('JSON-LD variant is preferred over visible text and reaches Gemini', async () => {
    mockFetch(RECIPE_JSON_LD_HTML);
    const gemini = fakeGeminiSequence(
      () => Promise.resolve(URL_CANDIDATE),
      () => Promise.resolve(INGREDIENT_MATCH),
    );
    const app = makeApp(gemini);

    const res = await app.request('/api/ingest/url', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: REQUEST_URL }),
    });
    const body = (await res.json()) as IngestUrlSuccess;

    expect(res.status).toBe(200);
    expect(body.diagnostics.usedJsonLd).toBe(true);

    const firstCallArgs = (gemini.generateCanonicalRecipe as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      prompt: string
    };
    expect(firstCallArgs.prompt).toContain('ZXQ7MARKER');
  });

  it('returns 422 URL_FETCH_BLOCKED and never calls Gemini when the page fetch is blocked (403)', async () => {
    globalThis.fetch = vi.fn(async () => new Response('Forbidden', { status: 403 })) as unknown as typeof fetch;
    const gemini = fakeGemini(() => Promise.resolve(URL_CANDIDATE));
    const app = makeApp(gemini);

    const res = await app.request('/api/ingest/url', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: REQUEST_URL }),
    });
    const body = (await res.json()) as ApiErrorEnvelope;

    expect(res.status).toBe(422);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('URL_FETCH_BLOCKED');
    expect(gemini.generateCanonicalRecipe).not.toHaveBeenCalled();
  });

  it('returns 422 URL_EXTRACTION_FAILED and never calls Gemini for a non-recipe page', async () => {
    mockFetch(NON_RECIPE_HTML);
    const gemini = fakeGemini(() => Promise.resolve(URL_CANDIDATE));
    const app = makeApp(gemini);

    const res = await app.request('/api/ingest/url', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: REQUEST_URL }),
    });
    const body = (await res.json()) as ApiErrorEnvelope;

    expect(res.status).toBe(422);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('URL_EXTRACTION_FAILED');
    expect(gemini.generateCanonicalRecipe).not.toHaveBeenCalled();
  });

  it('returns 504 URL_FETCH_TIMEOUT when the page fetch aborts', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    }) as unknown as typeof fetch;
    const gemini = fakeGemini(() => Promise.resolve(URL_CANDIDATE));
    const app = makeApp(gemini);

    const res = await app.request('/api/ingest/url', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: REQUEST_URL }),
    });
    const body = (await res.json()) as ApiErrorEnvelope;

    expect(res.status).toBe(504);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('URL_FETCH_TIMEOUT');
    expect(gemini.generateCanonicalRecipe).not.toHaveBeenCalled();
  });
});

// Golden-fixture integration tests for POST /api/ingest/manual (specs/05).
// Reuses ingest.test.ts's exact harness patterns (mkdtemp dirs, makeApp,
// fakeGeminiSequence, makeImageFile/validFormData) against fixture files
// instead of inline literals, so the full pipeline (host uploaded images ->
// Gemini normalize -> post-processing -> ingredient matching -> forced
// source_type) is exercised end-to-end against a captured golden output.
describe('POST /api/ingest/manual golden fixtures', () => {
  let dataDir: string;
  let imageDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'ingest-manual-golden-recipes-'));
    imageDir = await mkdtemp(path.join(tmpdir(), 'ingest-manual-golden-images-'));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(dataDir, { recursive: true, force: true });
    await rm(imageDir, { recursive: true, force: true });
  });

  function fakeGeminiSequence(...handlers: Array<() => Promise<unknown>>): GeminiClient {
    const fn = vi.fn();
    for (const handler of handlers) fn.mockImplementationOnce(handler);
    return { generateCanonicalRecipe: fn } as unknown as GeminiClient;
  }

  function makeApp(geminiClient: GeminiClient) {
    const env = loadServerEnv({ RECIPE_DATA_DIR: dataDir, IMAGE_DATA_DIR: imageDir, BROWSER_FALLBACK_ENABLED: 'false' });
    const recipeRepository = new LocalJsonFileRecipeRepository(dataDir);
    const storageAdapter = new LocalDiskStorageAdapter(env.IMAGE_DATA_DIR, env.PUBLIC_BASE_URL);
    return createApp({
      env,
      checkStorageReady: () => true,
      recipeRepository,
      geminiClient,
      geminiConfig: loadGeminiConfig({}),
      storageAdapter,
      defaultMainImageUrl: '/images/placeholder-recipe.png',
    });
  }

  function makeImageFile(name: string, contentType: string): File {
    // Tiny in-memory buffer; the pipeline only inspects declared content type
    // and byte length, not real image structure.
    return new File([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])], name, { type: contentType });
  }

  function validFormData(): FormData {
    const form = new FormData();
    form.set('ingredientsText', '500g ground beef\n1 cup shredded cheddar');
    form.set('stepsText', 'Brown the ground beef.\nAssemble the tacos.');
    form.set('mainImage', makeImageFile('main.jpg', 'image/jpeg'));
    form.append('stepImages', makeImageFile('step-1.png', 'image/png'));
    form.append('stepImages', makeImageFile('step-2.png', 'image/png'));
    return form;
  }

  it('with main image + step images deep-equals the golden fixture', async () => {
    const app = makeApp(fakeGeminiSequence(
      () => Promise.resolve(MANUAL_CANDIDATE),
      () => Promise.resolve(MANUAL_INGREDIENT_MATCH),
    ));

    const res = await app.request('/api/ingest/manual', {
      method: 'POST',
      headers: { 'x-request-id': 'golden-manual-request-id' },
      body: validFormData(),
    });
    const body = (await res.json()) as IngestManualSuccess;

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(CanonicalRecipeSchema.safeParse(body.recipe).success).toBe(true);
    // metadata.source_type is forced to 'manual' server-side and a
    // hallucinated source_url is stripped, never trusting MANUAL_CANDIDATE's
    // deliberately wrong values.
    expect(body.recipe.metadata.source_type).toBe('manual');
    expect(body.recipe.metadata.source_url).toBeUndefined();

    const normalized = normalizeManualResponseBody(body);
    expect(normalized).toEqual(EXPECTED_MANUAL_WITH_IMAGES);
  });

  it('with mainImage only (no stepImages) deep-equals the golden fixture', async () => {
    const app = makeApp(fakeGeminiSequence(
      () => Promise.resolve(MANUAL_CANDIDATE),
      () => Promise.resolve(MANUAL_INGREDIENT_MATCH),
    ));

    const form = validFormData();
    form.delete('stepImages');

    const res = await app.request('/api/ingest/manual', {
      method: 'POST',
      headers: { 'x-request-id': 'golden-manual-request-id' },
      body: form,
    });
    const body = (await res.json()) as IngestManualSuccess;

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(CanonicalRecipeSchema.safeParse(body.recipe).success).toBe(true);
    expect(body.recipe.metadata.source_type).toBe('manual');
    expect(body.recipe.metadata.source_url).toBeUndefined();
    expect(body.recipe.steps.every((step) => step.image === undefined)).toBe(true);

    const normalized = normalizeManualResponseBody(body);
    expect(normalized).toEqual(EXPECTED_MANUAL_WITHOUT_STEP_IMAGES);
  });
});
