import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { IngestUrlRequestSchema, type CanonicalRecipe, type UnhostedImage } from 'shared';
import type { ServerEnv } from '../env.js';
import { AppError } from '../lib/errors.js';
import { logStage } from '../lib/log.js';
import { ok } from '../lib/response.js';
import type { AppVariables } from '../middleware/request-id.js';
import { parseJsonBody } from '../middleware/validate.js';
import type { GeminiConfig } from '../services/ai/config.js';
import type { GeminiClient } from '../services/ai/gemini-client.js';
import { rehostRecipeImages } from '../services/images/image-rehoster.js';
import { runManualIngestionPipeline } from '../services/ingestion/manual-ingestion-pipeline.js';
import { hostUploadedImage } from '../services/images/upload-image-hoster.js';
import { extractRecipeFromHtml, runUrlIngestionPipeline } from '../services/ingestion/url-ingestion-pipeline.js';
import { loadIngredientCatalog } from '../services/ingredient-matching/catalog.js';
import { createIngredientImageMatcher } from '../services/ingredient-matching/ingredient-image-matcher.js';
import { parseManualUploadBody } from '../services/manual-ingestion/manual-upload-parser.js';
import { applyPostProcessing, type RawRecipeCandidate } from '../services/post-processing/index.js';
import type { StorageAdapter } from '../services/storage/storage-adapter.js';
import { validateUrlSyntax } from '../services/url-ingestion/url-security.js';

export type IngestDeps = {
  env: ServerEnv
  geminiClient: GeminiClient
  geminiConfig: GeminiConfig
  storageAdapter: StorageAdapter
  defaultMainImageUrl: string
}

// Client-supplied main image for finishUrlStyleIngest: either bytes already
// hosted, or the rejection of the bytes (placeholder + unhosted entry).
type MainImageOverride = { hostedUrl: string } | { sourceUrl: string; warning: string }

