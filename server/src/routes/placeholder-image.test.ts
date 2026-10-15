import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { loadServerEnv } from '../env.js';
import type { RecipeRepository } from '../services/recipes/recipe-repository.js';
import { makeIngestDeps } from '../test-support/ingest-deps.js';

describe('default recipe placeholder image', () => {
  let imageDir: string;

  beforeEach(async () => {
    imageDir = await mkdtemp(path.join(tmpdir(), 'placeholder-images-'));
  });

  afterEach(async () => {
    await rm(imageDir, { recursive: true, force: true });
  });

  function makeApp() {
    const env = loadServerEnv({ IMAGE_DATA_DIR: imageDir });
    return createApp({ env, checkStorageReady: () => true, recipeRepository: {} as RecipeRepository, ...makeIngestDeps() });
  }

  it('serves the bundled PNG even when the images volume is empty', async () => {
    const res = await makeApp().request('/images/placeholder-recipe.png');
    const bytes = new Uint8Array(await res.arrayBuffer());

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it('still returns 404 for other missing images', async () => {
    const res = await makeApp().request('/images/recipes/x/missing.jpg');

    expect(res.status).toBe(404);
  });
});
