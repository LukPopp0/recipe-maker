import { Hono } from 'hono'
import { AppError } from '../lib/errors.js'
import type { AppVariables } from '../middleware/request-id.js'

// Ingestion route stubs, registered now so the route surface matches
// specs/03 even though the real pipelines aren't built yet: URL ingestion
// lands in Phase 2, manual (text+images) ingestion lands in Phase 3.
export function createIngestApp() {
  const app = new Hono<{ Variables: AppVariables }>()

  app.post('/ingest/url', () => {
    throw new AppError('NOT_IMPLEMENTED', 'URL ingestion is not implemented yet (lands in Phase 2).')
  })

  app.post('/ingest/manual', () => {
    throw new AppError('NOT_IMPLEMENTED', 'Manual ingestion is not implemented yet (lands in Phase 3).')
  })

  return app
}