// Ingestion routes per docs/specs/03. Both URL ingestion (Option A, Phase 2) and
// manual text+images ingestion (Option B, Phase 3) are wired to their real
// pipelines here.
export function createIngestApp(deps: IngestDeps) {
  const app = new Hono<{ Variables: AppVariables }>();
  const { env, geminiClient, geminiConfig, storageAdapter, defaultMainImageUrl } = deps;
  const ingredientImageMatcher = createIngredientImageMatcher({
    geminiClient,
    geminiConfig,
    catalog: loadIngredientCatalog(),
  });

  // Shared tail of /ingest/url and /ingest/capture: post-processing, image
  // re-hosting and warning merge. recipeId is a fresh UUID used only as the
  // image storage-key namespace - NOT a saved recipe id (save is a separate
  // explicit user action).
  async function finishUrlStyleIngest(
    candidate: RawRecipeCandidate,
    opts: { requestId: string; recipeId?: string; mainImage?: MainImageOverride },
  ): Promise<{ recipe: CanonicalRecipe; unhosted: UnhostedImage[]; imageNamespaceId: string }> {
    const { requestId, mainImage } = opts;
    const recipeId = opts.recipeId ?? randomUUID();

    // Deterministic post-processing -> schema-valid canonical recipe, still
    // referencing the original remote image URLs at this point.
    const postProcessStart = Date.now();
    const canonical = await applyPostProcessing(candidate, { defaultMainImageUrl, ingredientImageMatcher });
    logStage({
      requestId,
      stage: 'post-process',
      durationMs: Date.now() - postProcessStart,
      outcome: 'ok',
    });

    // A main image supplied by the client replaces whatever the model picked
    // and is never re-downloaded.
    const clientWarnings: string[] = [];
    const clientUnhosted: UnhostedImage[] = [];
    let toRehost = canonical;
    if (mainImage) {
      if ('hostedUrl' in mainImage) {
        toRehost = { ...canonical, main_image: mainImage.hostedUrl };
      } else {
        toRehost = { ...canonical, main_image: defaultMainImageUrl };
        clientWarnings.push(mainImage.warning);
        clientUnhosted.push({ slot: 'main', url: mainImage.sourceUrl, warning: mainImage.warning });
      }
    }

    const imageRehostStart = Date.now();
    const { recipe, warnings, unhosted } = await rehostRecipeImages(toRehost, {
      recipeId,
      storageAdapter,
      maxBytes: env.IMAGE_MAX_BYTES,
      defaultMainImageUrl,
      timeoutMs: env.URL_FETCH_TIMEOUT_MS,
      skipMainImage: mainImage !== undefined,
    });
    logStage({
      requestId,
      stage: 'image-rehost',
      durationMs: Date.now() - imageRehostStart,
      outcome: 'ok',
      imageCount:
        (recipe.main_image === defaultMainImageUrl || recipe.main_image === canonical.main_image ? 0 : 1) +
        recipe.steps.filter((step) => step.image !== undefined).length,
    });

    // Merge image warnings into the recipe's own warnings list.
    const finalRecipe = {
      ...recipe,
      metadata: {
        ...recipe.metadata,
        warnings: [...recipe.metadata.warnings, ...clientWarnings, ...warnings],
      },
    };
    return { recipe: finalRecipe, unhosted: [...clientUnhosted, ...unhosted], imageNamespaceId: recipeId };
  }

  app.post('/ingest/url', async (c) => {
    const requestId = c.get('requestId');
    const { url } = await parseJsonBody(c, IngestUrlRequestSchema);

    // 1. Validate + fetch + Gemini-extract a raw recipe candidate (docs/specs/04).
    const { recipeCandidate, diagnostics } = await runUrlIngestionPipeline({
      url,
      geminiClient,
      geminiConfig,
      requestId,
      env,
    });

    const { recipe, imageNamespaceId } = await finishUrlStyleIngest(
      recipeCandidate as RawRecipeCandidate,
      { requestId },
    );

    // imageNamespaceId lets the review UI upload step images into the same
    // storage-key namespace later (POST /api/image/step).
    return c.json(ok(requestId, { recipe, diagnostics, imageNamespaceId }));
  });

  app.use(
    '/ingest/capture',
    bodyLimit({
      maxSize: env.MANUAL_REQUEST_MAX_BYTES,
      onError: () => {
        throw new AppError('INVALID_INPUT', 'The capture request exceeds the maximum allowed size.');
      },
    }),
  );

  // Recipe page HTML captured by the user's own browser (docs/specs/15). Same
  // processing as /ingest/url from "after fetch" on; the page URL is never
  // fetched and the HTML is untrusted exactly like fetched HTML.
  app.post('/ingest/capture', async (c) => {
    const requestId = c.get('requestId');
    const startedAt = Date.now();
    const body = await c.req.parseBody();

    const rawUrl = body.url;
    if (typeof rawUrl !== 'string') {
      throw new AppError('INVALID_URL', 'A "url" field is required.');
    }
    const pageUrl = validateUrlSyntax(rawUrl).toString();

    const html = body.html;
    if (typeof html !== 'string' || html.length === 0) {
      throw new AppError('INVALID_INPUT', 'A non-empty "html" field is required.');
    }
    if (Buffer.byteLength(html, 'utf8') > env.URL_MAX_RESPONSE_BYTES) {
      throw new AppError('INVALID_INPUT', `The captured page exceeds the ${env.URL_MAX_RESPONSE_BYTES}-byte limit.`);
    }

    let mainImageUrl: string | undefined;
    if (body.mainImageUrl !== undefined && body.mainImageUrl !== '') {
      if (typeof body.mainImageUrl !== 'string' || !/^https?:\/\//i.test(body.mainImageUrl)) {
        throw new AppError('INVALID_INPUT', '"mainImageUrl" must be an http(s) URL.');
      }
      mainImageUrl = body.mainImageUrl;
    }
    const mainImageFile = body.mainImage;
    if (mainImageFile !== undefined && !(mainImageFile instanceof File)) {
      throw new AppError('INVALID_INPUT', '"mainImage" must be a file upload.');
    }
    if (mainImageFile !== undefined && mainImageUrl === undefined) {
      throw new AppError('INVALID_INPUT', '"mainImage" requires "mainImageUrl".');
    }

    const { recipeCandidate, diagnostics } = await extractRecipeFromHtml({
      html,
      pageUrl,
      fetchMode: 'capture',
      requestId,
      geminiClient,
      geminiConfig,
      startedAt,
    });

    const candidate = recipeCandidate as RawRecipeCandidate;
    const recipeId = randomUUID();
    // The captured page is the source; never trust a model-supplied source_url.
    const withSource = {
      ...candidate,
      metadata: { ...candidate.metadata, source_type: 'url', source_url: pageUrl },
    } as RawRecipeCandidate;

    let mainImage: MainImageOverride | undefined;
    if (mainImageFile instanceof File && mainImageUrl !== undefined) {
      const hosted = await hostUploadedImage(
        {
          buffer: Buffer.from(await mainImageFile.arrayBuffer()),
          contentType: mainImageFile.type,
          filename: mainImageFile.name,
        },
        { recipeId, storageAdapter, maxBytes: env.IMAGE_MAX_BYTES, kind: 'main', index: 0 },
      );
      mainImage = 'url' in hosted ? { hostedUrl: hosted.url } : { sourceUrl: mainImageUrl, warning: hosted.warning };
    } else if (mainImageUrl !== undefined) {
      // Only the URL: it replaces Gemini's pick and is downloaded (with SSRF
      // guardrails) by the re-hoster.
      (withSource as { main_image?: string }).main_image = mainImageUrl;
    }

    const { recipe, unhosted } = await finishUrlStyleIngest(withSource, { requestId, recipeId, mainImage });
    return c.json(ok(requestId, { recipe, diagnostics, imageNamespaceId: recipeId, unhosted }));
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
    //    assign hosted step images onto the returned steps (docs/specs/05).
    const { recipeCandidate, diagnostics, warnings: pipelineWarnings } = await runManualIngestionPipeline({
      parsed,
      geminiClient,
      geminiConfig,
      storageAdapter,
      recipeId,
      maxImageBytes: env.IMAGE_MAX_BYTES,
      requestId,
      imageFetchTimeoutMs: env.URL_FETCH_TIMEOUT_MS,
    });

    // 4. Deterministic post-processing -> schema-valid canonical recipe.
    //    metadata.source_type is forced to 'manual' and source_url is
    //    stripped server-side, never trusted from the model's output:
    //    manual input has no source URL, so any value is hallucinated.
    const postProcessStart = Date.now();
    const canonical = await applyPostProcessing(
      {
        ...recipeCandidate,
        metadata: {
          ...recipeCandidate.metadata,
          source_type: 'manual',
          source_url: undefined,
        },
      } as RawRecipeCandidate,
      { defaultMainImageUrl, ingredientImageMatcher },
    );
    logStage({
      requestId,
      stage: 'post-process',
      durationMs: Date.now() - postProcessStart,
      outcome: 'ok',
    });

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

    // 6. Return the assembled response. imageNamespaceId as in the URL route.
    return c.json(ok(requestId, { recipe: finalRecipe, diagnostics, imageNamespaceId: recipeId }));
  });

  return app;
}
