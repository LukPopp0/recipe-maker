import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { loadServerEnv } from '../env.js';
import type { RecipeRepository } from '../services/recipes/recipe-repository.js';
import { makeIngestDeps } from '../test-support/ingest-deps.js';

describe('web app serving', () => {
  let distDir: string;

  beforeEach(async () => {
    distDir = await mkdtemp(path.join(tmpdir(), 'web-dist-'));
    await writeFile(path.join(distDir, 'index.html'), '<!doctype html><div id="root"></div>');
    await mkdir(path.join(distDir, 'assets'));
    await writeFile(path.join(distDir, 'assets', 'app.js'), 'console.log(1)');
  });

  afterEach(async () => {
    await rm(distDir, { recursive: true, force: true });
  });

  function makeApp(raw: Record<string, string>) {
    const env = loadServerEnv(raw);
    return createApp({ env, checkStorageReady: () => true, recipeRepository: {} as RecipeRepository, ...makeIngestDeps() });
  }

  it('serves index.html at / and static assets', async () => {
    const app = makeApp({ WEB_DIST_DIR: distDir });

    const index = await app.request('/');
    const asset = await app.request('/assets/app.js');

    expect(index.status).toBe(200);
    expect(await index.text()).toContain('id="root"');
    expect(asset.status).toBe(200);
    expect(await asset.text()).toBe('console.log(1)');
  });

  it('falls back to index.html for unknown non-API paths', async () => {
    const res = await makeApp({ WEB_DIST_DIR: distDir }).request('/library/some-recipe');

    expect(res.status).toBe(200);
    expect(await res.text()).toContain('id="root"');
  });

  it('keeps the JSON 404 for unknown API paths', async () => {
    const res = await makeApp({ WEB_DIST_DIR: distDir }).request('/api/does-not-exist');
    const body = (await res.json()) as { error: { code: string } };

    expect(res.status).toBe(404);
    expect(body.error.code).toBe('ROUTE_NOT_FOUND');
  });

  it('serves nothing extra when WEB_DIST_DIR is not set', async () => {
    expect((await makeApp({}).request('/')).status).toBe(404);
  });
});
