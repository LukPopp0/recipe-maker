import type { Context, ErrorHandler, NotFoundHandler } from 'hono';
import { AppError } from '../lib/errors.js';
import { fail } from '../lib/response.js';
import type { AppVariables } from './request-id.js';

// Hono onError handler: collapses any thrown value (AppError or otherwise)
// into the standard { ok: false, requestId, error } envelope, via fail().
export const errorHandler: ErrorHandler<{ Variables: AppVariables }> = (err, c) => {
  const { envelope, status } = fail(c.get('requestId'), err);

  return c.json(envelope, status as never);
};

// Hono notFound handler: unmatched routes get the same structured error
// envelope shape as any other error, and the same code->status derivation
// (via fail()/ERROR_STATUS_MAP), so ROUTE_NOT_FOUND is the single source of
// truth for its 404 status rather than a hardcoded literal here.
export const notFoundHandler: NotFoundHandler<{ Variables: AppVariables }> = (c: Context<{ Variables: AppVariables }>) => {
  const err = new AppError('ROUTE_NOT_FOUND', `No route matches ${c.req.method} ${c.req.path}`);
  const { envelope, status } = fail(c.get('requestId'), err);

  return c.json(envelope, status as never);
};
