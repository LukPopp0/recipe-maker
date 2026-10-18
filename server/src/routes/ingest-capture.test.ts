import dns from 'node:dns';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ApiErrorEnvelope, ApiSuccessEnvelope, CanonicalRecipe, UnhostedImage } from 'shared';
import { CanonicalRecipeSchema } from 'shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { loadServerEnv } from '../env.js';
import { loadGeminiConfig } from '../services/ai/config.js';
import type { GeminiClient } from '../services/ai/gemini-client.js';
import { LocalDiskStorageAdapter } from '../services/storage/local-disk-storage-adapter.js';
import { LocalJsonFileRecipeRepository } from '../services/recipes/local-json-file-recipe-repository.js';

const PAGE_URL = 'https://www.allrecipes.com/recipe/1/';
const GEMINI_MAIN_URL = 'https://cdn.example.com/gemini-main.jpg';
const STEP_URL = 'https://cdn.example.com/step1.jpg';
const MAIN_IMAGE_URL = 'https://www.allrecipes.com/thmb/a.jpg';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const RECIPE_HTML = `
  <html><head><title>Grandma's Lasagna</title></head>
  <body><article>
    <h1>Grandma's Lasagna</h1>
    <p>A classic baked lasagna recipe passed down for generations, full of rich
    tomato sauce, layers of pasta, and melted cheese.</p>
    <ul><li>500g lasagna sheets</li><li>400g ground beef</li></ul>
    <ol><li>Boil the lasagna sheets until al dente.</li><li>Brown the ground beef.</li></ol>
  </article></body></html>
`;
const EMPTY_HTML = '<html><head><title>Untitled</title></head><body></body></html>';

const candidate = (overrides: Record<string, unknown> = {}, stepImage: string | undefined = STEP_URL) => ({
  title: "Grandma's Lasagna",
  tags: ['dinner'],
  time: 60,
  ingredients: [
    { name: 'lasagna sheets', amount_text: '500g' },
    { name: 'ground beef', amount_text: '400g' },
  ],
  pantry_items: [],
  main_image: GEMINI_MAIN_URL,
  steps: [
    { step_header: 'Boil', step_description: 'Boil the lasagna sheets until al dente.', image: stepImage },
    { step_header: 'Brown', step_description: 'Brown the ground beef and mix with tomato sauce.' },
  ],
  metadata: { source_type: 'url', source_url: 'https://hallucinated.example/x', language: 'en', warnings: [] },
  ...overrides,
});

type CaptureSuccess = ApiSuccessEnvelope<{
  recipe: CanonicalRecipe
  diagnostics: { extractor: string; fetchMode: string; usedJsonLd: boolean }
  imageNamespaceId: string
  unhosted: UnhostedImage[]
}>

