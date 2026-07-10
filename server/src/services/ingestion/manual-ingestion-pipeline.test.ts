import dns from 'node:dns';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadGeminiConfig } from '../ai/config.js';
import type { GeminiClient } from '../ai/gemini-client.js';
import type { ManualImageInput, ParsedManualUpload } from '../manual-ingestion/manual-upload-parser.js';
import type { StorageAdapter } from '../storage/storage-adapter.js';
import { runManualIngestionPipeline } from './manual-ingestion-pipeline.js';

function makeStorageAdapter(): StorageAdapter & { put: ReturnType<typeof vi.fn> } {
  let counter = 0;
  return {
    put: vi.fn().mockImplementation(async (_buffer: Buffer, key: string) => {
      counter += 1;
      return `http://localhost:8787/images/${key}?v=${counter}`;
    }),
    get: vi.fn(),
    delete: vi.fn(),
  };
}

// Builds a file-kind image input (the discriminated-union variant the parser
// produces for uploaded files).
function fileInput(overrides: Partial<{ buffer: Buffer; contentType: string; filename: string }> = {}): ManualImageInput {
  const file = { buffer: Buffer.from([1, 2, 3, 4]), contentType: 'image/jpeg', filename: 'photo.jpg', ...overrides };
  return { kind: 'file', filename: file.filename, file };
}

// Builds a url-kind image input; the pipeline fetches these via the mocked
// global fetch.
function urlInput(url: string, filename?: string): ManualImageInput {
  const segments = new URL(url).pathname.split('/').filter(Boolean);
  return { kind: 'url', filename: filename ?? segments[segments.length - 1] ?? url, url };
}

function makeParsed(overrides: Partial<ParsedManualUpload> = {}): ParsedManualUpload {
  return {
    ingredientsText: '2 eggs\n1 cup flour',
    stepsText: 'Mix everything.\nBake at 180C.',
    mainImage: fileInput({ filename: 'main.jpg' }),
    stepImages: [],
    ...overrides,
  };
}

// Stubs DNS + a 200 image response so url-kind image inputs resolve and
// download successfully through the SSRF guard without real network I/O.
function mockImageFetch(contentType = 'image/jpeg') {
  vi.spyOn(dns.promises, 'lookup').mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
  globalThis.fetch = vi.fn().mockResolvedValue(
    new Response(new Uint8Array([9, 9, 9, 9]), { status: 200, headers: { 'content-type': contentType } }),
  ) as unknown as typeof fetch;
}

function fakeGeminiClient(handler: (params: unknown) => Promise<unknown>): GeminiClient {
  return { generateCanonicalRecipe: handler } as unknown as GeminiClient;
}

const VALID_CANDIDATE = {
  title: 'Pancakes',
  tags: [],
  time: 20,
  ingredients: [{ name: 'flour', amount_text: '1 cup' }],
  pantry_items: [],
  steps: [
    { step_header: 'Mix', step_description: 'Mix everything.' },
    { step_header: 'Bake', step_description: 'Bake at 180C.' },
  ],
  metadata: { source_type: 'manual', language: 'en', warnings: [] },
};

const GARBAGE_CANDIDATE = { foo: 'bar' };

function makeGeminiConfig() {
  return loadGeminiConfig({});
}

