import type { MiddlewareHandler } from 'hono';
import type { CurrentUser } from 'shared';
import { AppError } from '../lib/errors.js';
import type { AppVariables } from './request-id.js';

export const LOCAL_USER: CurrentUser = { username: 'local', isAdmin: true };

const REMOTE_USER_HEADER = 'remote-user';

// Paths under /api that answer without a user (Docker health checks).
const PUBLIC_API_PATHS = new Set(['/api/health']);

export interface AuthMiddlewareOptions {
  mode: 'none' | 'header'
  adminUsers: string[]
}

// Resolves the caller for every /api/* request. In header mode the
// Remote-User header is trusted as-is: login happens in tinyauth and nginx
// overwrites the header on every request, so it is only safe when the app
// port is not reachable except through that proxy (deployment spec 1-2).
export function createAuthMiddleware({ mode, adminUsers }: AuthMiddlewareOptions): MiddlewareHandler<{ Variables: AppVariables }> {
  const admins = new Set(adminUsers);

  return async (c, next) => {
    if (mode === 'none') {
      c.set('user', LOCAL_USER);
      return next();
    }

    if (PUBLIC_API_PATHS.has(c.req.path)) {
      return next();
    }

    const username = (c.req.header(REMOTE_USER_HEADER) ?? '').trim().toLowerCase();
    if (username.length === 0) {
      throw new AppError('UNAUTHENTICATED', 'You are not logged in.');
    }

    c.set('user', { username, isAdmin: admins.has(username) });
    return next();
  };
}
