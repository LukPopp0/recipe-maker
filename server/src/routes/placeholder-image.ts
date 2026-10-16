import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { App } from '../app.js';

export const PLACEHOLDER_RECIPE_IMAGE_URL = '/images/placeholder-recipe.png';

// Served from the repo (server/assets), not from IMAGE_DATA_DIR: the images
// volume is empty on first start and holds user data only (deployment spec
// section 1, data volumes). Registered before the /images/* volume mount so a
// same-named file there never shadows it. Resolved relative to this module so
// it works regardless of the process working directory.
const PLACEHOLDER_PATH = fileURLToPath(new URL('../../assets/placeholder-recipe.png', import.meta.url));

export function mountPlaceholderImage(app: App): void {
  const png = readFileSync(PLACEHOLDER_PATH);
  app.get(PLACEHOLDER_RECIPE_IMAGE_URL, (c) =>
    c.body(png, 200, {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=86400',
    }),
  );
}
