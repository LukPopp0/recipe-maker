import { Hono } from 'hono';
import { z } from 'zod';
import { CanonicalRecipeSchema, RecipeIdSchema, SaveRecipeRequestSchema } from 'shared';
import { AppError } from '../lib/errors.js';
import { ok } from '../lib/response.js';
import type { AppVariables } from '../middleware/request-id.js';
import { parseJson } from '../middleware/validate.js';
import { deleteUnsharedRecipeImages } from '../services/images/delete-recipe-images.js';
import type { RecipeRepository } from '../services/recipes/recipe-repository.js';
import type { StorageAdapter } from '../services/storage/storage-adapter.js';

const ScopeSchema = z.enum(['mine', 'all']).default('all');

export type RecipeDeps = {
  recipeRepository: RecipeRepository
  storageAdapter: StorageAdapter
  publicBaseUrl: string
}

// Slugifies a recipe title for use as a download filename: lowercase,
// non-alphanumeric runs collapsed to a single hyphen, leading/trailing
// hyphens trimmed. Falls back to "recipe" if the title slugifies to empty
// (e.g. a title made entirely of punctuation).
function slugifyTitle(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug.length > 0 ? slug : 'recipe';
}

// Recipe ids are always server-generated UUIDs (see LocalJsonFileRecipeRepository.save).
// The :id route param is user-controlled and must be validated as a UUID before it
// reaches the repository, since repositories may build filesystem paths from it -
// an unvalidated id is a path traversal risk (e.g. "../../etc/passwd").
function parseRecipeId(id: string): string {
  const result = RecipeIdSchema.safeParse(id);

  if (!result.success) {
    throw new AppError('INVALID_INPUT', 'Invalid recipe id.', { id });
  }

  return result.data;
}

// Recipe CRUD + validate/download routes per docs/specs/03 and docs/specs/13, backed
// by the injected RecipeRepository.
export function createRecipeApp(deps: RecipeDeps) {
  const app = new Hono<{ Variables: AppVariables }>();
  const { recipeRepository, storageAdapter, publicBaseUrl } = deps;

  // POST /recipe/validate: a "check" endpoint, not a mutating one - validity
  // is reported IN the 200 payload rather than as an HTTP error, so a caller
  // can preview whether a candidate would be accepted without a save attempt
  // ever failing loudly.
  app.post('/recipe/validate', async (c) => {
    const requestId = c.get('requestId');
    const body = await parseJson(c);
    const result = CanonicalRecipeSchema.safeParse(body);

    if (!result.success) {
      return c.json(
        ok(requestId, {
          valid: false as const,
          errors: result.error.flatten(),
        }),
      );
    }

    return c.json(
      ok(requestId, {
        valid: true as const,
        recipe: result.data,
      }),
    );
  });

  // POST /recipe/save: a mutating "commit" endpoint - unlike /validate, an
  // invalid payload is rejected outright (422 SCHEMA_VALIDATION_FAILED)
  // rather than reported as data. Malformed JSON is still 400 INVALID_INPUT
  // (via parseJson), since that's a transport-level problem, not a recipe
  // shape problem.
  app.post('/recipe/save', async (c) => {
    const requestId = c.get('requestId');
    const body = await parseJson(c);
    const result = SaveRecipeRequestSchema.safeParse(body);

    if (!result.success) {
      throw new AppError('SCHEMA_VALIDATION_FAILED', 'The recipe payload failed schema validation.', {
        issues: result.error.flatten(),
      });
    }

    const { id } = await recipeRepository.save(result.data, c.get('user').username);

    return c.json(ok(requestId, { id }));
  });

  // PUT /recipe/:id: "Save changes" for a recipe opened from the Library.
  // Any logged-in user may edit any recipe; the owner stays the original
  // saver (deployment spec section 4).
  app.put('/recipe/:id', async (c) => {
    const requestId = c.get('requestId');
    const id = parseRecipeId(c.req.param('id'));
    const body = await parseJson(c);
    const result = SaveRecipeRequestSchema.safeParse(body);

    if (!result.success) {
      throw new AppError('SCHEMA_VALIDATION_FAILED', 'The recipe payload failed schema validation.', {
        issues: result.error.flatten(),
      });
    }

    if (!(await recipeRepository.update(id, result.data))) {
      throw new AppError('RECIPE_NOT_FOUND', `No recipe exists with id "${id}".`, { id });
    }

    return c.json(ok(requestId, { id }));
  });

  app.get('/recipes', async (c) => {
    const requestId = c.get('requestId');
    const scope = ScopeSchema.safeParse(c.req.query('scope'));
    if (!scope.success) {
      throw new AppError('INVALID_INPUT', 'scope must be "mine" or "all".');
    }
    const recipes = await recipeRepository.list(
      scope.data === 'mine' ? { owner: c.get('user').username } : {},
    );

    return c.json(ok(requestId, { recipes }));
  });

  // GET /recipe/download/:id must be registered before GET /recipe/:id so
  // that "download" is not matched as an :id value.
  app.get('/recipe/download/:id', async (c) => {
    const id = parseRecipeId(c.req.param('id'));
    const stored = await recipeRepository.get(id);

    if (!stored) {
      throw new AppError('RECIPE_NOT_FOUND', `No recipe exists with id "${id}".`, { id });
    }

    const filename = `${slugifyTitle(stored.recipe.title)}.json`;

    c.header('Content-Disposition', `attachment; filename="${filename}"`);
    return c.json(stored.recipe);
  });

  app.get('/recipe/:id', async (c) => {
    const requestId = c.get('requestId');
    const id = parseRecipeId(c.req.param('id'));
    const stored = await recipeRepository.get(id);

    if (!stored) {
      throw new AppError('RECIPE_NOT_FOUND', `No recipe exists with id "${id}".`, { id });
    }

    return c.json(
      ok(requestId, {
        recipe: stored.recipe,
        meta: { id: stored.id, owner: stored.owner, createdAt: stored.createdAt, updatedAt: stored.updatedAt },
      }),
    );
  });

  app.delete('/recipe/:id', async (c) => {
    const requestId = c.get('requestId');
    const id = parseRecipeId(c.req.param('id'));
    const stored = await recipeRepository.get(id);

    if (!stored) {
      throw new AppError('RECIPE_NOT_FOUND', `No recipe exists with id "${id}".`, { id });
    }

    const user = c.get('user');
    if (stored.owner !== user.username && !user.isAdmin) {
      throw new AppError('FORBIDDEN', 'Only the recipe owner or an admin can delete this recipe.', { id });
    }

    await recipeRepository.delete(id);
    // Best-effort (deployment spec section 8): the recipe is already gone, so
    // a failure here must not fail the request. If getAll() fails we skip
    // cleanup entirely - an empty `remaining` would delete shared images.
    try {
      await deleteUnsharedRecipeImages({
        deleted: stored.recipe,
        remaining: await recipeRepository.getAll(),
        storageAdapter,
        publicBaseUrl,
        requestId,
      });
    } catch (err) {
      console.error(
        JSON.stringify({
          level: 'error',
          message: 'Failed to clean up recipe images',
          requestId,
          id,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }

    return c.json(ok(requestId, {}));
  });

  return app;
}
