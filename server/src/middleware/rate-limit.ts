import type { MiddlewareHandler } from 'hono';
import { AppError } from '../lib/errors.js';
import type { AppVariables } from './request-id.js';

// Fixed-window in-memory rate limiter. Single-user, local-first (per CLAUDE.md):
// x-forwarded-for only matters if this ever sits behind a proxy, so absent
// that header every caller shares the 'local' bucket.
export function createRateLimiter(opts: {
  max: number
  windowMs: number
  now?: () => number
}): MiddlewareHandler<{ Variables: AppVariables }> {
  const { max, windowMs, now = Date.now } = opts;
  const buckets = new Map<string, { count: number; windowStart: number }>();

  return async (c, next) => {
    const forwardedFor = c.req.header('x-forwarded-for');
    const key = forwardedFor ? forwardedFor.split(',')[0].trim() : 'local';

    const current = now();
    const bucket = buckets.get(key);

    if (!bucket || current - bucket.windowStart >= windowMs) {
      buckets.set(key, { count: 1, windowStart: current });
      await next();
      return;
    }

    if (bucket.count >= max) {
      const retryAfterMs = windowMs - (current - bucket.windowStart);
      throw new AppError('RATE_LIMITED', 'Too many ingestion requests. Wait a moment and try again.', { retryAfterMs });
    }

    bucket.count += 1;
    await next();
  };
}
