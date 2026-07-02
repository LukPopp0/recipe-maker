import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { ApiErrorEnvelope } from 'shared'
import type { CanonicalRecipe } from 'shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import { loadServerEnv } from '../env.js'
import { LocalJsonFileRecipeRepository } from '../services/recipes/local-json-file-recipe-repository.js'

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
  }
}

describe('recipe routes', () => {
  let dataDir: string

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'recipe-routes-test-'))
  })

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true })
  })

  function makeApp() {
    const env = loadServerEnv({ RECIPE_DATA_DIR: dataDir })
    const recipeRepository = new LocalJsonFileRecipeRepository(dataDir)
    return createApp({ env, checkStorageReady: () => true, recipeRepository })
  }

  describe('POST /api/recipe/validate', () => {
    it('returns 200 with valid:true and the parsed recipe for a valid candidate', async () => {
      const app = makeApp()

      const res = await app.request('/api/recipe/validate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(makeRecipe()),
      })
      const body = (await res.json()) as Record<string, unknown>

      expect(res.status).toBe(200)
      expect(body.ok).toBe(true)
      expect(body.valid).toBe(true)
      expect(body.recipe).toMatchObject({ title: 'Round Trip Recipe' })
    })

    it('returns 200 with valid:false and errors for an invalid candidate (does not error the request)', async () => {
      const app = makeApp()

      const res = await app.request('/api/recipe/validate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: '' }),
      })
      const body = (await res.json()) as Record<string, unknown>

      expect(res.status).toBe(200)
      expect(body.ok).toBe(true)
      expect(body.valid).toBe(false)
      expect(body.errors).toBeDefined()
    })
  })

  describe('POST /api/recipe/save', () => {
    it('returns 400 INVALID_INPUT for malformed JSON', async () => {
      const app = makeApp()

      const res = await app.request('/api/recipe/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{not valid json',
      })
      const body = (await res.json()) as ApiErrorEnvelope

      expect(res.status).toBe(400)
      expect(body.ok).toBe(false)
      expect(body.error.code).toBe('INVALID_INPUT')
    })

    it('returns 422 SCHEMA_VALIDATION_FAILED for a well-formed but invalid recipe shape', async () => {
      const app = makeApp()

      const res = await app.request('/api/recipe/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: '' }),
      })
      const body = (await res.json()) as ApiErrorEnvelope

      expect(res.status).toBe(422)
      expect(body.ok).toBe(false)
      expect(body.error.code).toBe('SCHEMA_VALIDATION_FAILED')
    })
  })

  it('full save -> list -> get -> download -> delete -> get(404) round trip', async () => {
    const app = makeApp()

    const saveRes = await app.request('/api/recipe/save', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(makeRecipe({ title: 'Grandma\'s Soup!' })),
    })
    expect(saveRes.status).toBe(200)
    const saveBody = (await saveRes.json()) as { ok: boolean; id: string }
    expect(saveBody.ok).toBe(true)
    const { id } = saveBody

    const listRes = await app.request('/api/recipes')
    const listBody = (await listRes.json()) as { recipes: Array<{ id: string }> }
    expect(listRes.status).toBe(200)
    expect(listBody.recipes.map((r) => r.id)).toContain(id)

    const getRes = await app.request(`/api/recipe/${id}`)
    const getBody = (await getRes.json()) as { recipe: CanonicalRecipe }
    expect(getRes.status).toBe(200)
    expect(getBody.recipe.title).toBe("Grandma's Soup!")

    const downloadRes = await app.request(`/api/recipe/download/${id}`)
    expect(downloadRes.status).toBe(200)
    expect(downloadRes.headers.get('content-disposition')).toBe('attachment; filename="grandma-s-soup.json"')
    const downloadBody = (await downloadRes.json()) as CanonicalRecipe
    expect(downloadBody.title).toBe("Grandma's Soup!")

    const deleteRes = await app.request(`/api/recipe/${id}`, { method: 'DELETE' })
    const deleteBody = (await deleteRes.json()) as { ok: boolean }
    expect(deleteRes.status).toBe(200)
    expect(deleteBody.ok).toBe(true)

    const getAfterDeleteRes = await app.request(`/api/recipe/${id}`)
    const getAfterDeleteBody = (await getAfterDeleteRes.json()) as ApiErrorEnvelope
    expect(getAfterDeleteRes.status).toBe(404)
    expect(getAfterDeleteBody.error.code).toBe('RECIPE_NOT_FOUND')
  })

  it('GET /api/recipe/:id returns 404 RECIPE_NOT_FOUND for an unknown but well-formed id', async () => {
    const app = makeApp()

    const res = await app.request(`/api/recipe/${randomUUID()}`)
    const body = (await res.json()) as ApiErrorEnvelope

    expect(res.status).toBe(404)
    expect(body.error.code).toBe('RECIPE_NOT_FOUND')
  })

  it('DELETE /api/recipe/:id returns 404 RECIPE_NOT_FOUND for an unknown but well-formed id', async () => {
    const app = makeApp()

    const res = await app.request(`/api/recipe/${randomUUID()}`, { method: 'DELETE' })
    const body = (await res.json()) as ApiErrorEnvelope

    expect(res.status).toBe(404)
    expect(body.error.code).toBe('RECIPE_NOT_FOUND')
  })

  it('GET /api/recipe/download/:id returns 404 RECIPE_NOT_FOUND for an unknown but well-formed id', async () => {
    const app = makeApp()

    const res = await app.request(`/api/recipe/download/${randomUUID()}`)
    const body = (await res.json()) as ApiErrorEnvelope

    expect(res.status).toBe(404)
    expect(body.error.code).toBe('RECIPE_NOT_FOUND')
  })

  describe('recipe id validation (path traversal defense)', () => {
    const malformedIds = ['not-a-uuid', '../../etc/passwd', '..%2f..%2fetc%2fpasswd']

    for (const malformedId of malformedIds) {
      it(`GET /api/recipe/:id returns 400 INVALID_INPUT for malformed id "${malformedId}"`, async () => {
        const app = makeApp()

        const res = await app.request(`/api/recipe/${encodeURIComponent(malformedId)}`)
        const body = (await res.json()) as ApiErrorEnvelope

        expect(res.status).toBe(400)
        expect(body.ok).toBe(false)
        expect(body.error.code).toBe('INVALID_INPUT')
      })

      it(`GET /api/recipe/download/:id returns 400 INVALID_INPUT for malformed id "${malformedId}"`, async () => {
        const app = makeApp()

        const res = await app.request(`/api/recipe/download/${encodeURIComponent(malformedId)}`)
        const body = (await res.json()) as ApiErrorEnvelope

        expect(res.status).toBe(400)
        expect(body.ok).toBe(false)
        expect(body.error.code).toBe('INVALID_INPUT')
      })

      it(`DELETE /api/recipe/:id returns 400 INVALID_INPUT for malformed id "${malformedId}"`, async () => {
        const app = makeApp()

        const res = await app.request(`/api/recipe/${encodeURIComponent(malformedId)}`, { method: 'DELETE' })
        const body = (await res.json()) as ApiErrorEnvelope

        expect(res.status).toBe(400)
        expect(body.ok).toBe(false)
        expect(body.error.code).toBe('INVALID_INPUT')
      })
    }
  })

  it('falls back to "recipe" as the download filename slug when the title slugifies to empty', async () => {
    const app = makeApp()

    const saveRes = await app.request('/api/recipe/save', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(makeRecipe({ title: '!!!' })),
    })
    const { id } = (await saveRes.json()) as { id: string }

    const downloadRes = await app.request(`/api/recipe/download/${id}`)

    expect(downloadRes.headers.get('content-disposition')).toBe('attachment; filename="recipe.json"')
  })
})
