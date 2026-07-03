import { loadGeminiConfig } from '../services/ai/config.js'
import type { GeminiClient } from '../services/ai/gemini-client.js'
import type { StorageAdapter } from '../services/storage/storage-adapter.js'

// Minimal fake ingest dependencies for tests that build an app via createApp
// but never exercise the /ingest/url pipeline (health, logging, recipe CRUD,
// static image serving). ingest.test.ts supplies its own real deps instead.
export function makeIngestDeps(): {
  geminiClient: GeminiClient
  geminiConfig: ReturnType<typeof loadGeminiConfig>
  storageAdapter: StorageAdapter
  defaultMainImageUrl: string
} {
  const storageAdapter: StorageAdapter = {
    put: async () => {
      throw new Error('storageAdapter.put should not be called in this test')
    },
    get: async () => {
      throw new Error('storageAdapter.get should not be called in this test')
    },
    delete: async () => {},
  }

  const geminiClient = {
    generateCanonicalRecipe: async () => {
      throw new Error('geminiClient.generateCanonicalRecipe should not be called in this test')
    },
  } as unknown as GeminiClient

  return {
    geminiClient,
    geminiConfig: loadGeminiConfig({}),
    storageAdapter,
    defaultMainImageUrl: '/images/placeholder-recipe.png',
  }
}
