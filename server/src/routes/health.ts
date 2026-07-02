import { Hono } from 'hono'
import { ok } from '../lib/response.js'
import type { AppVariables } from '../middleware/request-id.js'

export type HealthDeps = {
  checkStorageReady: () => boolean | Promise<boolean>
}

// GET /health handler, shared by both the bare and /api-prefixed mounts (see
// app.ts) so there is exactly one implementation of the health check.
export function createHealthApp(deps: HealthDeps) {
  const app = new Hono<{ Variables: AppVariables }>()

  app.get('/health', async (c) => {
    const ready = await deps.checkStorageReady()

    return c.json(
      ok(c.get('requestId'), {
        status: 'ok' as const,
        storage: ready ? ('ready' as const) : ('unavailable' as const),
      }),
    )
  })

  return app
}
