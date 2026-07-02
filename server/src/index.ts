import { access, constants, mkdir } from 'node:fs/promises'
import { serve } from '@hono/node-server'
import { createApp } from './app.js'
import { loadServerEnv } from './env.js'
import { LocalJsonFileRecipeRepository } from './services/recipes/local-json-file-recipe-repository.js'

const env = loadServerEnv(process.env)

// Startup storage-readiness check: ensure the recipe data directory exists
// and is writable before we start accepting traffic. Fail fast (exit 1)
// rather than serving requests that will fail on first save.
async function checkStorageReady(): Promise<boolean> {
  try {
    await mkdir(env.RECIPE_DATA_DIR, { recursive: true })
    await access(env.RECIPE_DATA_DIR, constants.W_OK)
    return true
  } catch (err) {
    console.error(
      JSON.stringify({
        level: 'error',
        message: 'Recipe data directory is not writable',
        recipeDataDir: env.RECIPE_DATA_DIR,
        error: err instanceof Error ? err.message : String(err),
      }),
    )
    return false
  }
}

const storageReady = await checkStorageReady()

if (!storageReady) {
  process.exit(1)
}

const recipeRepository = new LocalJsonFileRecipeRepository(env.RECIPE_DATA_DIR)

const app = createApp({
  env,
  checkStorageReady,
  recipeRepository,
})

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(
    JSON.stringify({
      level: 'info',
      message: 'Server listening',
      port: info.port,
      nodeEnv: env.NODE_ENV,
      recipeDataDir: env.RECIPE_DATA_DIR,
    }),
  )
})
