import dns from 'node:dns';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ApiErrorEnvelope, ApiSuccessEnvelope, CanonicalRecipe } from 'shared';
import { CanonicalRecipeSchema } from 'shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { loadServerEnv } from '../env.js';
import { loadGeminiConfig } from '../services/ai/config.js';
import type { GeminiClient } from '../services/ai/gemini-client.js';
import { LocalDiskStorageAdapter } from '../services/storage/local-disk-storage-adapter.js';
import { LocalJsonFileRecipeRepository } from '../services/recipes/local-json-file-recipe-repository.js';

// A recipe page with enough visible text to clear the pipeline's minimum
// content pre-check and yield a title/ingredients/steps.
const RECIPE_HTML = `
  <html>
    <head><title>Grandma's Lasagna</title></head>
    <body>
      <article>
        <h1>Grandma's Lasagna</h1>
        <p>A classic baked lasagna recipe passed down for generations, full of rich
        tomato sauce, layers of pasta, and melted cheese.</p>
        <ul>
          <li>500g lasagna sheets</li>
          <li>400g ground beef</li>
          <li>2 cups tomato sauce</li>
        </ul>
        <ol>
          <li>Boil the lasagna sheets until al dente.</li>
          <li>Brown the ground beef and mix with tomato sauce.</li>
          <li>Layer sheets, meat sauce, and cheese in a baking dish.</li>
        </ol>
      </article>
    </body>
  </html>
`;

const EMPTY_HTML = `<html><head><title>Untitled</title></head><body></body></html>`;

const REMOTE_IMAGE_URL = 'https://cdn.example.com/lasagna.jpg';

// A structurally-complete Gemini candidate: passes the pipeline's structural
// pre-check and post-processing, and references a remote main_image so the
// re-hoster downloads + re-hosts it.
const VALID_CANDIDATE = {
  title: "Grandma's Lasagna",
  tags: ['dinner'],
  time: 60,
  ingredients: [
    { name: 'lasagna sheets', amount_text: '500g' },
    { name: 'ground beef', amount_text: '400g' },
  ],
  pantry_items: [],
  main_image: REMOTE_IMAGE_URL,
  steps: [
    { step_header: 'Boil', step_description: 'Boil the lasagna sheets until al dente.' },
    { step_header: 'Brown', step_description: 'Brown the ground beef and mix with tomato sauce.' },
  ],
  metadata: { source_type: 'url', source_url: 'https://example.com/lasagna', language: 'en', warnings: [] },
};

type IngestUrlSuccess = ApiSuccessEnvelope<{
  recipe: CanonicalRecipe
  diagnostics: { extractor: string; model: string; durationMs: number }
}>

