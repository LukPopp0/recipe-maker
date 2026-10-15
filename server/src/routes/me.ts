import { Hono } from 'hono';
import { ok } from '../lib/response.js';
import type { AppVariables } from '../middleware/request-id.js';

// GET /me: the caller as resolved by the auth middleware.
export function createMeApp() {
  const app = new Hono<{ Variables: AppVariables }>();

  app.get('/me', (c) => c.json(ok(c.get('requestId'), { user: c.get('user') })));

  return app;
}
