import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../app.js'
import { loadServerEnv } from '../env.js'
import { LocalJsonFileRecipeRepository } from '../services/recipes/local-json-file-recipe-repository.js'
import { makeIngestDeps } from '../test-support/ingest-deps.js'

function makeEnv() {
  return loadServerEnv({ RECIPE_DATA_DIR: path.resolve('./data/recipes-test') })
}

function makeRecipeRepository() {
  return new LocalJsonFileRecipeRepository(path.resolve('./data/recipes-test'))
}

describe('logger middleware', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('logs a line for a successful request', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const app = createApp({ env: makeEnv(), checkStorageReady: () => true, recipeRepository: makeRecipeRepository(), ...makeIngestDeps() })

    const res = await app.request('/api/health')
    await res.json()

    expect(logSpy).toHaveBeenCalled()
    const logged = JSON.parse(logSpy.mock.calls[0][0] as string) as Record<string, unknown>
    expect(logged.status).toBe(200)
  })

  it('still logs a line when the downstream handler throws (error path)', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const app = createApp({
      env: makeEnv(),
      checkStorageReady: () => {
        throw new Error('boom')
      },
      recipeRepository: makeRecipeRepository(), ...makeIngestDeps(),
    })

    const res = await app.request('/api/health')
    await res.json()

    expect(res.status).toBe(500)
    expect(logSpy).toHaveBeenCalled()

    const loggedLine = logSpy.mock.calls
      .map((call) => call[0])
      .find((line): line is string => typeof line === 'string' && line.includes('"status"'))

    expect(loggedLine).toBeDefined()
    const logged = JSON.parse(loggedLine as string) as Record<string, unknown>
    expect(logged.status).toBe(500)
  })
})
