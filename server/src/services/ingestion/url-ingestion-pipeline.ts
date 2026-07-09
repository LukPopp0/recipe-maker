import { AppError } from '../../lib/errors.js';
import { loadServerEnv, type ServerEnv } from '../../env.js';
import { logStage } from '../../lib/log.js';
import type { GeminiConfig } from '../ai/config.js';
import type { GenerateCanonicalRecipeParams } from '../ai/gemini-client.js';
import { buildUrlIngestionPrompt, buildUrlIngestionRetryPrompt } from '../ai/prompts/url-ingestion.js';
import { defaultBrowserHtmlFetcher, type BrowserHtmlFetcher } from '../url-ingestion/browser-fetcher.js';
import { cleanHtmlForExtraction, type CleanedHtml } from '../url-ingestion/html-cleaner.js';
import { fetchWithGuardrails, validateUrlSyntax } from '../url-ingestion/url-security.js';

// Minimal slice of GeminiClient this pipeline depends on, so tests can inject
// a fake without touching the real @google/genai SDK.
export interface GeminiCanonicalRecipeGenerator {
  generateCanonicalRecipe(params: GenerateCanonicalRecipeParams): Promise<unknown>
}

export type UrlIngestionExtractor = 'gemini-primary' | 'gemini-retry'
export type UrlIngestionFetchMode = 'static' | 'browser'

export interface RunUrlIngestionPipelineParams {
  url: string
  geminiClient: GeminiCanonicalRecipeGenerator
  geminiConfig: GeminiConfig
  requestId: string
  // Fetch guardrail config (timeout/redirects/size) plus browser-fallback
  // config. Optional so callers that already have a loaded ServerEnv can pass
  // it straight through (the ingest route); defaults to loadServerEnv({})'s
  // values otherwise.
  env?: Pick<
    ServerEnv,
    | 'URL_FETCH_TIMEOUT_MS'
    | 'URL_MAX_REDIRECTS'
    | 'URL_MAX_RESPONSE_BYTES'
    | 'BROWSER_FALLBACK_ENABLED'
    | 'BROWSER_FETCH_TIMEOUT_MS'
  >
  // Injectable headless-browser fetcher so tests never launch Chromium.
  browserFetcher?: BrowserHtmlFetcher
}

export interface RunUrlIngestionPipelineResult {
  recipeCandidate: unknown
  diagnostics: {
    extractor: UrlIngestionExtractor
    model: string
    durationMs: number
    fetchMode: UrlIngestionFetchMode
    usedJsonLd: boolean
  }
}

// Below this many characters of cleaned visible text, a page is treated as
// not containing a recognizable recipe - not worth spending a Gemini call on.
// Heuristic per specs/04's "missing minimum required content" failure
// condition, not a precise measurement.
const MIN_CONTENT_CHARS = 40;

// Below this many characters of cleaned visible text - when the page also has
// no JSON-LD - the static HTML is assumed to be a client-side-rendered shell
// and the headless-browser fallback is attempted. Deliberately much higher
// than MIN_CONTENT_CHARS: a real recipe page's visible text (ingredients +
// steps alone) comfortably exceeds this.
const BROWSER_FALLBACK_MIN_CHARS = 500;

// The retry attempt uses a smaller content budget than the primary attempt,
// on the theory that a smaller/more focused chunk is easier for the retry
// model to extract structure from cleanly.
const RETRY_TOKEN_BUDGET_DIVISOR = 2;

// Light structural pre-check on a raw Gemini JSON response: non-empty title,
// at least one ingredient, at least one step. This is NOT full Zod
// validation (that's post-processing's job) - just enough to decide whether
// the primary attempt is worth accepting or should fall back to the retry
// prompt.
function passesStructuralPreCheck(candidate: unknown): boolean {
  if (typeof candidate !== 'object' || candidate === null) return false;
  const record = candidate as Record<string, unknown>;

  const hasTitle = typeof record.title === 'string' && record.title.trim().length > 0;
  const hasIngredient = Array.isArray(record.ingredients) && record.ingredients.length > 0;
  const hasStep = Array.isArray(record.steps) && record.steps.length > 0;

  return hasTitle && hasIngredient && hasStep;
}

