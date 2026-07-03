import type { MiddlewareHandler } from 'hono';
import type { AppVariables } from './request-id.js';

// Emits one structured JSON log line per request, after the handler settles,
// with enough fields to correlate a request across logs (requestId) and
// monitor basic health (method, path, status, durationMs).
export const logger: MiddlewareHandler<{ Variables: AppVariables }> = async (c, next) => {
  const start = performance.now();

  try {
    await next();
  } finally {
    const durationMs = Math.round(performance.now() - start);

    console.log(
      JSON.stringify({
        requestId: c.get('requestId'),
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        durationMs,
      }),
    );
  }
};
