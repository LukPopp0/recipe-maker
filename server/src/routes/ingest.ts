import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { IngestUrlRequestSchema } from 'shared';
import type { ServerEnv } from '../env.js';
import { AppError } from '../lib/errors.js';
import { ok } from '../lib/response.js';
import type { AppVariables } from '../middleware/request-id.js';
import { parseJsonBody } from '../middleware/validate.js';
import type { GeminiConfig } from '../services/ai/config.js';
import type { GeminiClient } from '../services/ai/gemini-client.js';
import { rehostRecipeImages } from '../services/images/image-rehoster.js';
import { runManualIngestionPipeline } from '../services/ingestion/manual-ingestion-pipeline.js';
import { runUrlIngestionPipeline } from '../services/ingestion/url-ingestion-pipeline.js';
import { parseManualUploadBody } from '../services/manual-ingestion/manual-upload-parser.js';
import { applyPostProcessing, type RawRecipeCandidate } from '../services/post-processing/index.js';
import type { StorageAdapter } from '../services/storage/storage-adapter.js';

export type IngestDeps = {
  env: ServerEnv
  geminiClient: GeminiClient
  geminiConfig: GeminiConfig
  storageAdapter: StorageAdapter
  defaultMainImageUrl: string
}

// Ingestion routes per specs/03. Both URL ingestion (Option A, Phase 2) and
// manual text+images ingestion (Option B, Phase 3) are wired to their real
// pipelines here.
export function createIngestApp(deps: IngestDeps) {
  const app = new Hono<{ Variables: AppVariables }>();
  const { env, geminiClient, geminiConfig, storageAdapter, defaultMainImageUrl } = deps;

  app.post('/ingest/url', async (c) => {
    const requestId = c.get('requestId');
    const { url } = await parseJsonBody(c, IngestUrlRequestSchema);

    // 1. Validate + fetch + Gemini-extract a raw recipe candidate (specs/04).
    const { recipeCandidate, diagnostics } = await runUrlIngestionPipeline({
      url,
      geminiClient,
      geminiConfig,
      requestId,
      env,
    });

    // 2. Deterministic post-processing -> schema-valid canonical recipe, still
    //    referencing the original remote image URLs at this point.
    const canonical = applyPostProcessing(recipeCandidate as RawRecipeCandidate, {
      defaultMainImageUrl,
    });

    // 3. Re-host remote images. recipeId is a fresh UUID used only as the image
    //    storage-key namespace - this is NOT a saved recipe id (save is a
    //    separate explicit user action per Phase 1 / master plan).
    const recipeId = randomUUID();
    const { recipe, warnings } = await rehostRecipeImages(canonical, {
      recipeId,
      storageAdapter,
      maxBytes: env.IMAGE_MAX_BYTES,
      defaultMainImageUrl,
      timeoutMs: env.URL_FETCH_TIMEOUT_MS,
    });

    // 4. Merge any image warnings into the recipe's own warnings list.
    const finalRecipe = {
      ...recipe,
      metadata: {
        ...recipe.metadata,
        warnings: [...recipe.metadata.warnings, ...warnings],
      },
    };

    return c.json(ok(requestId, { recipe: finalRecipe, diagnostics }));
  });

  app.use(
    '/ingest/manual',
    bodyLimit({
      maxSize: env.MANUAL_REQUEST_MAX_BYTES,
      onError: () => {
        throw new AppError('INVALID_INPUT', 'The manual upload request exceeds the maximum allowed size.');
      },
    }),
  );

  app.post('/ingest/manual', async (c) => {
    const requestId = c.get('requestId');

    // 1. Parse + validate the multipart body (text fields + image files).
    const parsed = await parseManualUploadBody(c);

    // 2. Fresh UUID used only as the image storage-key namespace - not a
    //    saved recipe id (save is a separate explicit user action).
    const recipeId = randomUUID();

    // 3. Host uploaded images, run the single Gemini normalization call, and
    //    assign hosted step images onto the returned steps (specs/05).
    const { recipeCandidate, diagnostics, warnings: pipelineWarnings } = await runManualIngestionPipeline({
      parsed,
      geminiClient,
      geminiConfig,
      storageAdapter,
      recipeId,
      maxImageBytes: env.IMAGE_MAX_BYTES,
      requestId,
    });

    // 4. Deterministic post-processing -> schema-valid canonical recipe.
    //    metadata.source_type is forced to 'manual' server-side, never
    //    trusted from the model's output, since a hallucinated 'url' value
    //    must never leak through.
    const canonical = applyPostProcessing(
      {
        ...recipeCandidate,
        metadata: { ...recipeCandidate.metadata, source_type: 'manual' },
      } as RawRecipeCandidate,
      { defaultMainImageUrl },
    );

    // 5. Merge pipeline warnings (image hosting failures, step-image
    //    assignment mismatches) into the recipe's own warnings list, same
    //    merge pattern as the URL route's image warnings.
    const finalRecipe = {
      ...canonical,
      metadata: {
        ...canonical.metadata,
        warnings: [...canonical.metadata.warnings, ...pipelineWarnings],
      },
    };

    // 6. Return the assembled response.
    return c.json(ok(requestId, { recipe: finalRecipe, diagnostics }));
  });

  return app;
}
