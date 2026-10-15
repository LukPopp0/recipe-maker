import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { loadServerEnv } from '../env.js';
import { makeIngestDeps } from '../test-support/ingest-deps.js';

const OLD = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

function makeApp() {
  const env = loadServerEnv({ AUTH_MODE: 'header', ADMIN_USERS: 'admin' });
  const deleted: string[] = [];
  const storageAdapter = {
    put: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(async (key: string) => {
      deleted.push(key);
    }),
    list: vi.fn(async () => [
      { key: 'recipes/used/main-0.jpg', sizeBytes: 10, modifiedAt: OLD },
      { key: 'recipes/orphan/main-0.jpg', sizeBytes: 20, modifiedAt: OLD },
    ]),
  };
  const recipeRepository = {
    getAll: async () => [
      { id: '1', owner: 'alice', createdAt: '', updatedAt: '', recipe: { main_image: '/images/recipes/used/main-0.jpg', steps: [] } },
    ],
  } as never;
  const app = createApp({ env, checkStorageReady: () => true, ...makeIngestDeps(), recipeRepository, storageAdapter } as never);
  return { app, deleted };
}

const asUser = (user: string, init: RequestInit = {}) => ({
  ...init,
  headers: { 'content-type': 'application/json', 'Remote-User': user },
});

describe('admin image routes', () => {
  it('is 403 FORBIDDEN for non-admins', async () => {
    const { app } = makeApp();

    expect((await app.request('/api/admin/images/unused', asUser('bob'))).status).toBe(403);
    expect(
      (await app.request('/api/admin/images/delete', asUser('bob', { method: 'POST', body: JSON.stringify({ keys: ['recipes/orphan/main-0.jpg'] }) }))).status,
    ).toBe(403);
  });

  it('lists only unreferenced images with their URL', async () => {
    const { app } = makeApp();

    const body = (await (await app.request('/api/admin/images/unused', asUser('admin'))).json()) as { images: { key: string; url: string }[] };

    expect(body.images.map((i) => i.key)).toEqual(['recipes/orphan/main-0.jpg']);
    expect(body.images[0].url).toBe('http://localhost:8787/images/recipes/orphan/main-0.jpg');
  });

  it('deletes only keys that are currently unused, ignoring referenced or foreign keys', async () => {
    const { app, deleted } = makeApp();

    const res = await app.request(
      '/api/admin/images/delete',
      asUser('admin', {
        method: 'POST',
        body: JSON.stringify({ keys: ['recipes/orphan/main-0.jpg', 'recipes/used/main-0.jpg', '../../etc/passwd'] }),
      }),
    );

    expect(((await res.json()) as { deleted: number }).deleted).toBe(1);
    expect(deleted).toEqual(['recipes/orphan/main-0.jpg']);
  });
});
