import { Hono } from 'hono';
import type { UnusedImage } from 'shared';
import { z } from 'zod';
import { AppError } from '../lib/errors.js';
import { ok } from '../lib/response.js';
import type { AppVariables } from '../middleware/request-id.js';
import { parseJson } from '../middleware/validate.js';
import { findUnusedImages } from '../services/images/unused-images.js';
import type { RecipeRepository } from '../services/recipes/recipe-repository.js';
import type { StorageAdapter } from '../services/storage/storage-adapter.js';

export type AdminDeps = {
  recipeRepository: RecipeRepository
  storageAdapter: StorageAdapter
  publicBaseUrl: string
  now?: () => Date
}

const DeleteImagesSchema = z.object({ keys: z.array(z.string()).min(1).max(500) });

// Admin-only image cleanup (deployment spec section 8). Deletion re-derives
// the unused set server-side, so a client can never delete an image a
// recipe still uses or anything outside recipes/.
export function createAdminApp(deps: AdminDeps) {
  const app = new Hono<{ Variables: AppVariables }>();
  const { recipeRepository, storageAdapter, publicBaseUrl, now = () => new Date() } = deps;

  app.use('/admin/*', async (c, next) => {
    if (!c.get('user').isAdmin) {
      throw new AppError('FORBIDDEN', 'Only an admin can manage stored images.');
    }
    await next();
  });

  async function currentUnused() {
    return findUnusedImages({
      objects: await storageAdapter.list('recipes/'),
      recipes: await recipeRepository.getAll(),
      publicBaseUrl,
      now: now(),
    });
  }

  app.get('/admin/images/unused', async (c) => {
    const images: UnusedImage[] = (await currentUnused()).map((object) => ({
      key: object.key,
      url: `${publicBaseUrl}/images/${object.key}`,
      sizeBytes: object.sizeBytes,
      modifiedAt: object.modifiedAt.toISOString(),
    }));
    return c.json(ok(c.get('requestId'), { images }));
  });

  app.post('/admin/images/delete', async (c) => {
    const parsed = DeleteImagesSchema.safeParse(await parseJson(c));
    if (!parsed.success) {
      throw new AppError('INVALID_INPUT', 'keys must be a list of 1 to 500 image keys.');
    }

    const unused = new Set((await currentUnused()).map((object) => object.key));
    let deleted = 0;
    for (const key of new Set(parsed.data.keys)) {
      if (!unused.has(key)) continue;
      await storageAdapter.delete(key);
      deleted += 1;
    }
    return c.json(ok(c.get('requestId'), { deleted }));
  });

  return app;
}
