import { Hono } from 'hono'
import type { ServerEnv } from './env.js'
import { errorHandler, notFoundHandler } from './middleware/error-handler.js'
import { logger } from './middleware/logger.js'
import { requestId, type AppVariables } from './middleware/request-id.js'
import { createIngestApp } from './routes/ingest.js'
import { createHealthApp } from './routes/health.js'
import { createRecipeApp } from './routes/recipe.js'
import type { RecipeRepository } from './services/recipes/recipe-repository.js'

// Dependencies injected into the app factory.
export type AppDeps = {
  env: ServerEnv
  checkStorageReady: () => boolean | Promise<boolean>
  recipeRepository: RecipeRepository
}

export type App = Hono<{ Variables: AppVariables }>

// Builds the Hono app: requestId -> logger -> routes, with centralized
// error/not-found handling. Health is mounted under both the bare /health
// path (infra probes) and /api/health (spec-03's /api prefix convention),
// both backed by the single handler in routes/health.ts.
export function createApp(deps: AppDeps): App {
  const app: App = new Hono<{ Variables: AppVariables }>()

  app.use('*', requestId)
  app.use('*', logger)

  const healthApp = createHealthApp({ checkStorageReady: deps.checkStorageReady })
  const recipeApp = createRecipeApp({ recipeRepository: deps.recipeRepository })
  const ingestApp = createIngestApp()

  app.route('/', healthApp)
  app.route('/api', healthApp)
  app.route('/api', recipeApp)
  app.route('/api', ingestApp)

  app.onError(errorHandler)
  app.notFound(notFoundHandler)

  return app
}
