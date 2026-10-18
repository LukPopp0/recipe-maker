import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import dns from 'node:dns';
import path from 'node:path';
import type { ApiErrorEnvelope, ApiSuccessEnvelope } from 'shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { loadServerEnv } from '../env.js';
import { loadGeminiConfig } from '../services/ai/config.js';
import type { GeminiClient } from '../services/ai/gemini-client.js';
import { LocalDiskStorageAdapter } from '../services/storage/local-disk-storage-adapter.js';
import { LocalJsonFileRecipeRepository } from '../services/recipes/local-json-file-recipe-repository.js';

// Integration tests for POST /api/image/step (docs/specs/14): the review panel's
// standalone step-image upload. Gemini is never involved - the client stub
// throws if called.

const NAMESPACE = '123e4567-e89b-42d3-a456-426614174000';

type UploadSuccess = ApiSuccessEnvelope<{ url: string }>

describe('POST /api/image/step', () => {
  let dataDir: string;
  let imageDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'image-route-recipes-'));
    imageDir = await mkdtemp(path.join(tmpdir(), 'image-route-images-'));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(dataDir, { recursive: true, force: true });
    await rm(imageDir, { recursive: true, force: true });
  });

  function makeApp() {
    const env = loadServerEnv({ RECIPE_DATA_DIR: dataDir, IMAGE_DATA_DIR: imageDir, BROWSER_FALLBACK_ENABLED: 'false' });
    const geminiClient = {
      generateCanonicalRecipe: vi.fn(() => Promise.reject(new Error('gemini must not be called'))),
    } as unknown as GeminiClient;
    return createApp({
      env,
      checkStorageReady: () => true,
      recipeRepository: new LocalJsonFileRecipeRepository(dataDir),
      geminiClient,
      geminiConfig: loadGeminiConfig({}),
      storageAdapter: new LocalDiskStorageAdapter(env.IMAGE_DATA_DIR, env.PUBLIC_BASE_URL),
      defaultMainImageUrl: '/images/placeholder-recipe.png',
    });
  }

  function makeForm(overrides: Partial<{ namespaceId: string; stepIndex: string; file: File | null }> = {}): FormData {
    const form = new FormData();
    form.set('namespaceId', overrides.namespaceId ?? NAMESPACE);
    form.set('stepIndex', overrides.stepIndex ?? '1');
    const file = overrides.file === undefined
      ? new File([new Uint8Array([1, 2, 3, 4])], 'step.png', { type: 'image/png' })
      : overrides.file;
    if (file) form.set('file', file);
    return form;
  }

  it('hosts a valid upload under recipes/{namespace}/step-{index}-{suffix} and returns the URL', async () => {
    const app = makeApp();

    const res = await app.request('/api/image/step', { method: 'POST', body: makeForm() });
    const body = (await res.json()) as UploadSuccess;

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.url).toMatch(
      new RegExp(`^http://localhost:8787/images/recipes/${NAMESPACE}/step-1-[0-9a-f]{8}\\.png$`),
    );
    const key = body.url.replace('http://localhost:8787/images/', '');
    expect(existsSync(path.join(imageDir, key))).toBe(true);
  });

  it('keeps both files on re-upload for the same step (unique keys)', async () => {
    const app = makeApp();

    const first = await app.request('/api/image/step', { method: 'POST', body: makeForm() });
    const second = await app.request('/api/image/step', {
      method: 'POST',
      body: makeForm({ file: new File([new Uint8Array([9, 9])], 'other.png', { type: 'image/png' }) }),
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const firstUrl = ((await first.json()) as UploadSuccess).url;
    const secondUrl = ((await second.json()) as UploadSuccess).url;
    expect(secondUrl).not.toBe(firstUrl);
    expect(existsSync(path.join(imageDir, firstUrl.replace('http://localhost:8787/images/', '')))).toBe(true);
  });

  it('rejects an unsupported content type with 400 INVALID_INPUT', async () => {
    const app = makeApp();

    const res = await app.request('/api/image/step', {
      method: 'POST',
      body: makeForm({ file: new File([new Uint8Array([1])], 'anim.gif', { type: 'image/gif' }) }),
    });
    const body = (await res.json()) as ApiErrorEnvelope;

    expect(res.status).toBe(400);
    expect(body.error.code).toBe('INVALID_INPUT');
    expect(body.error.message).toMatch(/unsupported content type/i);
  });

  it('rejects a non-UUID namespaceId (path traversal guard) with 400', async () => {
    const app = makeApp();

    const res = await app.request('/api/image/step', {
      method: 'POST',
      body: makeForm({ namespaceId: '../../etc' }),
    });
    const body = (await res.json()) as ApiErrorEnvelope;

    expect(res.status).toBe(400);
    expect(body.error.code).toBe('INVALID_INPUT');
  });

  it('rejects an out-of-range stepIndex with 400', async () => {
    const app = makeApp();

    const res = await app.request('/api/image/step', { method: 'POST', body: makeForm({ stepIndex: '6' }) });
    const body = (await res.json()) as ApiErrorEnvelope;

    expect(res.status).toBe(400);
    expect(body.error.code).toBe('INVALID_INPUT');
  });

  it('rejects a missing file with 400', async () => {
    const app = makeApp();

    const res = await app.request('/api/image/step', { method: 'POST', body: makeForm({ file: null }) });
    const body = (await res.json()) as ApiErrorEnvelope;

    expect(res.status).toBe(400);
    expect(body.error.code).toBe('INVALID_INPUT');
    expect(body.error.message).toMatch(/"file"/);
  });
});

