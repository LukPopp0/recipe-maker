import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ApiErrorEnvelope } from 'shared';
import type { CanonicalRecipe } from 'shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, type AppDeps } from '../app.js';
import { loadServerEnv } from '../env.js';
import { LocalJsonFileRecipeRepository } from '../services/recipes/local-json-file-recipe-repository.js';
import { makeIngestDeps } from '../test-support/ingest-deps.js';

function makeRecipe(overrides: Partial<CanonicalRecipe> = {}): CanonicalRecipe {
  return {
    title: 'Round Trip Recipe',
    tags: ['quick'],
    time: 20,
    ingredients: [{ name: 'Salt', amount_text: '1 tsp' }],
    pantry_items: ['salt'],
    main_image: 'salt.png',
    steps: [{ step_header: 'Cook', step_description: 'Cook it.' }],
    metadata: { source_type: 'manual', language: 'en', warnings: [] },
    ...overrides,
  };
}

describe('recipe routes', () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'recipe-routes-test-'));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  function makeApp(raw: Record<string, string> = {}, overrides: Partial<AppDeps> = {}) {
    const env = loadServerEnv({ RECIPE_DATA_DIR: dataDir, ...raw });
    const recipeRepository = new LocalJsonFileRecipeRepository(dataDir);
    return createApp({ env, checkStorageReady: () => true, recipeRepository, ...makeIngestDeps(), ...overrides });
  }

  const HEADER_AUTH = { AUTH_MODE: 'header', ADMIN_USERS: 'admin' };

  function as(user: string, init: RequestInit = {}): RequestInit {
    return { ...init, headers: { ...(init.headers as Record<string, string>), 'Remote-User': user } };
  }

  async function saveAs(app: ReturnType<typeof makeApp>, user: string, recipe = makeRecipe()) {
    const res = await app.request(
      '/api/recipe/save',
      as(user, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(recipe) }),
    );
    return ((await res.json()) as { id: string }).id;
  }

  describe('ownership', () => {
    it('stores the caller as owner and returns meta from GET /api/recipe/:id', async () => {
      const app = makeApp(HEADER_AUTH);
      const id = await saveAs(app, 'alice');

      const res = await app.request(`/api/recipe/${id}`, as('bob'));
      const body = (await res.json()) as { recipe: CanonicalRecipe; meta: Record<string, string> };

      expect(res.status).toBe(200);
      expect(body.recipe.title).toBe('Round Trip Recipe');
      expect(body.meta).toMatchObject({ id, owner: 'alice' });
    });

    it('PUT lets any user update in place and keeps the owner', async () => {
      const app = makeApp(HEADER_AUTH);
      const id = await saveAs(app, 'alice');

      const res = await app.request(
        `/api/recipe/${id}`,
        as('bob', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(makeRecipe({ title: 'Edited' })) }),
      );
      const fetched = (await (await app.request(`/api/recipe/${id}`, as('bob'))).json()) as { recipe: CanonicalRecipe; meta: { owner: string } };

      expect(res.status).toBe(200);
      expect(fetched.recipe.title).toBe('Edited');
      expect(fetched.meta.owner).toBe('alice');
    });

    it('PUT on an unknown id is 404 RECIPE_NOT_FOUND', async () => {
      const app = makeApp();
      const res = await app.request(`/api/recipe/${randomUUID()}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(makeRecipe()),
      });

      expect(res.status).toBe(404);
      expect(((await res.json()) as ApiErrorEnvelope).error.code).toBe('RECIPE_NOT_FOUND');
    });

    it('PUT with an invalid body is 422 SCHEMA_VALIDATION_FAILED', async () => {
      const app = makeApp();
      const id = await saveAs(app, 'local');
      const res = await app.request(`/api/recipe/${id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: '' }),
      });

      expect(res.status).toBe(422);
    });

    it('GET /api/recipes filters by scope', async () => {
      const app = makeApp(HEADER_AUTH);
      const a = await saveAs(app, 'alice');
      const b = await saveAs(app, 'bob');

      const list = async (query: string) =>
        ((await (await app.request(`/api/recipes${query}`, as('alice'))).json()) as { recipes: { id: string }[] }).recipes.map((r) => r.id).sort();

      expect(await list('?scope=mine')).toEqual([a]);
      expect(await list('?scope=all')).toEqual([a, b].sort());
      expect(await list('')).toEqual([a, b].sort());
    });

    it('GET /api/recipes rejects an unknown scope with 400 INVALID_INPUT', async () => {
      const res = await makeApp().request('/api/recipes?scope=bogus');

      expect(res.status).toBe(400);
    });

    it('DELETE by a non-owner non-admin is 403 and keeps the recipe', async () => {
      const app = makeApp(HEADER_AUTH);
      const id = await saveAs(app, 'alice');

      const res = await app.request(`/api/recipe/${id}`, as('bob', { method: 'DELETE' }));

      expect(res.status).toBe(403);
      expect(((await res.json()) as ApiErrorEnvelope).error.code).toBe('FORBIDDEN');
      expect((await app.request(`/api/recipe/${id}`, as('bob'))).status).toBe(200);
    });

    it('DELETE by the owner or an admin succeeds', async () => {
      const app = makeApp(HEADER_AUTH);
      const mine = await saveAs(app, 'alice');
      const other = await saveAs(app, 'bob');

      expect((await app.request(`/api/recipe/${mine}`, as('alice', { method: 'DELETE' }))).status).toBe(200);
      expect((await app.request(`/api/recipe/${other}`, as('admin', { method: 'DELETE' }))).status).toBe(200);
    });
  });

  describe('POST /api/recipe/validate', () => {
    it('returns 200 with valid:true and the parsed recipe for a valid candidate', async () => {
      const app = makeApp();

      const res = await app.request('/api/recipe/validate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(makeRecipe()),
      });
      const body = (await res.json()) as Record<string, unknown>;

      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.valid).toBe(true);
      expect(body.recipe).toMatchObject({ title: 'Round Trip Recipe' });
    });

    it('returns 200 with valid:false and errors for an invalid candidate (does not error the request)', async () => {
      const app = makeApp();

      const res = await app.request('/api/recipe/validate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: '' }),
      });
      const body = (await res.json()) as Record<string, unknown>;

      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.valid).toBe(false);
      expect(body.errors).toBeDefined();
    });
  });

  describe('POST /api/recipe/save', () => {
    it('returns 400 INVALID_INPUT for malformed JSON', async () => {
      const app = makeApp();

      const res = await app.request('/api/recipe/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{not valid json',
      });
      const body = (await res.json()) as ApiErrorEnvelope;

      expect(res.status).toBe(400);
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe('INVALID_INPUT');
    });

    it('returns 422 SCHEMA_VALIDATION_FAILED for a well-formed but invalid recipe shape', async () => {
      const app = makeApp();

      const res = await app.request('/api/recipe/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: '' }),
      });
      const body = (await res.json()) as ApiErrorEnvelope;

      expect(res.status).toBe(422);
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe('SCHEMA_VALIDATION_FAILED');
    });
  });

  it('full save -> list -> get -> download -> delete -> get(404) round trip', async () => {
    const app = makeApp();

    const saveRes = await app.request('/api/recipe/save', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(makeRecipe({ title: 'Grandma\'s Soup!' })),
    });
    expect(saveRes.status).toBe(200);
    const saveBody = (await saveRes.json()) as { ok: boolean; id: string };
    expect(saveBody.ok).toBe(true);
    const { id } = saveBody;

    const listRes = await app.request('/api/recipes');
    const listBody = (await listRes.json()) as { recipes: Array<{ id: string }> };
    expect(listRes.status).toBe(200);
    expect(listBody.recipes.map((r) => r.id)).toContain(id);

    const getRes = await app.request(`/api/recipe/${id}`);
    const getBody = (await getRes.json()) as { recipe: CanonicalRecipe };
    expect(getRes.status).toBe(200);
    expect(getBody.recipe.title).toBe('Grandma\'s Soup!');

    const downloadRes = await app.request(`/api/recipe/download/${id}`);
    expect(downloadRes.status).toBe(200);
    expect(downloadRes.headers.get('content-disposition')).toBe('attachment; filename="grandma-s-soup.json"');
    const downloadBody = (await downloadRes.json()) as CanonicalRecipe;
    expect(downloadBody.title).toBe('Grandma\'s Soup!');

    const deleteRes = await app.request(`/api/recipe/${id}`, { method: 'DELETE' });
    const deleteBody = (await deleteRes.json()) as { ok: boolean };
    expect(deleteRes.status).toBe(200);
    expect(deleteBody.ok).toBe(true);

    const getAfterDeleteRes = await app.request(`/api/recipe/${id}`);
    const getAfterDeleteBody = (await getAfterDeleteRes.json()) as ApiErrorEnvelope;
    expect(getAfterDeleteRes.status).toBe(404);
    expect(getAfterDeleteBody.error.code).toBe('RECIPE_NOT_FOUND');
  });

  it('GET /api/recipe/:id returns 404 RECIPE_NOT_FOUND for an unknown but well-formed id', async () => {
    const app = makeApp();

    const res = await app.request(`/api/recipe/${randomUUID()}`);
    const body = (await res.json()) as ApiErrorEnvelope;

    expect(res.status).toBe(404);
    expect(body.error.code).toBe('RECIPE_NOT_FOUND');
  });

  it('DELETE /api/recipe/:id returns 404 RECIPE_NOT_FOUND for an unknown but well-formed id', async () => {
    const app = makeApp();

    const res = await app.request(`/api/recipe/${randomUUID()}`, { method: 'DELETE' });
    const body = (await res.json()) as ApiErrorEnvelope;

    expect(res.status).toBe(404);
    expect(body.error.code).toBe('RECIPE_NOT_FOUND');
  });

  it('GET /api/recipe/download/:id returns 404 RECIPE_NOT_FOUND for an unknown but well-formed id', async () => {
    const app = makeApp();

    const res = await app.request(`/api/recipe/download/${randomUUID()}`);
    const body = (await res.json()) as ApiErrorEnvelope;

    expect(res.status).toBe(404);
    expect(body.error.code).toBe('RECIPE_NOT_FOUND');
  });

  describe('recipe id validation (path traversal defense)', () => {
    const malformedIds = ['not-a-uuid', '../../etc/passwd', '..%2f..%2fetc%2fpasswd'];

    for (const malformedId of malformedIds) {
      it(`GET /api/recipe/:id returns 400 INVALID_INPUT for malformed id "${malformedId}"`, async () => {
        const app = makeApp();

        const res = await app.request(`/api/recipe/${encodeURIComponent(malformedId)}`);
        const body = (await res.json()) as ApiErrorEnvelope;

        expect(res.status).toBe(400);
        expect(body.ok).toBe(false);
        expect(body.error.code).toBe('INVALID_INPUT');
      });

      it(`GET /api/recipe/download/:id returns 400 INVALID_INPUT for malformed id "${malformedId}"`, async () => {
        const app = makeApp();

        const res = await app.request(`/api/recipe/download/${encodeURIComponent(malformedId)}`);
        const body = (await res.json()) as ApiErrorEnvelope;

        expect(res.status).toBe(400);
        expect(body.ok).toBe(false);
        expect(body.error.code).toBe('INVALID_INPUT');
      });

      it(`DELETE /api/recipe/:id returns 400 INVALID_INPUT for malformed id "${malformedId}"`, async () => {
        const app = makeApp();

        const res = await app.request(`/api/recipe/${encodeURIComponent(malformedId)}`, { method: 'DELETE' });
        const body = (await res.json()) as ApiErrorEnvelope;

        expect(res.status).toBe(400);
        expect(body.ok).toBe(false);
        expect(body.error.code).toBe('INVALID_INPUT');
      });
    }
  });

  it('falls back to "recipe" as the download filename slug when the title slugifies to empty', async () => {
    const app = makeApp();

    const saveRes = await app.request('/api/recipe/save', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(makeRecipe({ title: '!!!' })),
    });
    const { id } = (await saveRes.json()) as { id: string };

    const downloadRes = await app.request(`/api/recipe/download/${id}`);

    expect(downloadRes.headers.get('content-disposition')).toBe('attachment; filename="recipe.json"');
  });

  it('DELETE removes its own local images but keeps ones another recipe shares', async () => {
    const storageAdapter = { put: vi.fn(), get: vi.fn(), list: async () => [], delete: vi.fn(async () => {}) };
    const app = makeApp({ PUBLIC_BASE_URL: 'http://localhost:8787' }, { storageAdapter });
    const shared = 'http://localhost:8787/images/recipes/n1/main-0.jpg';
    const first = await saveAs(
      app,
      'local',
      makeRecipe({
        main_image: shared,
        steps: [{ step_header: 'Cook', step_description: 'Cook it.', image: '/images/recipes/n1/step-0.jpg' }],
      }),
    );
    await saveAs(app, 'local', makeRecipe({ main_image: shared }));

    const res = await app.request(`/api/recipe/${first}`, { method: 'DELETE' });

    expect(res.status).toBe(200);
    expect(storageAdapter.delete).toHaveBeenCalledTimes(1);
    expect(storageAdapter.delete).toHaveBeenCalledWith('recipes/n1/step-0.jpg');
  });

  it('DELETE still succeeds and skips image cleanup when listing remaining recipes fails', async () => {
    const storageAdapter = { put: vi.fn(), get: vi.fn(), list: async () => [], delete: vi.fn(async () => {}) };
    const real = new LocalJsonFileRecipeRepository(dataDir);
    const recipeRepository = Object.assign(Object.create(real) as LocalJsonFileRecipeRepository, {
      getAll: async () => {
        throw new Error('corrupt store');
      },
    });
    const app = makeApp({}, { storageAdapter, recipeRepository });
    const id = await saveAs(
      app,
      'local',
      makeRecipe({ main_image: 'http://localhost:8787/images/recipes/n2/main-0.jpg' }),
    );
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await app.request(`/api/recipe/${id}`, { method: 'DELETE' });

    expect(res.status).toBe(200);
    expect(storageAdapter.delete).not.toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalled();
    errorLog.mockRestore();
    expect((await app.request(`/api/recipe/${id}`)).status).toBe(404);
  });
});
