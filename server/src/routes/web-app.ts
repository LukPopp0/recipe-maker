import { readFileSync } from 'node:fs';
import path from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import type { App } from '../app.js';

// Paths that belong to the API or image mounts; a miss there must stay a
// 404, never turn into the web app.
const NON_APP_PREFIXES = ['/api/', '/images/', '/ingredient-images/'];

// Serves the built React app from distDir (deployment spec section 1): real
// files first, then index.html for any other GET so a reload on a client
// view still loads the app. Registered after all API routes.
export function mountWebApp(app: App, distDir: string): void {
  const indexHtml = readFileSync(path.join(distDir, 'index.html'), 'utf-8');

  app.use('/*', serveStatic({ root: distDir }));
  app.get('*', (c) => {
    if (NON_APP_PREFIXES.some((prefix) => c.req.path.startsWith(prefix)) || c.req.path === '/health') {
      return c.notFound();
    }
    return c.html(indexHtml);
  });
}