// Runs a Gemini extraction call, swallowing any thrown error into `null` so
// the caller can decide whether to retry - a thrown error here (e.g.
// AI_NORMALIZATION_FAILED from a timeout or unparseable JSON) is just
// another kind of extraction failure, not fatal until the retry is also
// exhausted.
async function tryExtract(fn: () => Promise<unknown>): Promise<unknown | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

// Orchestrates Option A (URL) ingestion per specs/04 with a tiered fetch
// strategy:
//   1. Static fetch under SSRF guardrails (fast path).
//   2. If the page embeds schema.org Recipe JSON-LD, extraction proceeds on
//      the static HTML immediately - JSON-LD is present in the initial HTML
//      even on client-side-rendered sites and is the best extraction input.
//   3. If there is no JSON-LD and the visible text is too thin to be a real
//      recipe page, the page is re-fetched with a headless browser (full JS
//      execution) and re-cleaned; the richer of the two results wins.
// The Gemini flow is unchanged: primary prompt/model, then - if that throws
// or fails a light structural pre-check - one retry with a stricter prompt
// against a further-reduced content chunk. Throws
// AppError('URL_EXTRACTION_FAILED', ...) if neither attempt produces a
// usable candidate.
export async function runUrlIngestionPipeline({
  url,
  geminiClient,
  geminiConfig,
  requestId,
  env,
  browserFetcher = defaultBrowserHtmlFetcher,
}: RunUrlIngestionPipelineParams): Promise<RunUrlIngestionPipelineResult> {
  const resolvedEnv = env ?? loadServerEnv({});

  // Fast-fail on obviously malformed input. fetchWithGuardrails re-validates
  // and re-resolves internally (including on every redirect hop), so this
  // call is a cheap early rejection, not the only guardrail.
  const parsedUrl = validateUrlSyntax(url);

  // Static fetch under SSRF/size/redirect guardrails. durationMs is wall
  // clock from here.
  const pipelineStart = Date.now();
  const staticFetch = await fetchWithGuardrails(parsedUrl, {
    timeoutMs: resolvedEnv.URL_FETCH_TIMEOUT_MS,
    maxRedirects: resolvedEnv.URL_MAX_REDIRECTS,
    maxBytes: resolvedEnv.URL_MAX_RESPONSE_BYTES,
  });

  let activeHtml = staticFetch.html;
  let effectiveUrl = staticFetch.effectiveUrl;
  let fetchMode: UrlIngestionFetchMode = 'static';
  let cleaned = cleanHtmlForExtraction(activeHtml, geminiConfig.tokenBudget, effectiveUrl);

  // Browser fallback: only when the static HTML has neither JSON-LD nor
  // enough visible text to plausibly be a recipe page (client-side-rendered
  // shell). A page with JSON-LD never needs rendering.
  const looksLikeJsShell =
    !cleaned.recipeJsonLd && cleaned.cleanedText.trim().length < BROWSER_FALLBACK_MIN_CHARS;

  if (looksLikeJsShell && resolvedEnv.BROWSER_FALLBACK_ENABLED) {
    const rendered = await browserFetcher.fetchWithBrowser(parsedUrl, {
      timeoutMs: resolvedEnv.BROWSER_FETCH_TIMEOUT_MS,
      maxBytes: resolvedEnv.URL_MAX_RESPONSE_BYTES,
    });
    const renderedCleaned = cleanHtmlForExtraction(
      rendered.html,
      geminiConfig.tokenBudget,
      rendered.effectiveUrl,
    );

    // Take the rendered result only when it is actually richer: it surfaced
    // JSON-LD, or it produced more visible text than the static shell.
    const isRicher =
      renderedCleaned.recipeJsonLd !== null ||
      renderedCleaned.cleanedText.length > cleaned.cleanedText.length;
    if (isRicher) {
      activeHtml = rendered.html;
      effectiveUrl = rendered.effectiveUrl;
      cleaned = renderedCleaned;
      fetchMode = 'browser';
    }
  }

  // Minimum-content pre-check, before any Gemini call. JSON-LD alone is
  // sufficient content even when visible text is thin.
  if (!cleaned.recipeJsonLd && cleaned.cleanedText.trim().length < MIN_CONTENT_CHARS) {
    // Logged as stage 'fetch' since no extraction attempt has happened yet.
    logStage({
      requestId,
      stage: 'fetch',
      durationMs: Date.now() - pipelineStart,
      outcome: 'error',
      errorCode: 'URL_EXTRACTION_FAILED',
    });
    throw new AppError(
      'URL_EXTRACTION_FAILED',
      'This page does not contain a recognizable recipe. Try another URL or use manual input.',
      { requestId, url: effectiveUrl },
    );
  }

  const usedJsonLd = cleaned.recipeJsonLd !== null;

  logStage({
    requestId,
    stage: 'fetch',
    durationMs: Date.now() - pipelineStart,
    outcome: 'ok',
    fetchMode,
    usedJsonLd,
  });

  const extractStart = Date.now();

  // Primary Gemini call + structural pre-check.
  const primaryPrompt = buildUrlIngestionPrompt({
    url: effectiveUrl,
    cleanedText: cleaned.cleanedText,
    candidateImageUrls: cleaned.candidateImageUrls,
    titleHint: cleaned.titleHint,
    recipeJsonLd: cleaned.recipeJsonLd,
  });

  const primaryResult = await tryExtract(() =>
    geminiClient.generateCanonicalRecipe({
      model: geminiConfig.primaryModel,
      prompt: primaryPrompt,
      timeoutMs: geminiConfig.timeoutMs,
    }),
  );

  if (passesStructuralPreCheck(primaryResult)) {
    logStage({
      requestId,
      stage: 'extract',
      durationMs: Date.now() - extractStart,
      outcome: 'ok',
      extractor: 'gemini-primary',
      model: geminiConfig.primaryModel,
    });
    return {
      recipeCandidate: primaryResult,
      diagnostics: {
        extractor: 'gemini-primary',
        model: geminiConfig.primaryModel,
        durationMs: Date.now() - pipelineStart,
        fetchMode,
        usedJsonLd,
      },
    };
  }

  // Retry once against a further-reduced content chunk.
  const retryBudget = Math.floor(geminiConfig.tokenBudget / RETRY_TOKEN_BUDGET_DIVISOR);
  const reducedCleaned: CleanedHtml = cleanHtmlForExtraction(activeHtml, retryBudget, effectiveUrl);

  const retryPrompt = buildUrlIngestionRetryPrompt({
    url: effectiveUrl,
    reducedText: reducedCleaned.cleanedText,
    candidateImageUrls: reducedCleaned.candidateImageUrls,
    recipeJsonLd: reducedCleaned.recipeJsonLd,
  });

  const retryResult = await tryExtract(() =>
    geminiClient.generateCanonicalRecipe({
      model: geminiConfig.retryModel,
      prompt: retryPrompt,
      timeoutMs: geminiConfig.timeoutMs,
    }),
  );

  if (passesStructuralPreCheck(retryResult)) {
    logStage({
      requestId,
      stage: 'extract',
      durationMs: Date.now() - extractStart,
      outcome: 'ok',
      extractor: 'gemini-retry',
      model: geminiConfig.retryModel,
    });
    return {
      recipeCandidate: retryResult,
      diagnostics: {
        extractor: 'gemini-retry',
        model: geminiConfig.retryModel,
        durationMs: Date.now() - pipelineStart,
        fetchMode,
        usedJsonLd,
      },
    };
  }

  // Both attempts failed.
  logStage({
    requestId,
    stage: 'extract',
    durationMs: Date.now() - extractStart,
    outcome: 'error',
    errorCode: 'URL_EXTRACTION_FAILED',
  });
  throw new AppError('URL_EXTRACTION_FAILED', 'Could not extract a usable recipe from this URL.', {
    requestId,
    url: effectiveUrl,
  });
}