describe('POST /api/image/upload and /api/image/link', () => {
  let dataDir: string;
  let imageDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'image-slot-recipes-'));
    imageDir = await mkdtemp(path.join(tmpdir(), 'image-slot-images-'));
    vi.spyOn(dns.promises, 'lookup').mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    await rm(dataDir, { recursive: true, force: true });
    await rm(imageDir, { recursive: true, force: true });
  });

  function makeApp() {
    const env = loadServerEnv({ RECIPE_DATA_DIR: dataDir, IMAGE_DATA_DIR: imageDir, BROWSER_FALLBACK_ENABLED: 'false' });
    return createApp({
      env,
      checkStorageReady: () => true,
      recipeRepository: new LocalJsonFileRecipeRepository(dataDir),
      geminiClient: { generateCanonicalRecipe: vi.fn() } as unknown as GeminiClient,
      geminiConfig: loadGeminiConfig({}),
      storageAdapter: new LocalDiskStorageAdapter(env.IMAGE_DATA_DIR, env.PUBLIC_BASE_URL),
      defaultMainImageUrl: '/images/placeholder-recipe.png',
    });
  }

  function upload(app: ReturnType<typeof makeApp>, slot: string) {
    const form = new FormData();
    form.set('namespaceId', NAMESPACE);
    form.set('slot', slot);
    form.set('file', new File([new Uint8Array([1, 2, 3, 4])], 'p.png', { type: 'image/png' }));
    return app.request('/api/image/upload', { method: 'POST', body: form });
  }

  function link(app: ReturnType<typeof makeApp>, payload: unknown) {
    return app.request('/api/image/link', {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
    });
  }

  function stubFetch(response: () => Response) {
    vi.stubGlobal('fetch', vi.fn(async () => response()));
  }

  const png = () => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/png' } });

  it('hosts an upload for the main slot under main-0-{suffix}', async () => {
    const res = await upload(makeApp(), 'main');
    const body = (await res.json()) as UploadSuccess;

    expect(res.status).toBe(200);
    expect(body.url).toMatch(new RegExp(`/images/recipes/${NAMESPACE}/main-0-[0-9a-f]{8}\\.png$`));
  });

  it('hosts an upload for a step slot', async () => {
    const res = await upload(makeApp(), '3');
    const body = (await res.json()) as UploadSuccess;

    expect(res.status).toBe(200);
    expect(body.url).toMatch(/step-3-[0-9a-f]{8}\.png$/);
  });

  it.each(['cover', '6', '', '-1', '1.5'])('rejects upload slot %j with 400 INVALID_INPUT', async (slot) => {
    const res = await upload(makeApp(), slot);
    const body = (await res.json()) as ApiErrorEnvelope;

    expect(res.status).toBe(400);
    expect(body.error.code).toBe('INVALID_INPUT');
  });

  it('rejects an invalid link slot with 400 INVALID_INPUT', async () => {
    const res = await link(makeApp(), { namespaceId: NAMESPACE, slot: 'cover', url: 'https://remote.example.com/a.png' });
    const body = (await res.json()) as ApiErrorEnvelope;

    expect(res.status).toBe(400);
    expect(body.error.code).toBe('INVALID_INPUT');
  });

  it('downloads a linked image into the main slot with a new key each time', async () => {
    stubFetch(png);
    const app = makeApp();
    const payload = { namespaceId: NAMESPACE, slot: 'main', url: 'https://remote.example.com/a.png' };

    const first = (await (await link(app, payload)).json()) as UploadSuccess;
    const second = (await (await link(app, payload)).json()) as UploadSuccess;

    expect(first.url).toMatch(new RegExp(`/images/recipes/${NAMESPACE}/main-0-[0-9a-f]{8}\\.png$`));
    expect(second.url).not.toBe(first.url);
  });

  it('downloads a linked image into a step slot', async () => {
    stubFetch(png);
    const res = await link(makeApp(), { namespaceId: NAMESPACE, slot: 2, url: 'https://remote.example.com/a.png' });
    const body = (await res.json()) as UploadSuccess;

    expect(res.status).toBe(200);
    expect(body.url).toMatch(/step-2-[0-9a-f]{8}\.png$/);
  });

  it('rejects a linked image with an unsupported type', async () => {
    stubFetch(() => new Response(new Uint8Array([1]), { status: 200, headers: { 'content-type': 'image/avif' } }));
    const res = await link(makeApp(), { namespaceId: NAMESPACE, slot: 'main', url: 'https://remote.example.com/a.avif' });
    const body = (await res.json()) as ApiErrorEnvelope;

    expect(res.status).toBe(502);
    expect(body.error.code).toBe('IMAGE_DOWNLOAD_FAILED');
    expect(body.error.message).toContain('unsupported content type "image/avif"');
  });

  it.each([401, 403])('returns the paste hint when the linked image answers %i', async (status) => {
    stubFetch(() => new Response('', { status }));
    const res = await link(makeApp(), { namespaceId: NAMESPACE, slot: 'main', url: 'https://remote.example.com/a.png' });
    const body = (await res.json()) as ApiErrorEnvelope;

    expect(res.status).toBe(502);
    expect(body.error).toMatchObject({
      code: 'IMAGE_DOWNLOAD_FAILED',
      message: 'This site blocks downloads, copy the image and paste it instead.',
      details: { status },
    });
  });

  it('rejects a linked URL that resolves to a private address with INVALID_URL', async () => {
    vi.spyOn(dns.promises, 'lookup').mockResolvedValue([{ address: '10.0.0.5', family: 4 }] as never);
    const res = await link(makeApp(), { namespaceId: NAMESPACE, slot: 'main', url: 'https://internal.example.com/a.png' });
    const body = (await res.json()) as ApiErrorEnvelope;

    expect(res.status).toBe(400);
    expect(body.error.code).toBe('INVALID_URL');
    expect(body.error.message).toBe('The image URL is invalid or points to a blocked address.');
  });
});
