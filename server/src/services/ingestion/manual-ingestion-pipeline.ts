import { AppError } from '../../lib/errors.js';
import { logStage } from '../../lib/log.js';
import type { GeminiConfig } from '../ai/config.js';
import type { GeminiClient } from '../ai/gemini-client.js';
import { buildManualIngestionPrompt } from '../ai/prompts/manual-ingestion.js';
import { fetchAndStoreRemoteImage } from '../images/remote-image-fetcher.js';
import { hostUploadedImage } from '../images/upload-image-hoster.js';
import type { ManualImageInput, ParsedManualUpload } from '../manual-ingestion/manual-upload-parser.js';
import {
  assignStepImageUrls,
  sortStepImageFilenames,
} from '../manual-ingestion/step-image-assigner.js';
import type { RawRecipeCandidate } from '../post-processing/index.js';
import type { StorageAdapter } from '../storage/storage-adapter.js';

export interface RunManualIngestionPipelineParams {
  parsed: ParsedManualUpload;
  geminiClient: GeminiClient;
  geminiConfig: GeminiConfig;
  storageAdapter: StorageAdapter;
  recipeId: string;
  maxImageBytes: number;
  requestId: string;
  // Hard timeout (ms) for downloading a url-kind image input. Omitted in unit
  // tests; the route passes env.URL_FETCH_TIMEOUT_MS.
  imageFetchTimeoutMs?: number;
}

interface HostManualImageOptions {
  recipeId: string;
  storageAdapter: StorageAdapter;
  maxBytes: number;
  kind: 'main' | 'step';
  index: number;
  timeoutMs?: number;
}

// Hosts a single manual-ingestion image input regardless of its source:
// uploaded files go through hostUploadedImage, remote URLs are fetched and
// stored via fetchAndStoreRemoteImage under the same key scheme. Both paths
// return the shared { url } | { warning } contract so the pipeline treats them
// uniformly (a failure is non-critical: warn and continue).
async function hostManualImage(
  input: ManualImageInput,
  options: HostManualImageOptions,
): Promise<{ url: string } | { warning: string }> {
  const { recipeId, storageAdapter, maxBytes, kind, index, timeoutMs } = options;

  if (input.kind === 'file') {
    return hostUploadedImage(input.file, { recipeId, storageAdapter, maxBytes, kind, index });
  }

  const result = await fetchAndStoreRemoteImage(input.url, {
    storageAdapter,
    maxBytes,
    keyPrefix: `recipes/${recipeId}/${kind}-${index}`,
    timeoutMs,
  });

  if (result.ok) {
    return { url: result.url };
  }

  switch (result.reason) {
    case 'blocked':
      return { warning: `"${input.url}" was not fetched: the URL was blocked or invalid.` };
    case 'status':
      return { warning: `"${input.url}" was not fetched: request failed with status ${result.status}.` };
    case 'unsupported-type':
      return { warning: `"${input.url}" was not fetched: unsupported content type "${result.contentType}".` };
    case 'oversized':
      return { warning: `"${input.url}" was not fetched: exceeded the ${maxBytes}-byte limit.` };
    case 'timeout':
      return { warning: `"${input.url}" was not fetched: timed out while downloading.` };
    case 'error':
      return { warning: `"${input.url}" was not fetched: failed to download (${result.message}).` };
  }
}

export interface RunManualIngestionPipelineResult {
  recipeCandidate: RawRecipeCandidate;
  diagnostics: {
    extractor: 'gemini-primary';
    model: string;
    durationMs: number;
  };
  warnings: string[];
}

// Light structural pre-check on a raw Gemini JSON response: non-empty title,
// at least one ingredient, at least one step. Mirrors the equivalent check in
// url-ingestion-pipeline.ts - not full Zod validation (that's post-processing's
// job), just enough to reject an obviously unusable response before it's
// merged with hosted image URLs and returned.
function passesStructuralPreCheck(candidate: unknown): candidate is RawRecipeCandidate {
  if (typeof candidate !== 'object' || candidate === null) return false;
  const record = candidate as Record<string, unknown>;

  const hasTitle = typeof record.title === 'string' && record.title.trim().length > 0;
  const hasIngredient = Array.isArray(record.ingredients) && record.ingredients.length > 0;
  const hasStep = Array.isArray(record.steps) && record.steps.length > 0;

  return hasTitle && hasIngredient && hasStep;
}

