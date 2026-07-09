import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { errorHandler } from './error-handler.js';
import { createRateLimiter } from './rate-limit.js';
import type { AppVariables } from './request-id.js';

// Bare Hono app with the limiter mounted ahead of a dummy route, plus the
// real errorHandler so a thrown AppError produces the standard envelope.
function makeApp(opts: { max: number; windowMs: number; now?: () => number }) {
  const app = new Hono<{ Variables: AppVariables }>();

  app.use('*', async (c, next) => {
    c.set('requestId', 'test-request-id');
    await next();
  });
  app.use('*', createRateLimiter(opts));
  app.get('/ping', (c) => c.json({ ok: true }));
  app.onError(errorHandler);

  return app;
}

describe('createRateLimiter', () => {
  it('allows up to max requests then 429s the next one', async () => {
    const app = makeApp({ max: 2, windowMs: 60000 });

    const first = await app.request('/ping');
    const second = await app.request('/ping');
    const third = await app.request('/ping');

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(third.status).toBe(429);

    const body = (await third.json()) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('RATE_LIMITED');
  });

  it('resets the count once the window rolls over', async () => {
    let now = 0;
    const app = makeApp({ max: 1, windowMs: 1000, now: () => now });

    const first = await app.request('/ping');
    expect(first.status).toBe(200);

    const second = await app.request('/ping');
    expect(second.status).toBe(429);

    now += 1000;

    const third = await app.request('/ping');
    expect(third.status).toBe(200);
  });

  it('tracks distinct x-forwarded-for values independently', async () => {
    const app = makeApp({ max: 1, windowMs: 60000 });

    const clientA1 = await app.request('/ping', { headers: { 'x-forwarded-for': '1.1.1.1' } });
    const clientA2 = await app.request('/ping', { headers: { 'x-forwarded-for': '1.1.1.1' } });
    const clientB1 = await app.request('/ping', { headers: { 'x-forwarded-for': '2.2.2.2' } });

    expect(clientA1.status).toBe(200);
    expect(clientA2.status).toBe(429);
    expect(clientB1.status).toBe(200);
  });
});
