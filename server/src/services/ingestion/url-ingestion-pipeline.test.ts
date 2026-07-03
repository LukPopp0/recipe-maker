import dns from 'node:dns'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '../../lib/errors.js'
import { loadGeminiConfig } from '../ai/config.js'
import type { GenerateCanonicalRecipeParams } from '../ai/gemini-client.js'
import type { GeminiCanonicalRecipeGenerator } from './url-ingestion-pipeline.js'
import { runUrlIngestionPipeline } from './url-ingestion-pipeline.js'

const RECIPE_HTML = `
  <html>
    <head><title>Grandma's Lasagna</title></head>
    <body>
      <article>
        <h1>Grandma's Lasagna</h1>
        <p>A classic baked lasagna recipe passed down for generations, full of rich tomato sauce, layers of pasta, and melted cheese.</p>
        <ul>
          <li>500g lasagna sheets</li>
          <li>400g ground beef</li>
          <li>2 cups tomato sauce</li>
          <li>1 cup mozzarella cheese</li>
        </ul>
        <ol>
          <li>Boil the lasagna sheets until al dente.</li>
          <li>Brown the ground beef and mix with tomato sauce.</li>
          <li>Layer sheets, meat sauce, and cheese in a baking dish.</li>
          <li>Bake at 180C for 30 minutes until golden.</li>
        </ol>
      </article>
    </body>
  </html>
`

const EMPTY_HTML = `<html><head><title>Untitled</title></head><body></body></html>`

const VALID_CANDIDATE = {
  title: 'Grandma\'s Lasagna',
  tags: [],
  time: 60,
  ingredients: [{ name: 'lasagna sheets', amount_text: '500g' }],
  pantry_items: [],
  main_image: '',
  steps: [{ step_header: 'Boil', step_description: 'Boil the lasagna sheets.' }],
  metadata: { source_type: 'url', source_url: 'https://example.com/lasagna', language: 'en', warnings: [] },
}

const GARBAGE_CANDIDATE = { foo: 'bar' }

function makeGeminiConfig() {
  return loadGeminiConfig({})
}

function fakeGeminiClient(
  handler: (params: GenerateCanonicalRecipeParams) => Promise<unknown>,
): GeminiCanonicalRecipeGenerator {
  return { generateCanonicalRecipe: handler }
}

describe('runUrlIngestionPipeline', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    vi.spyOn(dns.promises, 'lookup').mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
    ] as never)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    globalThis.fetch = originalFetch
  })

  it('returns the primary result when the primary Gemini call succeeds', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(RECIPE_HTML))
    const generateCanonicalRecipe = vi.fn().mockResolvedValue(VALID_CANDIDATE)
    const geminiClient = fakeGeminiClient(generateCanonicalRecipe)

    const result = await runUrlIngestionPipeline({
      url: 'https://example.com/lasagna',
      geminiClient,
      geminiConfig: makeGeminiConfig(),
      requestId: 'req-1',
    })

    expect(result.recipeCandidate).toBe(VALID_CANDIDATE)
    expect(result.diagnostics.extractor).toBe('gemini-primary')
    expect(result.diagnostics.model).toBe('gemini-2.5-pro')
    expect(result.diagnostics.durationMs).toBeGreaterThanOrEqual(0)
    expect(generateCanonicalRecipe).toHaveBeenCalledTimes(1)
  })

  it('falls back to the retry model when the primary call fails the structural pre-check', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(RECIPE_HTML))
    const generateCanonicalRecipe = vi
      .fn()
      .mockResolvedValueOnce(GARBAGE_CANDIDATE)
      .mockResolvedValueOnce(VALID_CANDIDATE)
    const geminiClient = fakeGeminiClient(generateCanonicalRecipe)

    const result = await runUrlIngestionPipeline({
      url: 'https://example.com/lasagna',
      geminiClient,
      geminiConfig: makeGeminiConfig(),
      requestId: 'req-2',
    })

    expect(result.recipeCandidate).toBe(VALID_CANDIDATE)
    expect(result.diagnostics.extractor).toBe('gemini-retry')
    expect(result.diagnostics.model).toBe('gemini-2.5-flash')
    expect(generateCanonicalRecipe).toHaveBeenCalledTimes(2)
    expect(generateCanonicalRecipe.mock.calls[1][0].model).toBe('gemini-2.5-flash')
  })

  it('falls back to retry when the primary call throws', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(RECIPE_HTML))
    const generateCanonicalRecipe = vi
      .fn()
      .mockRejectedValueOnce(new AppError('AI_NORMALIZATION_FAILED', 'boom'))
      .mockResolvedValueOnce(VALID_CANDIDATE)
    const geminiClient = fakeGeminiClient(generateCanonicalRecipe)

    const result = await runUrlIngestionPipeline({
      url: 'https://example.com/lasagna',
      geminiClient,
      geminiConfig: makeGeminiConfig(),
      requestId: 'req-3',
    })

    expect(result.diagnostics.extractor).toBe('gemini-retry')
  })

  it('throws URL_EXTRACTION_FAILED when both primary and retry fail', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(RECIPE_HTML))
    const generateCanonicalRecipe = vi.fn().mockResolvedValue(GARBAGE_CANDIDATE)
    const geminiClient = fakeGeminiClient(generateCanonicalRecipe)

    await expect(
      runUrlIngestionPipeline({
        url: 'https://example.com/lasagna',
        geminiClient,
        geminiConfig: makeGeminiConfig(),
        requestId: 'req-4',
      }),
    ).rejects.toMatchObject({ code: 'URL_EXTRACTION_FAILED' })

    expect(generateCanonicalRecipe).toHaveBeenCalledTimes(2)
  })

  it('throws INVALID_URL for a blocked address before calling Gemini', async () => {
    const generateCanonicalRecipe = vi.fn()
    const geminiClient = fakeGeminiClient(generateCanonicalRecipe)

    await expect(
      runUrlIngestionPipeline({
        url: 'http://127.0.0.1/recipe',
        geminiClient,
        geminiConfig: makeGeminiConfig(),
        requestId: 'req-5',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_URL' })

    expect(generateCanonicalRecipe).not.toHaveBeenCalled()
  })

  it('throws URL_EXTRACTION_FAILED for empty page content without calling Gemini', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(EMPTY_HTML))
    const generateCanonicalRecipe = vi.fn()
    const geminiClient = fakeGeminiClient(generateCanonicalRecipe)

    await expect(
      runUrlIngestionPipeline({
        url: 'https://example.com/empty',
        geminiClient,
        geminiConfig: makeGeminiConfig(),
        requestId: 'req-6',
      }),
    ).rejects.toMatchObject({ code: 'URL_EXTRACTION_FAILED' })

    expect(generateCanonicalRecipe).not.toHaveBeenCalled()
  })
})
