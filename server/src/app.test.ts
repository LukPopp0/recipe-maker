import path from 'node:path'
import type { ApiErrorEnvelope } from 'shared'
import { describe, expect, it } from 'vitest'
import { createApp } from './app.js'
import { loadServerEnv } from './env.js'
import { LocalJsonFileRecipeRepository } from './services/recipes/local-json-file-recipe-repository.js'

function makeEnv() {
  return loadServerEnv({ RECIPE_DATA_DIR: path.resolve('./data/recipes-test') })
}

function makeRecipeRepository() {
  return new LocalJsonFileRecipeRepository(path.resolve('./data/recipes-test'))
}

describe('createApp', () => {
  it('GET /api/health returns ok:true with requestId echoed in body and header when storage is ready', async () => {
    const app = createApp({ env: makeEnv(), checkStorageReady: () => true, recipeRepository: makeRecipeRepository() })

    const res = await app.request('/api/health', {
      headers: { 'x-request-id': 'test-request-id' },
    })
    const body = (await res.json()) as Record<string, unknown>

    expect(res.status).toBe(200)
    expect(res.headers.get('x-request-id')).toBe('test-request-id')
    expect(body).toEqual({
      ok: true,
      requestId: 'test-request-id',
      status: 'ok',
      storage: 'ready',
    })
  })

  it('GET /health (bare, for infra probes) returns the same shape as /api/health', async () => {
    const app = createApp({ env: makeEnv(), checkStorageReady: () => true, recipeRepository: makeRecipeRepository() })

    const res = await app.request('/health')
    const body = (await res.json()) as Record<string, unknown>

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.status).toBe('ok')
    expect(body.storage).toBe('ready')
    expect(typeof body.requestId).toBe('string')
  })

  it('generates a requestId when the caller does not supply x-request-id', async () => {
    const app = createApp({ env: makeEnv(), checkStorageReady: () => true, recipeRepository: makeRecipeRepository() })

    const res = await app.request('/api/health')
    const body = (await res.json()) as Record<string, unknown>

    expect(res.headers.get('x-request-id')).toBeTruthy()
    expect(body.requestId).toBe(res.headers.get('x-request-id'))
  })

  it('reflects storage-unavailable in the health response', async () => {
    const app = createApp({ env: makeEnv(), checkStorageReady: () => false, recipeRepository: makeRecipeRepository() })

    const res = await app.request('/api/health')
    const body = (await res.json()) as Record<string, unknown>

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.storage).toBe('unavailable')
  })

  it('returns a structured error envelope for an unknown route', async () => {
    const app = createApp({ env: makeEnv(), checkStorageReady: () => true, recipeRepository: makeRecipeRepository() })

    const res = await app.request('/api/does-not-exist')
    const body = (await res.json()) as ApiErrorEnvelope

    expect(res.status).toBe(404)
    expect(body.ok).toBe(false)
    expect(body.requestId).toBeTruthy()
    expect(body.error).toBeDefined()
    expect(body.error.code).toBe('ROUTE_NOT_FOUND')
  })

  it('routes a thrown AppError through onError into the standard envelope', async () => {
    const app = createApp({
      env: makeEnv(),
      checkStorageReady: () => {
        throw new Error('boom')
      },
      recipeRepository: makeRecipeRepository(),
    })

    const res = await app.request('/api/health')
    const body = (await res.json()) as ApiErrorEnvelope

    expect(res.status).toBe(500)
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('INTERNAL_ERROR')
  })
})
