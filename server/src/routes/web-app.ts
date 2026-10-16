import { readFileSync } from 'node:fs';
import path from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import type { App } from '../app.js';

// Paths that belong to the API, the image mounts or the health probe; a miss
// there (the bare path or anything below it) must stay a 404, never turn into
// the web app.
const NON_APP_PREFIXES = ['/api', '/images', '/ingredient-images', '/health'];

// A miss for a built asset or any other file (a last path segment with an
// extension) is a 404 too: answering a stale /assets/index-<hash>.js with
// index.html would only fail later as a MIME-type error in the browser.
function isNonAppPath(requestPath: string): boolean {
  if (NON_APP_PREFIXES.some((prefix) => requestPath === prefix || requestPath.startsWith(`${prefix}/`))) {
    return true;
  }
  return requestPath.startsWith('/assets/') || /\.[^/]+$/.test(requestPath);
}

// Serves the built React app from distDir (deployment spec section 1): real
// files first, then index.html for any other GET so a reload on a client
// view still loads the app. Registered after all API routes.
export function mountWebApp(app: App, distDir: string): void {
  const indexHtml = readFileSync(path.join(distDir, 'index.html'), 'utf-8');

  // index.html must be revalidated so a browser never keeps a stale copy that
  // points at bundles an image update removed; hashed assets keep default caching.
  // serveStatic's onFound hook runs after its response is built, so the header
  // is set here on the finished response instead.
  app.use('/*', async (c, next) => {
    await next();
    if (c.res.headers.get('Content-Type')?.startsWith('text/html')) {
      c.res.headers.set('Cache-Control', 'no-cache');
    }
  });
  app.use('/*', serveStatic({ root: distDir }));
  app.get('*', (c) => {
    if (isNonAppPath(c.req.path)) {
      return c.notFound();
    }
    return c.html(indexHtml);
  });
}
