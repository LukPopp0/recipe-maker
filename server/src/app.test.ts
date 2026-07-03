import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { ApiErrorEnvelope } from 'shared'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp } from './app.js'
import { loadServerEnv } from './env.js'
import { LocalJsonFileRecipeRepository } from './services/recipes/local-json-file-recipe-repository.js'
import { makeIngestDeps } from './test-support/ingest-deps.js'

function makeEnv(overrides: Record<string, string> = {}) {
  return loadServerEnv({ RECIPE_DATA_DIR: path.resolve('./data/recipes-test'), ...overrides })
}

function makeRecipeRepository() {
  return new LocalJsonFileRecipeRepository(path.resolve('./data/recipes-test'))
}

describe('createApp', () => {
  it('GET /api/health returns ok:true with requestId echoed in body and header when storage is ready', async () => {
    const app = createApp({ env: makeEnv(), checkStorageReady: () => true, recipeRepository: makeRecipeRepository(), ...makeIngestDeps() })

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
    const app = createApp({ env: makeEnv(), checkStorageReady: () => true, recipeRepository: makeRecipeRepository(), ...makeIngestDeps() })

    const res = await app.request('/health')
    const body = (await res.json()) as Record<string, unknown>

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.status).toBe('ok')
    expect(body.storage).toBe('ready')
    expect(typeof body.requestId).toBe('string')
  })

  it('generates a requestId when the caller does not supply x-request-id', async () => {
    const app = createApp({ env: makeEnv(), checkStorageReady: () => true, recipeRepository: makeRecipeRepository(), ...makeIngestDeps() })

    const res = await app.request('/api/health')
    const body = (await res.json()) as Record<string, unknown>

    expect(res.headers.get('x-request-id')).toBeTruthy()
    expect(body.requestId).toBe(res.headers.get('x-request-id'))
  })

  it('reflects storage-unavailable in the health response', async () => {
    const app = createApp({ env: makeEnv(), checkStorageReady: () => false, recipeRepository: makeRecipeRepository(), ...makeIngestDeps() })

    const res = await app.request('/api/health')
    const body = (await res.json()) as Record<string, unknown>

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.storage).toBe('unavailable')
  })

  it('returns a structured error envelope for an unknown route', async () => {
    const app = createApp({ env: makeEnv(), checkStorageReady: () => true, recipeRepository: makeRecipeRepository(), ...makeIngestDeps() })

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
      recipeRepository: makeRecipeRepository(), ...makeIngestDeps(),
    })

    const res = await app.request('/api/health')
    const body = (await res.json()) as ApiErrorEnvelope

    expect(res.status).toBe(500)
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('INTERNAL_ERROR')
  })

  describe('GET /images/*', () => {
    let imageDataDir: string

    afterEach(async () => {
      if (imageDataDir) {
        await rm(imageDataDir, { recursive: true, force: true })
      }
    })

    it('serves a file from IMAGE_DATA_DIR at the matching /images/* path', async () => {
      imageDataDir = await mkdtemp(path.join(tmpdir(), 'app-test-images-'))
      await mkdir(path.join(imageDataDir, 'recipes/recipe-1'), { recursive: true })
      await writeFile(path.join(imageDataDir, 'recipes/recipe-1/main-0.jpg'), Buffer.from('fake-jpeg-bytes'))
      const app = createApp({
        env: makeEnv({ IMAGE_DATA_DIR: imageDataDir }),
        checkStorageReady: () => true,
        recipeRepository: makeRecipeRepository(), ...makeIngestDeps(),
      })

      const res = await app.request('/images/recipes/recipe-1/main-0.jpg')

      expect(res.status).toBe(200)
      expect(Buffer.from(await res.arrayBuffer())).toEqual(Buffer.from('fake-jpeg-bytes'))
    })

    it('returns 404 for a missing image key', async () => {
      imageDataDir = await mkdtemp(path.join(tmpdir(), 'app-test-images-'))
      const app = createApp({
        env: makeEnv({ IMAGE_DATA_DIR: imageDataDir }),
        checkStorageReady: () => true,
        recipeRepository: makeRecipeRepository(), ...makeIngestDeps(),
      })

      const res = await app.request('/images/recipes/does-not-exist/main-0.jpg')

      expect(res.status).toBe(404)
    })
  })
})