describe('POST /api/ingest/url (Option A pipeline)', () => {
  const originalFetch = globalThis.fetch;
  let dataDir: string;
  let imageDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'ingest-recipes-'));
    imageDir = await mkdtemp(path.join(tmpdir(), 'ingest-images-'));
    // Resolve any hostname to a public IP so the SSRF guard lets the fetch through.
    vi.spyOn(dns.promises, 'lookup').mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    globalThis.fetch = originalFetch;
    await rm(dataDir, { recursive: true, force: true });
    await rm(imageDir, { recursive: true, force: true });
  });

  // Fake GeminiClient (structural type only - never touches the real SDK).
  function fakeGemini(handler: () => Promise<unknown>): GeminiClient {
    return { generateCanonicalRecipe: vi.fn(handler) } as unknown as GeminiClient;
  }

  // Fake GeminiClient that answers a fixed sequence of calls in order: first
  // the ingestion candidate, then the ingredient image matcher's attempt(s).
  // Each request now makes >= 2 Gemini calls once a matcher is wired in.
  function fakeGeminiSequence(...handlers: Array<() => Promise<unknown>>): GeminiClient {
    const fn = vi.fn();
    for (const handler of handlers) fn.mockImplementationOnce(handler);
    return { generateCanonicalRecipe: fn } as unknown as GeminiClient;
  }

  // Match response used by the "matched filename" test: same order/length as
  // VALID_CANDIDATE.ingredients, using real catalog filenames.
  const MATCH_RESPONSE = [
    { name: 'Lasagna Sheets', amount_text: '500g', image: 'pasta-linguine.png' },
    { name: 'Ground Beef', amount_text: '400g', image: 'meat-beef-ground.png' },
  ];

  function makeApp(geminiClient: GeminiClient) {
    const env = loadServerEnv({ RECIPE_DATA_DIR: dataDir, IMAGE_DATA_DIR: imageDir });
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

  // Serves the recipe page for page fetches and a small image buffer for the
  // image download, dispatched by URL.
  function mockFetch() {
    globalThis.fetch = vi.fn(async (input: string | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('cdn.example.com')) {
        return new Response(new Uint8Array([1, 2, 3, 4]), {
          status: 200,
          headers: { 'content-type': 'image/jpeg' },
        });
      }
      return new Response(RECIPE_HTML, { status: 200, headers: { 'content-type': 'text/html' } });
    }) as unknown as typeof fetch;
  }

  it('runs the full pipeline and returns a schema-valid recipe with a re-hosted image', async () => {
    mockFetch();
    const app = makeApp(fakeGeminiSequence(
      () => Promise.resolve(VALID_CANDIDATE),
      () => Promise.resolve(MATCH_RESPONSE),
    ));

    const res = await app.request('/api/ingest/url', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/lasagna' }),
    });
    const body = (await res.json()) as IngestUrlSuccess;

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    // Response is a schema-valid canonical recipe.
    expect(CanonicalRecipeSchema.safeParse(body.recipe).success).toBe(true);
    // Diagnostics from the pipeline are surfaced.
    expect(body.diagnostics.extractor).toBe('gemini-primary');
    expect(body.diagnostics.model).toBe('gemini-2.5-pro');
    expect(body.diagnostics.durationMs).toBeGreaterThanOrEqual(0);
    // main_image was re-hosted onto our own /images/ mount, not left remote.
    expect(body.recipe.main_image).toContain('/images/');
    expect(body.recipe.main_image).not.toBe(REMOTE_IMAGE_URL);
    // Ingredient images were assigned from the matcher's fake response.
    expect(body.recipe.ingredients.map((i) => i.image)).toEqual([
      'pasta-linguine.png',
      'meat-beef-ground.png',
    ]);
  });

  it('degrades an invented matcher filename to INGREDIENT_NOT_FOUND.png with a warning', async () => {
    mockFetch();
    const app = makeApp(fakeGeminiSequence(
      () => Promise.resolve(VALID_CANDIDATE),
      () => Promise.resolve([
        { name: 'Lasagna Sheets', amount_text: '500g', image: 'pasta-linguine.png' },
        { name: 'Ground Beef', amount_text: '400g', image: 'not-a-real-catalog-file.png' },
      ]),
    ));

    const res = await app.request('/api/ingest/url', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/lasagna' }),
    });
    const body = (await res.json()) as IngestUrlSuccess;

    expect(res.status).toBe(200);
    expect(body.recipe.ingredients.map((i) => i.image)).toEqual([
      'pasta-linguine.png',
      'INGREDIENT_NOT_FOUND.png',
    ]);
    expect(body.recipe.metadata.warnings.some((w) => w.includes('not in the catalog'))).toBe(true);
  });

  it('degrades all ingredient images to INGREDIENT_NOT_FOUND.png when the matcher fails both attempts', async () => {
    mockFetch();
    const app = makeApp(fakeGeminiSequence(
      () => Promise.resolve(VALID_CANDIDATE),
      () => Promise.reject(new Error('primary matcher call failed')),
      () => Promise.reject(new Error('retry matcher call failed')),
    ));

    const res = await app.request('/api/ingest/url', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/lasagna' }),
    });
    const body = (await res.json()) as IngestUrlSuccess;

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.recipe.ingredients.map((i) => i.image)).toEqual([
      'INGREDIENT_NOT_FOUND.png',
      'INGREDIENT_NOT_FOUND.png',
    ]);
    expect(body.recipe.metadata.warnings.some((w) => w.includes('degradation') || w.includes('failed after retry'))).toBe(true);
  });

  it('rejects a private/blocked URL with 400 INVALID_URL', async () => {
    mockFetch();
    const app = makeApp(fakeGemini(() => Promise.resolve(VALID_CANDIDATE)));

    const res = await app.request('/api/ingest/url', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'http://169.254.169.254/latest/meta-data' }),
    });
    const body = (await res.json()) as ApiErrorEnvelope;

    expect(res.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('INVALID_URL');
  });

  it('returns 422 URL_EXTRACTION_FAILED when the page has no recipe content', async () => {
    globalThis.fetch = vi.fn(async () => new Response(EMPTY_HTML, {
      status: 200,
      headers: { 'content-type': 'text/html' },
    })) as unknown as typeof fetch;
    const gemini = fakeGemini(() => Promise.resolve(VALID_CANDIDATE));
    const app = makeApp(gemini);

    const res = await app.request('/api/ingest/url', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/not-a-recipe' }),
    });
    const body = (await res.json()) as ApiErrorEnvelope;

    expect(res.status).toBe(422);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('URL_EXTRACTION_FAILED');
    // Gemini is never called when the minimum-content pre-check fails.
    expect(gemini.generateCanonicalRecipe).not.toHaveBeenCalled();
  });

});

