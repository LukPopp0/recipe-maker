import { z } from 'zod'

// Schema for environment variables, with defaults and validation per specs/11.
// Deterministic generationConfig ensures reproducible outputs.
const geminiConfigSchema = z.object({
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_PRIMARY_MODEL: z.string().default('gemini-2.5-pro'),
  GEMINI_RETRY_MODEL: z.string().default('gemini-2.5-flash'),
  GEMINI_TIMEOUT_MS: z.coerce.number().default(20000),
  GEMINI_TOKEN_BUDGET: z.coerce.number().default(8000),
  GEMINI_MAX_RETRIES: z.coerce.number().min(0).max(3).default(1),
})

export type GeminiConfig = {
  geminiApiKey?: string
  primaryModel: string
  retryModel: string
  timeoutMs: number
  tokenBudget: number
  maxRetries: number
  generationConfig: {
    temperature: number
    topP: number
    topK: number
  }
}

export function loadGeminiConfig(env: Record<string, string | undefined>): GeminiConfig {
  const parsed = geminiConfigSchema.parse(env)

  return {
    geminiApiKey: parsed.GEMINI_API_KEY,
    primaryModel: parsed.GEMINI_PRIMARY_MODEL,
    retryModel: parsed.GEMINI_RETRY_MODEL,
    timeoutMs: parsed.GEMINI_TIMEOUT_MS,
    tokenBudget: parsed.GEMINI_TOKEN_BUDGET,
    maxRetries: parsed.GEMINI_MAX_RETRIES,
    generationConfig: {
      temperature: 0,
      topP: 1,
      topK: 1,
    },
  }
}
