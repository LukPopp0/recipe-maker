import { Hono } from 'hono';
import { ok } from '../lib/response.js';
import type { AppVariables } from '../middleware/request-id.js';

// GET /me: the caller as resolved by the auth middleware, plus the
// default recipe placeholder URL the client uses to detect an unset main image.
export function createMeApp(deps: { placeholderImageUrl: string }) {
  const app = new Hono<{ Variables: AppVariables }>();

  app.get('/me', (c) => c.json(ok(c.get('requestId'), { user: c.get('user'), placeholderImageUrl: deps.placeholderImageUrl })));

  return app;
}