// A structurally-complete Gemini candidate for manual ingestion (Option B).
// metadata.source_type is deliberately hallucinated as 'url' here to verify
// the route forces it back to 'manual' server-side rather than trusting the
// model's output.
const VALID_MANUAL_CANDIDATE = {
  title: 'Weeknight Tacos',
  tags: ['dinner'],
  time: 30,
  ingredients: [
    { name: 'ground beef', amount_text: '500g' },
    { name: 'taco shells', amount_text: '8' },
  ],
  pantry_items: [],
  steps: [
    { step_header: 'Cook', step_description: 'Brown the ground beef in a skillet.' },
    { step_header: 'Assemble', step_description: 'Fill the taco shells with beef and toppings.' },
  ],
  metadata: { source_type: 'url', language: 'en', warnings: [] },
};

// A structurally-incomplete Gemini candidate: no title, no steps. Fails the
// manual pipeline's structural pre-check (no retry for Option B).
const STEPLESS_TITLELESS_CANDIDATE = {
  title: '',
  tags: [],
  time: null,
  ingredients: [{ name: 'ground beef', amount_text: '500g' }],
  pantry_items: [],
  steps: [],
  metadata: { source_type: 'manual', language: 'en', warnings: [] },
};

type IngestManualSuccess = ApiSuccessEnvelope<{
  recipe: CanonicalRecipe
  diagnostics: { extractor: string; model: string; durationMs: number }
}>

