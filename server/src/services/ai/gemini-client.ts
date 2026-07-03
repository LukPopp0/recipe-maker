import { GoogleGenAI, type Models } from '@google/genai'
import { AppError } from '../../lib/errors.js'
import type { GeminiConfig } from './config.js'

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
}

// Wraps the @google/genai SDK for the one call this app needs: send a prompt,
// get back parsed JSON. Deterministic generationConfig (temperature/topP/topK)
// comes from GeminiConfig so callers never need to think about it per-call.
export class GeminiClient {
  private readonly sdkClient: GeminiSdkClient
  private readonly generationConfig: GeminiConfig['generationConfig']

  constructor(config: GeminiConfig, sdkClient?: GeminiSdkClient) {
    this.generationConfig = config.generationConfig
    this.sdkClient = sdkClient ?? new GoogleGenAI({ apiKey: config.geminiApiKey })
  }

  async generateCanonicalRecipe({ model, prompt, timeoutMs }: GenerateCanonicalRecipeParams): Promise<unknown> {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>

    const timedOut = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort()
        reject(
          new AppError('AI_NORMALIZATION_FAILED', `Gemini request timed out after ${timeoutMs}ms.`, {
            model,
            timeoutMs,
          }),
        )
      }, timeoutMs)
    })

    let response: { text?: string }
    try {
      response = await Promise.race([
        this.sdkClient.models.generateContent({
          model,
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
            temperature: this.generationConfig.temperature,
            topP: this.generationConfig.topP,
            topK: this.generationConfig.topK,
            abortSignal: controller.signal,
          },
        }),
        timedOut,
      ])
    } catch (err) {
      if (err instanceof AppError) throw err
      // Covers non-2xx responses (SDK throws ApiError) and any other transport failure.
      throw new AppError('AI_NORMALIZATION_FAILED', 'Gemini request failed.', {
        model,
        cause: err instanceof Error ? err.message : String(err),
      })
    } finally {
      clearTimeout(timer!)
    }

    const text = response.text
    if (typeof text !== 'string' || text.length === 0) {
      throw new AppError('AI_NORMALIZATION_FAILED', 'Gemini returned an empty response.', { model })
    }

    try {
      return JSON.parse(text)
    } catch {
      throw new AppError('AI_NORMALIZATION_FAILED', 'Gemini returned unparseable JSON.', { model, rawText: text })
    }
  }
}
