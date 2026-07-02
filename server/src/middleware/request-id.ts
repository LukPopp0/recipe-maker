import { randomUUID } from 'node:crypto'
import type { MiddlewareHandler } from 'hono'

const REQUEST_ID_HEADER = 'x-request-id'

// Shared Hono context variables for this app: every route/middleware sees a
// requestId once this middleware has run.
export type AppVariables = {
  requestId: string
}

// Reads the inbound x-request-id header (so callers/proxies can correlate
// their own trace id), or generates a fresh one via randomUUID(). Stores it
// on the Hono context and echoes it back on the response header.
export const requestId: MiddlewareHandler<{ Variables: AppVariables }> = async (c, next) => {
  const id = c.req.header(REQUEST_ID_HEADER) || randomUUID()

  c.set('requestId', id)
  c.header(REQUEST_ID_HEADER, id)

  await next()
}
