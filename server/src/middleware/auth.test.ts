import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { loadServerEnv } from '../env.js';
import { makeIngestDeps } from '../test-support/ingest-deps.js';
import type { RecipeRepository } from '../services/recipes/recipe-repository.js';

const noRecipes = {} as RecipeRepository;

function makeApp(raw: Record<string, string> = {}) {
  const env = loadServerEnv(raw);
  return createApp({ env, checkStorageReady: () => true, recipeRepository: noRecipes, ...makeIngestDeps() });
}

async function me(app: ReturnType<typeof makeApp>, headers: Record<string, string> = {}) {
  const res = await app.request('/api/me', { headers });
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

describe('auth middleware', () => {
  it('AUTH_MODE=none runs every request as the admin user "local"', async () => {
    const { status, body } = await me(makeApp());

    expect(status).toBe(200);
    expect(body.user).toEqual({ username: 'local', isAdmin: true });
  });

  it('AUTH_MODE=none ignores a Remote-User header', async () => {
    const { body } = await me(makeApp(), { 'Remote-User': 'mallory' });

    expect(body.user).toEqual({ username: 'local', isAdmin: true });
  });

  it('AUTH_MODE=header rejects a request without Remote-User with 401 UNAUTHENTICATED', async () => {
    const { status, body } = await me(makeApp({ AUTH_MODE: 'header' }));

    expect(status).toBe(401);
    expect(body.error.code).toBe('UNAUTHENTICATED');
  });

  it('AUTH_MODE=header treats a whitespace-only Remote-User as missing', async () => {
    const { status } = await me(makeApp({ AUTH_MODE: 'header' }), { 'Remote-User': '   ' });

    expect(status).toBe(401);
  });

  it('AUTH_MODE=header trims and lowercases the username and applies ADMIN_USERS', async () => {
    const app = makeApp({ AUTH_MODE: 'header', ADMIN_USERS: 'alice' });

    expect((await me(app, { 'Remote-User': ' Alice ' })).body.user).toEqual({ username: 'alice', isAdmin: true });
    expect((await me(app, { 'Remote-User': 'bob' })).body.user).toEqual({ username: 'bob', isAdmin: false });
  });

  it('AUTH_MODE=header gates data routes too (GET /api/recipes without Remote-User is 401)', async () => {
    const res = await makeApp({ AUTH_MODE: 'header' }).request('/api/recipes');
    const body = (await res.json()) as Record<string, any>;

    expect(res.status).toBe(401);
    expect(body.error.code).toBe('UNAUTHENTICATED');
  });

  it('does not count a 401 against the ingest rate limit (auth runs before the limiter)', async () => {
    const app = makeApp({ AUTH_MODE: 'header', RATE_LIMIT_MAX: '1' });
    const post = (headers: Record<string, string> = {}) =>
      app.request('/api/ingest/url', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: '{}'
      });

    expect((await post()).status).toBe(401);
    expect((await post()).status).toBe(401);
    expect((await post({ 'Remote-User': 'alice' })).status).not.toBe(429);
  });

  it('keeps both health endpoints open in header mode', async () => {
    const app = makeApp({ AUTH_MODE: 'header' });

    expect((await app.request('/api/health')).status).toBe(200);
    expect((await app.request('/health')).status).toBe(200);
  });

  it('does not gate non-API paths (nginx does)', async () => {
    const app = makeApp({ AUTH_MODE: 'header' });
    const res = await app.request('/ingredient-images/INGREDIENT_NOT_FOUND.png');

    expect(res.status).not.toBe(401);
  });
});