describe('runManualIngestionPipeline', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = originalFetch;
  });

  it('fetches and hosts a url-kind main image', async () => {
    mockImageFetch();
    const storageAdapter = makeStorageAdapter();
    const geminiClient = fakeGeminiClient(vi.fn().mockResolvedValue(VALID_CANDIDATE));

    const parsed = makeParsed({ mainImage: urlInput('https://cdn.example.com/main.jpg') });

    const result = await runManualIngestionPipeline({
      parsed,
      geminiClient,
      geminiConfig: makeGeminiConfig(),
      storageAdapter,
      recipeId: 'recipe-1',
      maxImageBytes: 1024,
      requestId: 'req-url-1',
    });

    expect(result.warnings).toEqual([]);
    expect(result.recipeCandidate.main_image).toContain('recipes/recipe-1/main-0.jpg');
    expect(globalThis.fetch).toHaveBeenCalledOnce();
  });

  it('orders mixed file and url step images deterministically by filename', async () => {
    mockImageFetch();
    const storageAdapter = makeStorageAdapter();
    const geminiClient = fakeGeminiClient(vi.fn().mockResolvedValue(VALID_CANDIDATE));

    // step-b.jpg (url) sorts after step-a.jpg (file) -> file assigned to step 0.
    const parsed = makeParsed({
      stepImages: [urlInput('https://cdn.example.com/step-b.jpg'), fileInput({ filename: 'step-a.jpg' })],
    });

    const result = await runManualIngestionPipeline({
      parsed,
      geminiClient,
      geminiConfig: makeGeminiConfig(),
      storageAdapter,
      recipeId: 'recipe-1',
      maxImageBytes: 1024,
      requestId: 'req-url-2',
    });

    expect(result.warnings).toEqual([]);
    expect(result.recipeCandidate.steps[0].image).toContain('recipes/recipe-1/step-0.jpg');
    expect(result.recipeCandidate.steps[1].image).toContain('recipes/recipe-1/step-1.jpg');
  });

  it('hosts url step images in add order, not filename order', async () => {
    mockImageFetch();
    const storageAdapter = makeStorageAdapter();
    const geminiClient = fakeGeminiClient(vi.fn().mockResolvedValue(VALID_CANDIDATE));

    // Added z.jpg then a.jpg. Filename sort would host a.jpg first; add order
    // must host z.jpg first because the server-side stored name is not
    // user-controllable for URL images.
    const parsed = makeParsed({
      stepImages: [
        urlInput('https://cdn.example.com/z.jpg'),
        urlInput('https://cdn.example.com/a.jpg'),
      ],
    });

    await runManualIngestionPipeline({
      parsed,
      geminiClient,
      geminiConfig: makeGeminiConfig(),
      storageAdapter,
      recipeId: 'recipe-1',
      maxImageBytes: 1024,
      requestId: 'req-url-order',
    });

    const fetchedUrls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.map((call) =>
      String(call[0]),
    );
    expect(fetchedUrls).toEqual(['https://cdn.example.com/z.jpg', 'https://cdn.example.com/a.jpg']);
  });

  it('warns and leaves main_image unset when a url main image fails to fetch', async () => {
    vi.spyOn(dns.promises, 'lookup').mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 404 })) as unknown as typeof fetch;
    const storageAdapter = makeStorageAdapter();
    const geminiClient = fakeGeminiClient(vi.fn().mockResolvedValue(VALID_CANDIDATE));

    const parsed = makeParsed({ mainImage: urlInput('https://cdn.example.com/missing.jpg') });

    const result = await runManualIngestionPipeline({
      parsed,
      geminiClient,
      geminiConfig: makeGeminiConfig(),
      storageAdapter,
      recipeId: 'recipe-1',
      maxImageBytes: 1024,
      requestId: 'req-url-3',
    });

    expect(result.recipeCandidate.main_image).toBeUndefined();
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('https://cdn.example.com/missing.jpg');
    expect(storageAdapter.put).not.toHaveBeenCalled();
  });

  it('hosts the main image, assigns step images by index, and returns no warnings on the happy path', async () => {
    const storageAdapter = makeStorageAdapter();
    const generateCanonicalRecipe = vi.fn().mockResolvedValue(VALID_CANDIDATE);
    const geminiClient = fakeGeminiClient(generateCanonicalRecipe);

    const parsed = makeParsed({
      stepImages: [
        fileInput({ filename: 'step-2.jpg' }),
        fileInput({ filename: 'step-1.jpg' }),
      ],
    });

    const result = await runManualIngestionPipeline({
      parsed,
      geminiClient,
      geminiConfig: makeGeminiConfig(),
      storageAdapter,
      recipeId: 'recipe-1',
      maxImageBytes: 1024,
      requestId: 'req-1',
    });

    expect(result.warnings).toEqual([]);
    expect(result.recipeCandidate.main_image).toContain('recipes/recipe-1/main-0.jpg');
    expect(result.recipeCandidate.steps).toHaveLength(2);
    // step-1.jpg sorts before step-2.jpg (natural sort), so it is hosted first
    // and assigned to step index 0.
    expect(result.recipeCandidate.steps[0].image).toContain('recipes/recipe-1/step-0.jpg');
    expect(result.recipeCandidate.steps[1].image).toContain('recipes/recipe-1/step-1.jpg');
    expect(result.diagnostics.extractor).toBe('gemini-primary');
    expect(result.diagnostics.model).toBe('gemini-3.1-flash-lite');
    expect(result.diagnostics.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('warns and leaves main_image unset when the main image is oversized', async () => {
    const storageAdapter = makeStorageAdapter();
    const generateCanonicalRecipe = vi.fn().mockResolvedValue(VALID_CANDIDATE);
    const geminiClient = fakeGeminiClient(generateCanonicalRecipe);

    const parsed = makeParsed({
      mainImage: fileInput({ buffer: Buffer.alloc(2048), filename: 'main.jpg' }),
    });

    const result = await runManualIngestionPipeline({
      parsed,
      geminiClient,
      geminiConfig: makeGeminiConfig(),
      storageAdapter,
      recipeId: 'recipe-1',
      maxImageBytes: 1024,
      requestId: 'req-2',
    });

    expect(result.recipeCandidate.main_image).toBeUndefined();
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('main.jpg');
  });

  it('produces an ignored-count warning when there are more step images than steps', async () => {
    const storageAdapter = makeStorageAdapter();
    const generateCanonicalRecipe = vi.fn().mockResolvedValue(VALID_CANDIDATE);
    const geminiClient = fakeGeminiClient(generateCanonicalRecipe);

    const parsed = makeParsed({
      stepImages: [
        fileInput({ filename: 'step-1.jpg' }),
        fileInput({ filename: 'step-2.jpg' }),
        fileInput({ filename: 'step-3.jpg' }),
      ],
    });

    const result = await runManualIngestionPipeline({
      parsed,
      geminiClient,
      geminiConfig: makeGeminiConfig(),
      storageAdapter,
      recipeId: 'recipe-1',
      maxImageBytes: 1024,
      requestId: 'req-3',
    });

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/1 step image\(s\) were ignored/);
    expect(result.recipeCandidate.steps).toHaveLength(2);
  });

  it('throws AI_NORMALIZATION_FAILED when Gemini returns a title-less/stepless candidate', async () => {
    const storageAdapter = makeStorageAdapter();
    const generateCanonicalRecipe = vi.fn().mockResolvedValue(GARBAGE_CANDIDATE);
    const geminiClient = fakeGeminiClient(generateCanonicalRecipe);

    const parsed = makeParsed();

    await expect(
      runManualIngestionPipeline({
        parsed,
        geminiClient,
        geminiConfig: makeGeminiConfig(),
        storageAdapter,
        recipeId: 'recipe-1',
        maxImageBytes: 1024,
        requestId: 'req-4',
      }),
    ).rejects.toMatchObject({ code: 'AI_NORMALIZATION_FAILED' });
  });

  it('forces tags to an empty array even if Gemini hallucinates tags anyway', async () => {
    const storageAdapter = makeStorageAdapter();
    const generateCanonicalRecipe = vi
      .fn()
      .mockResolvedValue({ ...VALID_CANDIDATE, tags: ['Quick', 'Spicy'] });
    const geminiClient = fakeGeminiClient(generateCanonicalRecipe);

    const parsed = makeParsed();

    const result = await runManualIngestionPipeline({
      parsed,
      geminiClient,
      geminiConfig: makeGeminiConfig(),
      storageAdapter,
      recipeId: 'recipe-1',
      maxImageBytes: 1024,
      requestId: 'req-6',
    });

    expect(result.recipeCandidate.tags).toEqual([]);
  });

  it('is deterministic: the same input run twice produces identical recipeCandidate (excluding durationMs)', async () => {
    const parsed = makeParsed({
      stepImages: [fileInput({ filename: 'step-1.jpg' }), fileInput({ filename: 'step-2.jpg' })],
    });

    const run = async () => {
      const storageAdapter = makeStorageAdapter();
      const generateCanonicalRecipe = vi.fn().mockResolvedValue(VALID_CANDIDATE);
      const geminiClient = fakeGeminiClient(generateCanonicalRecipe);

      return runManualIngestionPipeline({
        parsed,
        geminiClient,
        geminiConfig: makeGeminiConfig(),
        storageAdapter,
        recipeId: 'recipe-1',
        maxImageBytes: 1024,
        requestId: 'req-5',
      });
    };

    const first = await run();
    const second = await run();

    expect(first.recipeCandidate).toEqual(second.recipeCandidate);
    expect(first.warnings).toEqual(second.warnings);
    expect(first.diagnostics.extractor).toEqual(second.diagnostics.extractor);
    expect(first.diagnostics.model).toEqual(second.diagnostics.model);
  });

  describe('stage logging', () => {
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

    it('emits host-images and normalize ok logs on the happy path', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const storageAdapter = makeStorageAdapter();
      const generateCanonicalRecipe = vi.fn().mockResolvedValue(VALID_CANDIDATE);
      const geminiClient = fakeGeminiClient(generateCanonicalRecipe);

      const parsed = makeParsed({
        stepImages: [fileInput({ filename: 'step-1.jpg' })],
      });

      await runManualIngestionPipeline({
        parsed,
        geminiClient,
        geminiConfig: makeGeminiConfig(),
        storageAdapter,
        recipeId: 'recipe-1',
        maxImageBytes: 1024,
        requestId: 'req-log-1',
      });

      const lines = stageLogLines(logSpy);
      const hostImagesLine = lines.find((l) => l.stage === 'host-images');
      const normalizeLine = lines.find((l) => l.stage === 'normalize');

      expect(hostImagesLine).toMatchObject({
        requestId: 'req-log-1',
        stage: 'host-images',
        outcome: 'ok',
      });
      expect(normalizeLine).toMatchObject({
        requestId: 'req-log-1',
        stage: 'normalize',
        outcome: 'ok',
      });
    });

    it('emits a normalize error log when the structural pre-check fails', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const storageAdapter = makeStorageAdapter();
      const generateCanonicalRecipe = vi.fn().mockResolvedValue(GARBAGE_CANDIDATE);
      const geminiClient = fakeGeminiClient(generateCanonicalRecipe);

      const parsed = makeParsed();

      await expect(
        runManualIngestionPipeline({
          parsed,
          geminiClient,
          geminiConfig: makeGeminiConfig(),
          storageAdapter,
          recipeId: 'recipe-1',
          maxImageBytes: 1024,
          requestId: 'req-log-2',
        }),
      ).rejects.toMatchObject({ code: 'AI_NORMALIZATION_FAILED' });

      const lines = stageLogLines(logSpy);
      const normalizeErrorLine = lines.find((l) => l.stage === 'normalize' && l.outcome === 'error');

      expect(normalizeErrorLine).toMatchObject({
        requestId: 'req-log-2',
        stage: 'normalize',
        outcome: 'error',
        errorCode: 'AI_NORMALIZATION_FAILED',
      });
    });
  });
});
