import { randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import { IngestUrlRequestSchema } from 'shared'
import type { ServerEnv } from '../env.js'
import { AppError } from '../lib/errors.js'
import { ok } from '../lib/response.js'
import type { AppVariables } from '../middleware/request-id.js'
import { parseJsonBody } from '../middleware/validate.js'
import type { GeminiConfig } from '../services/ai/config.js'
import type { GeminiClient } from '../services/ai/gemini-client.js'
import { rehostRecipeImages } from '../services/images/image-rehoster.js'
import { runUrlIngestionPipeline } from '../services/ingestion/url-ingestion-pipeline.js'
import { applyPostProcessing, type RawRecipeCandidate } from '../services/post-processing/index.js'
import type { StorageAdapter } from '../services/storage/storage-adapter.js'

export type IngestDeps = {
  env: ServerEnv
  geminiClient: GeminiClient
  geminiConfig: GeminiConfig
  storageAdapter: StorageAdapter
  defaultMainImageUrl: string
}

// Ingestion routes per specs/03. URL ingestion (Option A) is wired to the real
// pipeline here in Phase 2; manual (text+images) ingestion lands in Phase 3.
export function createIngestApp(deps: IngestDeps) {
  const app = new Hono<{ Variables: AppVariables }>()
  const { env, geminiClient, geminiConfig, storageAdapter, defaultMainImageUrl } = deps

  app.post('/ingest/url', async (c) => {
    const requestId = c.get('requestId')
    const { url } = await parseJsonBody(c, IngestUrlRequestSchema)

    // 1. Validate + fetch + Gemini-extract a raw recipe candidate (specs/04).
    const { recipeCandidate, diagnostics } = await runUrlIngestionPipeline({
      url,
      geminiClient,
      geminiConfig,
      requestId,
      env,
    })

    // 2. Deterministic post-processing -> schema-valid canonical recipe, still
    //    referencing the original remote image URLs at this point.
    const canonical = applyPostProcessing(recipeCandidate as RawRecipeCandidate, {
      defaultMainImageUrl,
    })

    // 3. Re-host remote images. recipeId is a fresh UUID used only as the image
    //    storage-key namespace - this is NOT a saved recipe id (save is a
    //    separate explicit user action per Phase 1 / master plan).
    const recipeId = randomUUID()
    const { recipe, warnings } = await rehostRecipeImages(canonical, {
      recipeId,
      storageAdapter,
      maxBytes: env.IMAGE_MAX_BYTES,
      defaultMainImageUrl,
      timeoutMs: env.URL_FETCH_TIMEOUT_MS,
    })

    // 4. Merge any image warnings into the recipe's own warnings list.
    const finalRecipe = {
      ...recipe,
      metadata: {
        ...recipe.metadata,
        warnings: [...recipe.metadata.warnings, ...warnings],
      },
    }

    return c.json(ok(requestId, { recipe: finalRecipe, diagnostics }))
  })

  app.post('/ingest/manual', () => {
    throw new AppError('NOT_IMPLEMENTED', 'Manual ingestion is not implemented yet (lands in Phase 3).')
  })

  return app
}
