import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { ApiErrorEnvelope } from 'shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import { loadServerEnv } from '../env.js'
import { LocalJsonFileRecipeRepository } from '../services/recipes/local-json-file-recipe-repository.js'

describe('ingest routes (stubs)', () => {
  let dataDir: string

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'ingest-routes-test-'))
  })

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true })
  })

  function makeApp() {
    const env = loadServerEnv({ RECIPE_DATA_DIR: dataDir })
    const recipeRepository = new LocalJsonFileRecipeRepository(dataDir)
    return createApp({ env, checkStorageReady: () => true, recipeRepository })
  }

  it('POST /api/ingest/url returns 501 NOT_IMPLEMENTED', async () => {
    const app = makeApp()

    const res = await app.request('/api/ingest/url', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/recipe' }),
    })
    const body = (await res.json()) as ApiErrorEnvelope

    expect(res.status).toBe(501)
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('NOT_IMPLEMENTED')
    expect(body.error.message).toContain('Phase 2')
  })

  it('POST /api/ingest/manual returns 501 NOT_IMPLEMENTED', async () => {
    const app = makeApp()

    const res = await app.request('/api/ingest/manual', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    const body = (await res.json()) as ApiErrorEnvelope

    expect(res.status).toBe(501)
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('NOT_IMPLEMENTED')
    expect(body.error.message).toContain('Phase 3')
  })
})
