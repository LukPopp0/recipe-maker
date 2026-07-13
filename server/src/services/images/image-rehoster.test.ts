import dns from 'node:dns';
import type { CanonicalRecipe } from 'shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StorageAdapter } from '../storage/storage-adapter.js';
import { ALLOWED_CONTENT_TYPES, rehostRecipeImages } from './image-rehoster.js';

// source.example.com is a fake hostname used throughout these tests; stub DNS
// resolution to a public address so resolveAndCheckHost's guard (exercised as
// part of rehostRecipeImages now) doesn't attempt a real network lookup.
function mockPublicDns() {
  vi.spyOn(dns.promises, 'lookup').mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
}

function makeRecipe(overrides: Partial<CanonicalRecipe> = {}): CanonicalRecipe {
  return {
    title: 'Test Recipe',
    tags: ['quick'],
    time: 20,
    ingredients: [{ name: 'Salt', amount_text: '1 tsp' }],
    pantry_items: ['salt'],
    main_image: 'https://source.example.com/photo.jpg',
    steps: [{ step_header: 'Cook', step_description: 'Cook it.' }],
    metadata: { source_type: 'url', language: 'en', warnings: [] },
    ...overrides,
  };
}

function makeStorageAdapter(): StorageAdapter & { put: ReturnType<typeof vi.fn> } {
  return {
    put: vi.fn().mockImplementation((_buffer: Buffer, key: string) =>
      Promise.resolve(`http://localhost:8787/images/${key}`),
    ),
    get: vi.fn(),
    delete: vi.fn(),
  };
}

describe('ALLOWED_CONTENT_TYPES export', () => {
  it('exports the allowed content types map for reuse', () => {
    expect(ALLOWED_CONTENT_TYPES).toEqual({
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
    });
  });
});

