import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ApiErrorEnvelope, ApiSuccessEnvelope } from 'shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { loadServerEnv } from '../env.js';
import { loadGeminiConfig } from '../services/ai/config.js';
import type { GeminiClient } from '../services/ai/gemini-client.js';
import { LocalDiskStorageAdapter } from '../services/storage/local-disk-storage-adapter.js';
import { LocalJsonFileRecipeRepository } from '../services/recipes/local-json-file-recipe-repository.js';

// Integration tests for POST /api/image/step (specs/14): the review panel's
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

  it('hosts a valid upload under recipes/{namespace}/step-{index} and returns the URL', async () => {
    const app = makeApp();

    const res = await app.request('/api/image/step', { method: 'POST', body: makeForm() });
    const body = (await res.json()) as UploadSuccess;

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.url).toBe(`http://localhost:8787/images/recipes/${NAMESPACE}/step-1.png`);
    expect(existsSync(path.join(imageDir, 'recipes', NAMESPACE, 'step-1.png'))).toBe(true);
  });

  it('overwrites on re-upload for the same step (replace semantics)', async () => {
    const app = makeApp();

    const first = await app.request('/api/image/step', { method: 'POST', body: makeForm() });
    const second = await app.request('/api/image/step', {
      method: 'POST',
      body: makeForm({ file: new File([new Uint8Array([9, 9])], 'other.png', { type: 'image/png' }) }),
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(((await second.json()) as UploadSuccess).url).toBe(
      `http://localhost:8787/images/recipes/${NAMESPACE}/step-1.png`,
    );
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
