import { describe, expect, it, vi } from 'vitest'
import { loadGeminiConfig } from '../ai/config.js'
import type { GeminiClient } from '../ai/gemini-client.js'
import type { ParsedManualUpload } from '../manual-ingestion/manual-upload-parser.js'
import type { StorageAdapter } from '../storage/storage-adapter.js'
import { runManualIngestionPipeline } from './manual-ingestion-pipeline.js'

function makeStorageAdapter(): StorageAdapter & { put: ReturnType<typeof vi.fn> } {
  let counter = 0
  return {
    put: vi.fn().mockImplementation(async (_buffer: Buffer, key: string) => {
      counter += 1
      return `http://localhost:8787/images/${key}?v=${counter}`
    }),
    get: vi.fn(),
    delete: vi.fn(),
  }
}

function makeFile(overrides: Partial<{ buffer: Buffer; contentType: string; filename: string }> = {}) {
  return {
    buffer: Buffer.from([1, 2, 3, 4]),
    contentType: 'image/jpeg',
    filename: 'photo.jpg',
    ...overrides,
  }
}

function makeParsed(overrides: Partial<ParsedManualUpload> = {}): ParsedManualUpload {
  return {
    ingredientsText: '2 eggs\n1 cup flour',
    stepsText: 'Mix everything.\nBake at 180C.',
    mainImage: makeFile({ filename: 'main.jpg' }),
    stepImages: [],
    ...overrides,
  }
}

function fakeGeminiClient(handler: (params: unknown) => Promise<unknown>): GeminiClient {
  return { generateCanonicalRecipe: handler } as unknown as GeminiClient
}

const VALID_CANDIDATE = {
  title: 'Pancakes',
  tags: [],
  time: 20,
  ingredients: [{ name: 'flour', amount_text: '1 cup' }],
  pantry_items: [],
  steps: [
    { step_header: 'Mix', step_description: 'Mix everything.' },
    { step_header: 'Bake', step_description: 'Bake at 180C.' },
  ],
  metadata: { source_type: 'manual', language: 'en', warnings: [] },
}

const GARBAGE_CANDIDATE = { foo: 'bar' }

function makeGeminiConfig() {
  return loadGeminiConfig({})
}

describe('runManualIngestionPipeline', () => {
  it('hosts the main image, assigns step images by index, and returns no warnings on the happy path', async () => {
    const storageAdapter = makeStorageAdapter()
    const generateCanonicalRecipe = vi.fn().mockResolvedValue(VALID_CANDIDATE)
    const geminiClient = fakeGeminiClient(generateCanonicalRecipe)

    const parsed = makeParsed({
      stepImages: [
        makeFile({ filename: 'step-2.jpg' }),
        makeFile({ filename: 'step-1.jpg' }),
      ],
    })

    const result = await runManualIngestionPipeline({
      parsed,
      geminiClient,
      geminiConfig: makeGeminiConfig(),
      storageAdapter,
      recipeId: 'recipe-1',
      maxImageBytes: 1024,
      requestId: 'req-1',
    })

    expect(result.warnings).toEqual([])
    expect(result.recipeCandidate.main_image).toContain('recipes/recipe-1/main-0.jpg')
    expect(result.recipeCandidate.steps).toHaveLength(2)
    // step-1.jpg sorts before step-2.jpg (natural sort), so it is hosted first
    // and assigned to step index 0.
    expect(result.recipeCandidate.steps[0].image).toContain('recipes/recipe-1/step-0.jpg')
    expect(result.recipeCandidate.steps[1].image).toContain('recipes/recipe-1/step-1.jpg')
    expect(result.diagnostics.extractor).toBe('gemini-primary')
    expect(result.diagnostics.model).toBe('gemini-2.5-pro')
    expect(result.diagnostics.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('warns and leaves main_image unset when the main image is oversized', async () => {
    const storageAdapter = makeStorageAdapter()
    const generateCanonicalRecipe = vi.fn().mockResolvedValue(VALID_CANDIDATE)
    const geminiClient = fakeGeminiClient(generateCanonicalRecipe)

    const parsed = makeParsed({
      mainImage: makeFile({ buffer: Buffer.alloc(2048), filename: 'main.jpg' }),
    })

    const result = await runManualIngestionPipeline({
      parsed,
      geminiClient,
      geminiConfig: makeGeminiConfig(),
      storageAdapter,
      recipeId: 'recipe-1',
      maxImageBytes: 1024,
      requestId: 'req-2',
    })

    expect(result.recipeCandidate.main_image).toBeUndefined()
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('main.jpg')
  })

  it('produces an ignored-count warning when there are more step images than steps', async () => {
    const storageAdapter = makeStorageAdapter()
    const generateCanonicalRecipe = vi.fn().mockResolvedValue(VALID_CANDIDATE)
    const geminiClient = fakeGeminiClient(generateCanonicalRecipe)

    const parsed = makeParsed({
      stepImages: [
        makeFile({ filename: 'step-1.jpg' }),
        makeFile({ filename: 'step-2.jpg' }),
        makeFile({ filename: 'step-3.jpg' }),
      ],
    })

    const result = await runManualIngestionPipeline({
      parsed,
      geminiClient,
      geminiConfig: makeGeminiConfig(),
      storageAdapter,
      recipeId: 'recipe-1',
      maxImageBytes: 1024,
      requestId: 'req-3',
    })

    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toMatch(/1 step image\(s\) were ignored/)
    expect(result.recipeCandidate.steps).toHaveLength(2)
  })

  it('throws AI_NORMALIZATION_FAILED when Gemini returns a title-less/stepless candidate', async () => {
    const storageAdapter = makeStorageAdapter()
    const generateCanonicalRecipe = vi.fn().mockResolvedValue(GARBAGE_CANDIDATE)
    const geminiClient = fakeGeminiClient(generateCanonicalRecipe)

    const parsed = makeParsed()

    await expect(
      runManualIngestionPipeline({
        parsed,
        geminiClient,
        geminiConfig: makeGeminiConfig(),
        storageAdapter,
        recipeId: 'recipe-1',
        maxImageBytes: 1024,
        requestId: 'req-4',
      }),
    ).rejects.toMatchObject({ code: 'AI_NORMALIZATION_FAILED' })
  })

  it('is deterministic: the same input run twice produces identical recipeCandidate (excluding durationMs)', async () => {
    const parsed = makeParsed({
      stepImages: [makeFile({ filename: 'step-1.jpg' }), makeFile({ filename: 'step-2.jpg' })],
    })

    const run = async () => {
      const storageAdapter = makeStorageAdapter()
      const generateCanonicalRecipe = vi.fn().mockResolvedValue(VALID_CANDIDATE)
      const geminiClient = fakeGeminiClient(generateCanonicalRecipe)

      return runManualIngestionPipeline({
        parsed,
        geminiClient,
        geminiConfig: makeGeminiConfig(),
        storageAdapter,
        recipeId: 'recipe-1',
        maxImageBytes: 1024,
        requestId: 'req-5',
      })
    }

    const first = await run()
    const second = await run()

    expect(first.recipeCandidate).toEqual(second.recipeCandidate)
    expect(first.warnings).toEqual(second.warnings)
    expect(first.diagnostics.extractor).toEqual(second.diagnostics.extractor)
    expect(first.diagnostics.model).toEqual(second.diagnostics.model)
  })
})