describe('POST /api/ingest/capture', () => {
  const originalFetch = globalThis.fetch;
  let dataDir: string;
  let imageDir: string;
  let fetchSpy: ReturnType<typeof vi.fn>;
  let geminiSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'capture-recipes-'));
    imageDir = await mkdtemp(path.join(tmpdir(), 'capture-images-'));
    vi.spyOn(dns.promises, 'lookup').mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    fetchSpy = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url === STEP_URL || url === MAIN_IMAGE_URL || url === GEMINI_MAIN_URL) {
        return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200, headers: { 'content-type': 'image/png' } });
      }
      return new Response('not found', { status: 404 });
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    globalThis.fetch = originalFetch;
    await rm(dataDir, { recursive: true, force: true });
    await rm(imageDir, { recursive: true, force: true });
  });

  // Answers the extraction call with `extracted`, then the ingredient matcher.
  function makeApp(extracted: unknown = candidate(), envOverrides: Record<string, string> = {}) {
    geminiSpy = vi.fn();
    geminiSpy.mockImplementationOnce(async () => extracted);
    geminiSpy.mockImplementation(async () => [
      { name: 'Lasagna Sheets', amount_text: '500g', image: 'pasta-linguine.png' },
      { name: 'Ground Beef', amount_text: '400g', image: 'meat-beef-ground.png' },
    ]);
    const env = loadServerEnv({
      RECIPE_DATA_DIR: dataDir,
      IMAGE_DATA_DIR: imageDir,
      BROWSER_FALLBACK_ENABLED: 'false',
      ...envOverrides,
    });
    return createApp({
      env,
      checkStorageReady: () => true,
      recipeRepository: new LocalJsonFileRecipeRepository(dataDir),
      geminiClient: { generateCanonicalRecipe: geminiSpy } as unknown as GeminiClient,
      geminiConfig: loadGeminiConfig({}),
      storageAdapter: new LocalDiskStorageAdapter(env.IMAGE_DATA_DIR, env.PUBLIC_BASE_URL),
      defaultMainImageUrl: '/images/placeholder-recipe.png',
    });
  }

  function form(fields: Record<string, string | File | undefined> = {}) {
    const f = new FormData();
    const all: Record<string, string | File | undefined> = { url: PAGE_URL, html: RECIPE_HTML, ...fields };
    for (const [k, v] of Object.entries(all)) if (v !== undefined) f.append(k, v);
    return f;
  }

  const post = (app: ReturnType<typeof makeApp>, body: FormData) =>
    app.request('/api/ingest/capture', { method: 'POST', body });

  const pngFile = (type = 'image/png') => new File([new Uint8Array([9, 8, 7, 6])], 'main.png', { type });
  const fetchedUrls = () => fetchSpy.mock.calls.map(([u]) => String(u));

  it('ingests captured HTML without fetching the page', async () => {
    const res = await post(makeApp(), form());
    expect(res.status).toBe(200);
    const body = (await res.json()) as CaptureSuccess;
    expect(fetchedUrls()).not.toContain(PAGE_URL);
    expect(body.diagnostics.fetchMode).toBe('capture');
    expect(body.recipe.metadata).toMatchObject({ source_type: 'url', source_url: PAGE_URL });
    expect(body.imageNamespaceId).toMatch(UUID_RE);
    expect(CanonicalRecipeSchema.safeParse(body.recipe).success).toBe(true);
    expect(body.unhosted).toEqual([]);
  });

  it("hosts main image bytes from the client over Gemini's pick", async () => {
    const res = await post(makeApp(), form({ mainImageUrl: MAIN_IMAGE_URL, mainImage: pngFile() }));
    const body = (await res.json()) as CaptureSuccess;
    expect(res.status).toBe(200);
    expect(body.recipe.main_image).toMatch(/main-0-[0-9a-f]{8}\.(jpg|png)$/);
    expect(fetchedUrls()).not.toContain(GEMINI_MAIN_URL);
    expect(fetchedUrls()).not.toContain(MAIN_IMAGE_URL);
    expect(body.unhosted).toEqual([]);
  });

  it('downloads mainImageUrl when only the URL was sent', async () => {
    const res = await post(makeApp(), form({ mainImageUrl: MAIN_IMAGE_URL }));
    const body = (await res.json()) as CaptureSuccess;
    expect(body.recipe.main_image).toMatch(/\/images\/recipes\/.+main-0/);
    expect(fetchedUrls()).toContain(MAIN_IMAGE_URL);
    expect(fetchedUrls()).not.toContain(GEMINI_MAIN_URL);
    expect(body.unhosted).toEqual([]);
  });

  it('falls back to the placeholder and lists main as unhosted when the bytes are rejected', async () => {
    const res = await post(makeApp(), form({ mainImageUrl: MAIN_IMAGE_URL, mainImage: pngFile('text/plain') }));
    const body = (await res.json()) as CaptureSuccess;
    expect(res.status).toBe(200);
    expect(body.recipe.main_image).toBe('/images/placeholder-recipe.png');
    expect(body.unhosted.filter((u) => u.slot === 'main')).toHaveLength(1);
    const entry = body.unhosted.find((u) => u.slot === 'main')!;
    expect(entry.url).toBe(MAIN_IMAGE_URL);
    expect(entry.warning).toContain('unsupported content type');
    expect(body.recipe.metadata.warnings).toContain(entry.warning);
  });

  it('lists a step image the server cannot download', async () => {
    fetchSpy.mockImplementation(async (input: string | URL) =>
      String(input) === STEP_URL
        ? new Response('no', { status: 403 })
        : new Response(new Uint8Array([1, 2, 3, 4]), { status: 200, headers: { 'content-type': 'image/png' } }),
    );
    const res = await post(makeApp(), form());
    const body = (await res.json()) as CaptureSuccess;
    expect(body.recipe.steps[0].image).toBeUndefined();
    expect(body.unhosted).toContainEqual(expect.objectContaining({ slot: 0, url: STEP_URL }));
    expect(body.unhosted.find((u) => u.slot === 0)!.warning).toMatch(/^Step 1 image was not re-hosted/);
  });

  it('overrides a hallucinated source_url with the captured url', async () => {
    const res = await post(makeApp(), form());
    const body = (await res.json()) as CaptureSuccess;
    expect(body.recipe.metadata.source_url).toBe(PAGE_URL);
    expect(body.recipe.metadata.source_url).not.toContain('hallucinated');
  });

  it('does not re-download client bytes hosted under an absolute PUBLIC_BASE_URL', async () => {
    const app = makeApp(candidate(), { PUBLIC_BASE_URL: 'https://recipes.example' });
    const res = await post(app, form({ mainImageUrl: MAIN_IMAGE_URL, mainImage: pngFile() }));
    const body = (await res.json()) as CaptureSuccess;
    expect(res.status).toBe(200);
    expect(body.recipe.main_image.startsWith('https://recipes.example/images/')).toBe(true);
    expect(fetchedUrls().some((u) => u.startsWith('https://recipes.example'))).toBe(false);
  });

  it('blocks private-address step images from a captured page and still succeeds', async () => {
    const app = makeApp(candidate({}, 'http://192.168.1.10/img/s1.jpg'));
    const res = await post(app, form({ url: 'http://192.168.1.10/r' }));
    const body = (await res.json()) as CaptureSuccess;
    expect(res.status).toBe(200);
    expect(body.unhosted).toContainEqual(expect.objectContaining({ slot: 0 }));
    expect(fetchedUrls().some((u) => u.includes('192.168.1.10'))).toBe(false);
  });

  it('rejects html over URL_MAX_RESPONSE_BYTES with INVALID_INPUT', async () => {
    const res = await post(makeApp(candidate(), { URL_MAX_RESPONSE_BYTES: '1000' }), form({ html: 'a'.repeat(1001) }));
    const body = (await res.json()) as ApiErrorEnvelope;
    expect(res.status).toBe(400);
    expect(body.error.code).toBe('INVALID_INPUT');
    expect(body.error.message).toBe('The captured page exceeds the 1000-byte limit.');
  });

  it('rejects a non-http url with INVALID_URL', async () => {
    const res = await post(makeApp(), form({ url: 'javascript:alert(1)' }));
    const body = (await res.json()) as ApiErrorEnvelope;
    expect(res.status).toBe(400);
    expect(body.error.code).toBe('INVALID_URL');
  });

  it('rejects a missing or empty html field', async () => {
    const res = await post(makeApp(), form({ html: '' }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as ApiErrorEnvelope).error.code).toBe('INVALID_INPUT');
  });

  it('rejects a non-http mainImageUrl', async () => {
    const res = await post(makeApp(), form({ mainImageUrl: 'ftp://x.example/a.jpg' }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as ApiErrorEnvelope).error.code).toBe('INVALID_INPUT');
  });

  it('rejects mainImage without mainImageUrl', async () => {
    const res = await post(makeApp(), form({ mainImage: pngFile() }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as ApiErrorEnvelope).error.code).toBe('INVALID_INPUT');
  });

  it('rejects a page without recipe content before calling Gemini', async () => {
    const app = makeApp();
    const res = await post(app, form({ html: EMPTY_HTML }));
    expect(res.status).toBe(422);
    expect(((await res.json()) as ApiErrorEnvelope).error.code).toBe('URL_EXTRACTION_FAILED');
    expect(geminiSpy).not.toHaveBeenCalled();
  });

  it('logs one fetch line with fetchMode capture and the captured url', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await post(makeApp(), form());
    const lines = logSpy.mock.calls
      .map(([l]) => JSON.parse(String(l)) as Record<string, unknown>)
      .filter((l) => l.stage === 'fetch');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ outcome: 'ok', fetchMode: 'capture', url: PAGE_URL });
  });

  it('is rate limited like the other ingest routes', async () => {
    const app = makeApp(candidate(), { RATE_LIMIT_MAX: '1' });
    expect((await post(app, form())).status).toBe(200);
    const second = await post(app, form());
    expect(second.status).toBe(429);
    expect(((await second.json()) as ApiErrorEnvelope).error.code).toBe('RATE_LIMITED');
  });
});
