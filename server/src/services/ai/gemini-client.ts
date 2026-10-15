import { GoogleGenAI, type Models } from '@google/genai';
import { AppError } from '../../lib/errors.js';
import type { GeminiConfig } from './config.js';

// Minimal slice of the @google/genai SDK surface this client depends on.
// Using Pick against the real Models type keeps the injected fake's method
// signature honest while letting tests supply a plain object (no network).
export interface GeminiSdkClient {
  models: Pick<Models, 'generateContent'>
}

export interface GenerateCanonicalRecipeParams {
  model: string
  prompt: string
  timeoutMs: number
  // JSON Schema the response must follow (structured output, see
  // output-schemas.ts). Omitted: the model is only asked for JSON.
  responseJsonSchema?: Record<string, unknown>
}

// The @google/genai SDK's ApiError.message is often a raw JSON blob (the full
// Google API error response, including retry/quota metadata). Pull out just
// the human-readable `error.message` field so callers don't dump the whole
// blob into `cause`; falls back to the raw message when it isn't that shape.
function extractCause(message: string): string {
  try {
    const parsed = JSON.parse(message) as { error?: { message?: unknown } };
    return typeof parsed.error?.message === 'string' ? parsed.error.message : message;
  } catch {
    return message;
  }
}

export const QUOTA_MESSAGE = 'Gemini daily quota reached. It resets at midnight Pacific time.';

// Gemini reports an exhausted quota as HTTP 429 with status
// RESOURCE_EXHAUSTED. The SDK error carries it as a numeric `status` and/or
// as the JSON error body in `message`; only those structured fields count,
// never a "429" somewhere in free text.
export function isQuotaError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  if ((err as { status?: unknown }).status === 429) return true;
  const message = (err as { message?: unknown }).message;
  if (typeof message !== 'string') return false;
  try {
    const parsed = JSON.parse(message) as { error?: { code?: unknown; status?: unknown } };
    return parsed.error?.code === 429 || parsed.error?.status === 'RESOURCE_EXHAUSTED';
  } catch {
    return false;
  }
}

// Wraps the @google/genai SDK for the one call this app needs: send a prompt,
// get back parsed JSON. Deterministic generationConfig (temperature/topP/topK)
// comes from GeminiConfig so callers never need to think about it per-call.
export class GeminiClient {
  private readonly sdkClient: GeminiSdkClient;
  private readonly generationConfig: GeminiConfig['generationConfig'];

  constructor(config: GeminiConfig, sdkClient?: GeminiSdkClient) {
    this.generationConfig = config.generationConfig;
    this.sdkClient = sdkClient ?? new GoogleGenAI({ apiKey: config.geminiApiKey });
  }

  async generateCanonicalRecipe({ model, prompt, timeoutMs, responseJsonSchema }: GenerateCanonicalRecipeParams): Promise<unknown> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;

    const timedOut = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(
          new AppError('AI_NORMALIZATION_FAILED', `Gemini request timed out after ${timeoutMs}ms.`, {
            model,
            timeoutMs,
          }),
        );
      }, timeoutMs);
    });

    let response: { text?: string };
    try {
      response = await Promise.race([
        this.sdkClient.models.generateContent({
          model,
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
            ...(responseJsonSchema ? { responseJsonSchema } : {}),
            temperature: this.generationConfig.temperature,
            topP: this.generationConfig.topP,
            topK: this.generationConfig.topK,
            abortSignal: controller.signal,
          },
        }),
        timedOut,
      ]);
    } catch (err) {
      if (err instanceof AppError) throw err;
      if (isQuotaError(err)) {
        throw new AppError('AI_QUOTA_EXCEEDED', QUOTA_MESSAGE, {
          model,
          cause: err instanceof Error ? extractCause(err.message) : String(err),
        });
      }
      // Covers non-2xx responses (SDK throws ApiError) and any other transport failure.
      throw new AppError('AI_NORMALIZATION_FAILED', 'Gemini request failed.', {
        model,
        cause: err instanceof Error ? extractCause(err.message) : String(err),
      });
    } finally {
      clearTimeout(timer!);
    }

    const text = response.text;
    if (typeof text !== 'string' || text.length === 0) {
      throw new AppError('AI_NORMALIZATION_FAILED', 'Gemini returned an empty response.', { model });
    }

    try {
      return JSON.parse(text);
    } catch {
      throw new AppError('AI_NORMALIZATION_FAILED', 'Gemini returned unparseable JSON.', { model, rawText: text });
    }
  }
}
