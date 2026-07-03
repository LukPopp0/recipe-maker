import { AppError } from '../../lib/errors.js'
import { loadServerEnv, type ServerEnv } from '../../env.js'
import type { GeminiConfig } from '../ai/config.js'
import type { GenerateCanonicalRecipeParams } from '../ai/gemini-client.js'
import { buildUrlIngestionPrompt, buildUrlIngestionRetryPrompt } from '../ai/prompts/url-ingestion.js'
import { cleanHtmlForExtraction } from '../url-ingestion/html-cleaner.js'
import { fetchWithGuardrails, validateUrlSyntax } from '../url-ingestion/url-security.js'

// Minimal slice of GeminiClient this pipeline depends on, so tests can inject
// a fake without touching the real @google/genai SDK.
export interface GeminiCanonicalRecipeGenerator {
  generateCanonicalRecipe(params: GenerateCanonicalRecipeParams): Promise<unknown>
}

export type UrlIngestionExtractor = 'gemini-primary' | 'gemini-retry'

export interface RunUrlIngestionPipelineParams {
  url: string
  geminiClient: GeminiCanonicalRecipeGenerator
  geminiConfig: GeminiConfig
  requestId: string
  // Fetch guardrail config (timeout/redirects/size). Optional so callers that
  // already have a loaded ServerEnv can pass it straight through (Task 8's
  // route); defaults to loadServerEnv({})'s values otherwise.
  env?: Pick<ServerEnv, 'URL_FETCH_TIMEOUT_MS' | 'URL_MAX_REDIRECTS' | 'URL_MAX_RESPONSE_BYTES'>
}

export interface RunUrlIngestionPipelineResult {
  recipeCandidate: unknown
  diagnostics: {
    extractor: UrlIngestionExtractor
    model: string
    durationMs: number
  }
}

// Below this many characters of cleaned visible text, a page is treated as
// not containing a recognizable recipe - not worth spending a Gemini call on.
// Heuristic per specs/04's "missing minimum required content" failure
// condition, not a precise measurement.
const MIN_CONTENT_CHARS = 40

// The retry attempt uses a smaller content budget than the primary attempt,
// on the theory that a smaller/more focused chunk is easier for the retry
// model to extract structure from cleanly.
const RETRY_TOKEN_BUDGET_DIVISOR = 2

// Light structural pre-check on a raw Gemini JSON response: non-empty title,
// at least one ingredient, at least one step. This is NOT full Zod
// validation (that's post-processing's job in Task 6) - just enough to
// decide whether the primary attempt is worth accepting or should fall back
// to the retry prompt.
function passesStructuralPreCheck(candidate: unknown): boolean {
  if (typeof candidate !== 'object' || candidate === null) return false
  const record = candidate as Record<string, unknown>

  const hasTitle = typeof record.title === 'string' && record.title.trim().length > 0
  const hasIngredient = Array.isArray(record.ingredients) && record.ingredients.length > 0
  const hasStep = Array.isArray(record.steps) && record.steps.length > 0

  return hasTitle && hasIngredient && hasStep
}

// Runs a Gemini extraction call, swallowing any thrown error into `null` so
// the caller can decide whether to retry - a thrown error here (e.g.
// AI_NORMALIZATION_FAILED from a timeout or unparseable JSON) is just
// another kind of extraction failure, not fatal until the retry is also
// exhausted.
async function tryExtract(fn: () => Promise<unknown>): Promise<unknown | null> {
  try {
    return await fn()
  } catch {
    return null
  }
}

// Orchestrates Option A (URL) ingestion per specs/04: validate + fetch the
// URL under SSRF guardrails, clean the HTML into extraction inputs, run a
// minimum-content pre-check, then call Gemini with a primary prompt/model
// and - if that throws or fails a light structural pre-check - retry once
// with a stricter prompt against a further-reduced content chunk. Throws
// AppError('URL_EXTRACTION_FAILED', ...) if neither attempt produces a
// usable candidate.
export async function runUrlIngestionPipeline({
  url,
  geminiClient,
  geminiConfig,
  requestId,
  env,
}: RunUrlIngestionPipelineParams): Promise<RunUrlIngestionPipelineResult> {
  const resolvedEnv = env ?? loadServerEnv({})

  // Steps 1-2: fast-fail on obviously malformed input. fetchWithGuardrails
  // re-validates and re-resolves internally (including on every redirect
  // hop), so this call is a cheap early rejection, not the only guardrail.
  const parsedUrl = validateUrlSyntax(url)

  // Step 3: fetch under SSRF/size/redirect guardrails. durationMs is wall
  // clock from here, per the brief.
  const pipelineStart = Date.now()
  const { html, effectiveUrl } = await fetchWithGuardrails(parsedUrl, {
    timeoutMs: resolvedEnv.URL_FETCH_TIMEOUT_MS,
    maxRedirects: resolvedEnv.URL_MAX_REDIRECTS,
    maxBytes: resolvedEnv.URL_MAX_RESPONSE_BYTES,
  })

  // Step 4: clean HTML into extraction inputs.
  const cleaned = cleanHtmlForExtraction(html, geminiConfig.tokenBudget, effectiveUrl)

  // Step 5: minimum-content pre-check, before any Gemini call.
  if (cleaned.cleanedText.trim().length < MIN_CONTENT_CHARS) {
    throw new AppError(
      'URL_EXTRACTION_FAILED',
      'This page does not contain a recognizable recipe. Try another URL or use manual input.',
      { requestId, url: effectiveUrl },
    )
  }

  // Step 6: primary Gemini call + structural pre-check.
  const primaryPrompt = buildUrlIngestionPrompt({
    url: effectiveUrl,
    cleanedText: cleaned.cleanedText,
    candidateImageUrls: cleaned.candidateImageUrls,
    titleHint: cleaned.titleHint,
  })

  const primaryResult = await tryExtract(() =>
    geminiClient.generateCanonicalRecipe({
      model: geminiConfig.primaryModel,
      prompt: primaryPrompt,
      timeoutMs: geminiConfig.timeoutMs,
    }),
  )

  if (passesStructuralPreCheck(primaryResult)) {
    return {
      recipeCandidate: primaryResult,
      diagnostics: {
        extractor: 'gemini-primary',
        model: geminiConfig.primaryModel,
        durationMs: Date.now() - pipelineStart,
      },
    }
  }

  // Step 7: retry once against a further-reduced content chunk.
  const retryBudget = Math.floor(geminiConfig.tokenBudget / RETRY_TOKEN_BUDGET_DIVISOR)
  const reducedCleaned = cleanHtmlForExtraction(html, retryBudget, effectiveUrl)

  const retryPrompt = buildUrlIngestionRetryPrompt({
    url: effectiveUrl,
    reducedText: reducedCleaned.cleanedText,
    candidateImageUrls: reducedCleaned.candidateImageUrls,
  })

  const retryResult = await tryExtract(() =>
    geminiClient.generateCanonicalRecipe({
      model: geminiConfig.retryModel,
      prompt: retryPrompt,
      timeoutMs: geminiConfig.timeoutMs,
    }),
  )

  if (passesStructuralPreCheck(retryResult)) {
    return {
      recipeCandidate: retryResult,
      diagnostics: {
        extractor: 'gemini-retry',
        model: geminiConfig.retryModel,
        durationMs: Date.now() - pipelineStart,
      },
    }
  }

  // Step 8: both attempts failed.
  throw new AppError('URL_EXTRACTION_FAILED', 'Could not extract a usable recipe from this URL.', {
    requestId,
    url: effectiveUrl,
  })
}
