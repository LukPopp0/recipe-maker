import { access, constants, mkdir } from 'node:fs/promises';
import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { loadServerEnv } from './env.js';
import { loadGeminiConfig } from './services/ai/config.js';
import { GeminiClient } from './services/ai/gemini-client.js';
import { checkIngredientCatalogReady } from './services/ingredient-matching/catalog.js';
import { LocalJsonFileRecipeRepository } from './services/recipes/local-json-file-recipe-repository.js';
import { LocalDiskStorageAdapter } from './services/storage/local-disk-storage-adapter.js';

const env = loadServerEnv(process.env);
const geminiConfig = loadGeminiConfig(process.env);

// DEFAULT_MAIN_IMAGE_URL is optional in env (may be unset); post-processing and
// image re-hosting require a non-empty string, so fall back to a local
// placeholder served from the /images mount when it isn't configured.
const defaultMainImageUrl = env.DEFAULT_MAIN_IMAGE_URL ?? '/images/placeholder-recipe.png';

// Startup storage-readiness check: ensure the recipe data directory exists
// and is writable before we start accepting traffic. Fail fast (exit 1)
// rather than serving requests that will fail on first save.
async function checkStorageReady(): Promise<boolean> {
  try {
    await mkdir(env.RECIPE_DATA_DIR, { recursive: true });
    await access(env.RECIPE_DATA_DIR, constants.W_OK);
    return true;
  } catch (err) {
    console.error(
      JSON.stringify({
        level: 'error',
        message: 'Recipe data directory is not writable',
        recipeDataDir: env.RECIPE_DATA_DIR,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return false;
  }
}

const storageReady = await checkStorageReady();

if (!storageReady) {
  process.exit(1);
}

// Startup ingredient-catalog readiness check: ensure the not-found
// placeholder image is present in the manifest before serving traffic.
if (!checkIngredientCatalogReady()) {
  process.exit(1);
}

const recipeRepository = new LocalJsonFileRecipeRepository(env.RECIPE_DATA_DIR);
const geminiClient = new GeminiClient(geminiConfig);
const storageAdapter = new LocalDiskStorageAdapter(env.IMAGE_DATA_DIR, env.PUBLIC_BASE_URL);

const app = createApp({
  env,
  checkStorageReady,
  recipeRepository,
  geminiClient,
  geminiConfig,
  storageAdapter,
  defaultMainImageUrl,
});

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(
    JSON.stringify({
      level: 'info',
      message: 'Server listening',
      port: info.port,
      nodeEnv: env.NODE_ENV,
      recipeDataDir: env.RECIPE_DATA_DIR,
    }),
  );
});
