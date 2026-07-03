import { AppError } from '../../lib/errors.js';
import type { GeminiConfig } from '../ai/config.js';
import type { GeminiClient } from '../ai/gemini-client.js';
import { buildManualIngestionPrompt } from '../ai/prompts/manual-ingestion.js';
import { hostUploadedImage } from '../images/upload-image-hoster.js';
import type { ParsedManualUpload } from '../manual-ingestion/manual-upload-parser.js';
import { assignStepImageUrls, sortStepImageFilenames } from '../manual-ingestion/step-image-assigner.js';
import type { RawRecipeCandidate } from '../post-processing/index.js';
import type { StorageAdapter } from '../storage/storage-adapter.js';

export interface RunManualIngestionPipelineParams {
  parsed: ParsedManualUpload
  geminiClient: GeminiClient
  geminiConfig: GeminiConfig
  storageAdapter: StorageAdapter
  recipeId: string
  maxImageBytes: number
  requestId: string
}

export interface RunManualIngestionPipelineResult {
  recipeCandidate: RawRecipeCandidate
  diagnostics: {
    extractor: 'gemini-primary'
    model: string
    durationMs: number
  }
  warnings: string[]
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
}: RunManualIngestionPipelineParams): Promise<RunManualIngestionPipelineResult> {
  const pipelineStart = Date.now();
  const warnings: string[] = [];

  // Step 1: host the main image. A hosting failure is non-critical - collect
  // the warning and leave main_image unset so finalSanitize's default
  // fallback applies downstream, same as Option A's contract.
  const mainImageResult = await hostUploadedImage(parsed.mainImage, {
    recipeId,
    storageAdapter,
    maxBytes: maxImageBytes,
    kind: 'main',
    index: 0,
  });

  let hostedMainImageUrl: string | undefined;
  if ('warning' in mainImageResult) {
    warnings.push(mainImageResult.warning);
  } else {
    hostedMainImageUrl = mainImageResult.url;
  }

  // Step 2: sort step images into a stable order, then host each in turn,
  // skipping (and warning on) any that fail to host.
  const sortedStepImages = sortStepImageFilenames(parsed.stepImages);
  const hostedStepImageUrls: string[] = [];

  for (let index = 0; index < sortedStepImages.length; index++) {
    const result = await hostUploadedImage(sortedStepImages[index], {
      recipeId,
      storageAdapter,
      maxBytes: maxImageBytes,
      kind: 'step',
      index,
    });

    if ('warning' in result) {
      warnings.push(result.warning);
    } else {
      hostedStepImageUrls.push(result.url);
    }
  }

  // Step 3: single Gemini normalization call over the raw text.
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
    throw new AppError('AI_NORMALIZATION_FAILED', 'Could not normalize the provided recipe text.', {
      requestId,
    });
  }

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