describe('rehostRecipeImages', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
    mockPublicDns();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('downloads and re-hosts a valid remote main_image, replacing the URL', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(bytes, { status: 200, headers: { 'content-type': 'image/jpeg' } }),
    );
    const storageAdapter = makeStorageAdapter();
    const recipe = makeRecipe();

    const result = await rehostRecipeImages(recipe, {
      recipeId: 'recipe-1',
      storageAdapter,
      maxBytes: 1_000_000,
    });

    expect(result.warnings).toEqual([]);
    expect(result.recipe.main_image).toBe('http://localhost:8787/images/recipes/recipe-1/main-0.jpg');
    expect(storageAdapter.put).toHaveBeenCalledWith(Buffer.from(bytes), 'recipes/recipe-1/main-0.jpg', 'image/jpeg');
  });

  it('leaves main_image untouched and warns on an unsupported MIME type', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1]), { status: 200, headers: { 'content-type': 'image/gif' } }),
    );
    const storageAdapter = makeStorageAdapter();
    const recipe = makeRecipe();

    const result = await rehostRecipeImages(recipe, {
      recipeId: 'recipe-1',
      storageAdapter,
      maxBytes: 1_000_000,
    });

    expect(result.recipe.main_image).toBe(recipe.main_image);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/unsupported content type/i);
    expect(storageAdapter.put).not.toHaveBeenCalled();
  });

  it('leaves main_image untouched and warns when the image exceeds maxBytes', async () => {
    const bytes = new Uint8Array(10);
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(bytes, { status: 200, headers: { 'content-type': 'image/png' } }),
    );
    const storageAdapter = makeStorageAdapter();
    const recipe = makeRecipe();

    const result = await rehostRecipeImages(recipe, {
      recipeId: 'recipe-1',
      storageAdapter,
      maxBytes: 5,
    });

    expect(result.recipe.main_image).toBe(recipe.main_image);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/exceeded/i);
    expect(storageAdapter.put).not.toHaveBeenCalled();
  });

  it('leaves main_image untouched and warns on a fetch/network failure', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const storageAdapter = makeStorageAdapter();
    const recipe = makeRecipe();

    const result = await rehostRecipeImages(recipe, {
      recipeId: 'recipe-1',
      storageAdapter,
      maxBytes: 1_000_000,
    });

    expect(result.recipe.main_image).toBe(recipe.main_image);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/failed to download/i);
    expect(storageAdapter.put).not.toHaveBeenCalled();
  });

  it('leaves main_image untouched and warns on a non-ok HTTP response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
    const storageAdapter = makeStorageAdapter();
    const recipe = makeRecipe();

    const result = await rehostRecipeImages(recipe, {
      recipeId: 'recipe-1',
      storageAdapter,
      maxBytes: 1_000_000,
    });

    expect(result.recipe.main_image).toBe(recipe.main_image);
    expect(result.warnings).toHaveLength(1);
    expect(storageAdapter.put).not.toHaveBeenCalled();
  });

  it('does not re-download a main_image that already matches the configured default', async () => {
    globalThis.fetch = vi.fn();
    const storageAdapter = makeStorageAdapter();
    const defaultUrl = 'https://cdn.example.com/default.png';
    const recipe = makeRecipe({ main_image: defaultUrl });

    const result = await rehostRecipeImages(recipe, {
      recipeId: 'recipe-1',
      storageAdapter,
      maxBytes: 1_000_000,
      defaultMainImageUrl: defaultUrl,
    });

    expect(result.recipe.main_image).toBe(defaultUrl);
    expect(result.warnings).toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(storageAdapter.put).not.toHaveBeenCalled();
  });

  it('leaves main_image untouched and warns, without ever fetching, when the URL resolves to a blocked network address', async () => {
    globalThis.fetch = vi.fn();
    const storageAdapter = makeStorageAdapter();
    const recipe = makeRecipe({ main_image: 'http://169.254.169.254/image.jpg' });

    const result = await rehostRecipeImages(recipe, {
      recipeId: 'recipe-1',
      storageAdapter,
      maxBytes: 1_000_000,
    });

    expect(result.recipe.main_image).toBe(recipe.main_image);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/blocked or invalid/i);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(storageAdapter.put).not.toHaveBeenCalled();
  });

  it('leaves main_image untouched and warns when the image download times out', async () => {
    globalThis.fetch = vi.fn().mockImplementation((_input: string | URL, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('The operation was aborted.');
          err.name = 'AbortError';
          reject(err);
        });
      });
    });
    const storageAdapter = makeStorageAdapter();
    const recipe = makeRecipe();

    const result = await rehostRecipeImages(recipe, {
      recipeId: 'recipe-1',
      storageAdapter,
      maxBytes: 1_000_000,
      timeoutMs: 5,
    });

    expect(result.recipe.main_image).toBe(recipe.main_image);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/timed out/i);
    expect(storageAdapter.put).not.toHaveBeenCalled();
  });

  it('re-hosts remote step images under step-{index} keys and rewrites steps[].image', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    // Fresh Response per call - a shared instance's body stream can only be
    // consumed once.
    globalThis.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve(new Response(bytes, { status: 200, headers: { 'content-type': 'image/jpeg' } })),
    );
    const storageAdapter = makeStorageAdapter();
    const recipe = makeRecipe({
      steps: [
        { step_header: 'Chop', step_description: 'Chop it.', image: 'https://source.example.com/step1.jpg' },
        { step_header: 'Cook', step_description: 'Cook it.' },
        { step_header: 'Serve', step_description: 'Serve it.', image: 'https://source.example.com/step3.jpg' },
      ],
    });

    const result = await rehostRecipeImages(recipe, {
      recipeId: 'recipe-1',
      storageAdapter,
      maxBytes: 1_000_000,
    });

    expect(result.warnings).toEqual([]);
    expect(result.recipe.steps[0].image).toBe('http://localhost:8787/images/recipes/recipe-1/step-0.jpg');
    expect(result.recipe.steps[1].image).toBeUndefined();
    expect(result.recipe.steps[2].image).toBe('http://localhost:8787/images/recipes/recipe-1/step-2.jpg');
    expect(storageAdapter.put).toHaveBeenCalledWith(Buffer.from(bytes), 'recipes/recipe-1/step-0.jpg', 'image/jpeg');
    expect(storageAdapter.put).toHaveBeenCalledWith(Buffer.from(bytes), 'recipes/recipe-1/step-2.jpg', 'image/jpeg');
  });

  it('drops a step image and warns when its download fails, leaving other steps intact', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    globalThis.fetch = vi.fn().mockImplementation((input: string | URL) => {
      const url = String(input);
      if (url.includes('bad')) {
        return Promise.resolve(new Response(null, { status: 404 }));
      }
      return Promise.resolve(new Response(bytes, { status: 200, headers: { 'content-type': 'image/jpeg' } }));
    });
    const storageAdapter = makeStorageAdapter();
    const recipe = makeRecipe({
      steps: [
        { step_header: 'Chop', step_description: 'Chop it.', image: 'https://source.example.com/bad.jpg' },
        { step_header: 'Cook', step_description: 'Cook it.', image: 'https://source.example.com/good.jpg' },
      ],
    });

    const result = await rehostRecipeImages(recipe, {
      recipeId: 'recipe-1',
      storageAdapter,
      maxBytes: 1_000_000,
    });

    expect(result.recipe.steps[0].image).toBeUndefined();
    expect(result.recipe.steps[1].image).toBe('http://localhost:8787/images/recipes/recipe-1/step-1.jpg');
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/^Step 1 image was not re-hosted/);
  });

  it('does not attempt to download non-http(s) step images (e.g. already local paths)', async () => {
    const bytes = new Uint8Array([1, 2]);
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(bytes, { status: 200, headers: { 'content-type': 'image/jpeg' } }),
    );
    const storageAdapter = makeStorageAdapter();
    const recipe = makeRecipe({
      main_image: '/images/recipes/recipe-1/main-0.jpg',
      steps: [{ step_header: 'Cook', step_description: 'Cook it.', image: '/images/recipes/recipe-1/step-0.jpg' }],
    });

    const result = await rehostRecipeImages(recipe, {
      recipeId: 'recipe-1',
      storageAdapter,
      maxBytes: 1_000_000,
    });

    expect(result.recipe.steps[0].image).toBe('/images/recipes/recipe-1/step-0.jpg');
    expect(result.warnings).toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('does not attempt to download a non-http(s) main_image (e.g. already a local path)', async () => {
    globalThis.fetch = vi.fn();
    const storageAdapter = makeStorageAdapter();
    const recipe = makeRecipe({ main_image: '/images/recipes/recipe-1/main-0.jpg' });

    const result = await rehostRecipeImages(recipe, {
      recipeId: 'recipe-1',
      storageAdapter,
      maxBytes: 1_000_000,
    });

    expect(result.recipe.main_image).toBe('/images/recipes/recipe-1/main-0.jpg');
    expect(result.warnings).toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