// Orchestrates Option B (manual text + images) ingestion per specs/05: host
// the user's uploaded main/step images, run a single Gemini normalization
// call over the raw ingredients/steps text, structurally validate the
// response, then deterministically assign the hosted step images onto the
// returned steps by index. Unlike Option A there is no retry - a failed
// structural pre-check throws AI_NORMALIZATION_FAILED immediately (Scope
// Decision 2). Image hosting failures are non-critical: they degrade to a
// warning rather than aborting the pipeline (specs/06).
export async function runManualIngestionPipeline({
  parsed,
  geminiClient,
  geminiConfig,
  storageAdapter,
  recipeId,
  maxImageBytes,
  requestId,
  imageFetchTimeoutMs,
}: RunManualIngestionPipelineParams): Promise<RunManualIngestionPipelineResult> {
  const pipelineStart = Date.now();
  const warnings: string[] = [];
  const hostImagesStart = Date.now();

  // Step 1: host the main image (uploaded file or fetched URL). A hosting
  // failure is non-critical - collect the warning and leave main_image unset
  // so finalSanitize's default fallback applies downstream, same as Option A's
  // contract.
  const mainImageResult = await hostManualImage(parsed.mainImage, {
    recipeId,
    storageAdapter,
    maxBytes: maxImageBytes,
    kind: 'main',
    index: 0,
    timeoutMs: imageFetchTimeoutMs,
  });

  let hostedMainImageUrl: string | undefined;
  if ('warning' in mainImageResult) {
    warnings.push(mainImageResult.warning);
  } else {
    hostedMainImageUrl = mainImageResult.url;
  }

  // Step 2: order step images, then host each in turn, skipping (and warning
  // on) any that fail to host. File uploads are sorted by filename (the user
  // controls those names); URL images keep their add order because the
  // server-side stored name is not user-controllable, so filename sort would
  // be meaningless for them. Sorted files come first, then URLs in add order.
  const fileStepImages = sortStepImageFilenames(parsed.stepImages.filter((input) => input.kind === 'file'));
  const urlStepImages = parsed.stepImages.filter((input) => input.kind === 'url');
  const orderedStepImages = [...fileStepImages, ...urlStepImages];
  const hostedStepImageUrls: string[] = [];

  for (let index = 0; index < orderedStepImages.length; index++) {
    const result = await hostManualImage(orderedStepImages[index], {
      recipeId,
      storageAdapter,
      maxBytes: maxImageBytes,
      kind: 'step',
      index,
      timeoutMs: imageFetchTimeoutMs,
    });

    if ('warning' in result) {
      warnings.push(result.warning);
    } else {
      hostedStepImageUrls.push(result.url);
    }
  }

  logStage({
    requestId,
    stage: 'host-images',
    durationMs: Date.now() - hostImagesStart,
    outcome: 'ok',
    imageCount: hostedStepImageUrls.length + (hostedMainImageUrl !== undefined ? 1 : 0),
  });

  // Step 3: single Gemini normalization call over the raw text.
  const normalizeStart = Date.now();
  const prompt = buildManualIngestionPrompt({
    ingredientsText: parsed.ingredientsText,
    stepsText: parsed.stepsText,
    stepImageCount: parsed.stepImages.length,
  });

  const rawCandidate = await geminiClient.generateCanonicalRecipe({
    model: geminiConfig.primaryModel,
    prompt,
    timeoutMs: geminiConfig.timeoutMs,
  });

  // Step 4: structural pre-check - no retry for manual ingestion.
  if (!passesStructuralPreCheck(rawCandidate)) {
    logStage({
      requestId,
      stage: 'normalize',
      durationMs: Date.now() - normalizeStart,
      outcome: 'error',
      errorCode: 'AI_NORMALIZATION_FAILED',
    });
    throw new AppError('AI_NORMALIZATION_FAILED', 'Could not normalize the provided recipe text.', {
      requestId,
    });
  }

  logStage({
    requestId,
    stage: 'normalize',
    durationMs: Date.now() - normalizeStart,
    outcome: 'ok',
  });

  // Step 5: assign hosted step images onto the returned steps by index.
  const assignment = assignStepImageUrls(hostedStepImageUrls, rawCandidate.steps.length);
  warnings.push(...assignment.warnings);

  const steps = rawCandidate.steps.map((step, index) => {
    const image = assignment.stepImageUrls[index];
    return image === undefined ? step : { ...step, image };
  });

  // Step 6: set main_image to the hosted URL if hosting succeeded, else leave unset.
  // Step 6a: force tags empty - manual ingestion never gets Gemini-assigned tags,
  // even if the model ignored the prompt and emitted the field anyway. Tags are
  // fully user-set in the review UI (wired in Phase 5).
  const recipeCandidate: RawRecipeCandidate = {
    ...rawCandidate,
    steps,
    tags: [],
    ...(hostedMainImageUrl !== undefined ? { main_image: hostedMainImageUrl } : {}),
  };

  // Step 7: return the assembled candidate, diagnostics, and accumulated warnings.
  return {
    recipeCandidate,
    diagnostics: {
      extractor: 'gemini-primary',
      model: geminiConfig.primaryModel,
      durationMs: Date.now() - pipelineStart,
    },
    warnings,
  };
}