describe('POST /api/ingest/manual (Option B pipeline)', () => {
  let dataDir: string;
  let imageDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'ingest-manual-recipes-'));
    imageDir = await mkdtemp(path.join(tmpdir(), 'ingest-manual-images-'));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(dataDir, { recursive: true, force: true });
    await rm(imageDir, { recursive: true, force: true });
  });

  function fakeGemini(handler: () => Promise<unknown>): GeminiClient {
    return { generateCanonicalRecipe: vi.fn(handler) } as unknown as GeminiClient;
  }

  // Fake GeminiClient that answers a fixed sequence of calls in order: first
  // the ingestion candidate, then the ingredient image matcher's attempt(s).
  function fakeGeminiSequence(...handlers: Array<() => Promise<unknown>>): GeminiClient {
    const fn = vi.fn();
    for (const handler of handlers) fn.mockImplementationOnce(handler);
    return { generateCanonicalRecipe: fn } as unknown as GeminiClient;
  }

  // Match response used by the "matched filename" test: same order/length as
  // VALID_MANUAL_CANDIDATE.ingredients, using real catalog filenames.
  const MANUAL_MATCH_RESPONSE = [
    { name: 'Ground Beef', amount_text: '500g', image: 'meat-beef-ground.png' },
    { name: 'Taco Shells', amount_text: '8', image: 'broccoli.png' },
  ];

  function makeApp(geminiClient: GeminiClient, envOverrides: Record<string, string> = {}) {
    const env = loadServerEnv({
      RECIPE_DATA_DIR: dataDir,
      IMAGE_DATA_DIR: imageDir,
      ...envOverrides,
    });
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
    form.set('ingredientsText', '500g ground beef\n8 taco shells');
    form.set('stepsText', 'Brown the ground beef.\nAssemble the tacos.');
    form.set('mainImage', makeImageFile('main.jpg', 'image/jpeg'));
    form.append('stepImages', makeImageFile('step-1.png', 'image/png'));
    form.append('stepImages', makeImageFile('step-2.png', 'image/png'));
    return form;
  }

  it('runs the full pipeline and returns a schema-valid recipe with hosted images', async () => {
    const app = makeApp(fakeGeminiSequence(
      () => Promise.resolve(VALID_MANUAL_CANDIDATE),
      () => Promise.resolve(MANUAL_MATCH_RESPONSE),
    ));

    const res = await app.request('/api/ingest/manual', {
      method: 'POST',
      body: validFormData(),
    });
    const body = (await res.json()) as IngestManualSuccess;

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(CanonicalRecipeSchema.safeParse(body.recipe).success).toBe(true);
    // source_type is forced to 'manual' server-side, never trusting Gemini's
    // (deliberately hallucinated 'url') output.
    expect(body.recipe.metadata.source_type).toBe('manual');
    // Uploaded images were hosted onto our own /images/ mount.
    expect(body.recipe.main_image).toContain('/images/');
    expect(body.recipe.steps.every((step) => !step.image || step.image.includes('/images/'))).toBe(true);
    expect(body.recipe.steps.some((step) => step.image?.includes('/images/'))).toBe(true);
    // Ingredient images were assigned from the matcher's fake response.
    expect(body.recipe.ingredients.map((i) => i.image)).toEqual([
      'meat-beef-ground.png',
      'broccoli.png',
    ]);
  });

  it('degrades an invented matcher filename to INGREDIENT_NOT_FOUND.png with a warning', async () => {
    const app = makeApp(fakeGeminiSequence(
      () => Promise.resolve(VALID_MANUAL_CANDIDATE),
      () => Promise.resolve([
        { name: 'Ground Beef', amount_text: '500g', image: 'meat-beef-ground.png' },
        { name: 'Taco Shells', amount_text: '8', image: 'not-a-real-catalog-file.png' },
      ]),
    ));

    const res = await app.request('/api/ingest/manual', {
      method: 'POST',
      body: validFormData(),
    });
    const body = (await res.json()) as IngestManualSuccess;

    expect(res.status).toBe(200);
    expect(body.recipe.ingredients.map((i) => i.image)).toEqual([
      'meat-beef-ground.png',
      'INGREDIENT_NOT_FOUND.png',
    ]);
    expect(body.recipe.metadata.warnings.some((w) => w.includes('not in the catalog'))).toBe(true);
  });

  it('degrades all ingredient images to INGREDIENT_NOT_FOUND.png when the matcher fails both attempts', async () => {
    const app = makeApp(fakeGeminiSequence(
      () => Promise.resolve(VALID_MANUAL_CANDIDATE),
      () => Promise.reject(new Error('primary matcher call failed')),
      () => Promise.reject(new Error('retry matcher call failed')),
    ));

    const res = await app.request('/api/ingest/manual', {
      method: 'POST',
      body: validFormData(),
    });
    const body = (await res.json()) as IngestManualSuccess;

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.recipe.ingredients.map((i) => i.image)).toEqual([
      'INGREDIENT_NOT_FOUND.png',
      'INGREDIENT_NOT_FOUND.png',
    ]);
    expect(body.recipe.metadata.warnings.some((w) => w.includes('degradation') || w.includes('failed after retry'))).toBe(true);
  });

  it('returns 400 INVALID_INPUT when mainImage is missing', async () => {
    const app = makeApp(fakeGemini(() => Promise.resolve(VALID_MANUAL_CANDIDATE)));
    const form = validFormData();
    form.delete('mainImage');

    const res = await app.request('/api/ingest/manual', { method: 'POST', body: form });
    const body = (await res.json()) as ApiErrorEnvelope;

    expect(res.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('INVALID_INPUT');
  });

  it('returns 400 INVALID_INPUT when ingredientsText is missing', async () => {
    const app = makeApp(fakeGemini(() => Promise.resolve(VALID_MANUAL_CANDIDATE)));
    const form = validFormData();
    form.delete('ingredientsText');

    const res = await app.request('/api/ingest/manual', { method: 'POST', body: form });
    const body = (await res.json()) as ApiErrorEnvelope;

    expect(res.status).toBe(400);
    expect(body.error.code).toBe('INVALID_INPUT');
  });

  it('returns 400 INVALID_INPUT when stepsText is missing', async () => {
    const app = makeApp(fakeGemini(() => Promise.resolve(VALID_MANUAL_CANDIDATE)));
    const form = validFormData();
    form.delete('stepsText');

    const res = await app.request('/api/ingest/manual', { method: 'POST', body: form });
    const body = (await res.json()) as ApiErrorEnvelope;

    expect(res.status).toBe(400);
    expect(body.error.code).toBe('INVALID_INPUT');
  });

  it('returns 400 INVALID_INPUT when the multipart body exceeds MANUAL_REQUEST_MAX_BYTES', async () => {
    const app = makeApp(fakeGemini(() => Promise.resolve(VALID_MANUAL_CANDIDATE)), {
      MANUAL_REQUEST_MAX_BYTES: '10',
    });

    const res = await app.request('/api/ingest/manual', {
      method: 'POST',
      body: validFormData(),
    });
    const body = (await res.json()) as ApiErrorEnvelope;

    expect(res.status).toBe(400);
    expect(body.error.code).toBe('INVALID_INPUT');
  });

  it('returns AI_NORMALIZATION_FAILED when Gemini returns a stepless/titleless candidate', async () => {
    const app = makeApp(fakeGemini(() => Promise.resolve(STEPLESS_TITLELESS_CANDIDATE)));

    const res = await app.request('/api/ingest/manual', {
      method: 'POST',
      body: validFormData(),
    });
    const body = (await res.json()) as ApiErrorEnvelope;

    expect(res.status).toBe(502);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('AI_NORMALIZATION_FAILED');
  });
});
