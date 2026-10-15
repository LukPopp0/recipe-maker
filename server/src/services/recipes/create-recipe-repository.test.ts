import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadServerEnv } from '../../env.js';
import { createRecipeRepository, recipeStorageDir } from './create-recipe-repository.js';
import { LocalJsonFileRecipeRepository } from './local-json-file-recipe-repository.js';
import { SqliteRecipeRepository } from './sqlite-recipe-repository.js';

describe('createRecipeRepository', () => {
  it('builds the JSON repository by default', () => {
    const env = loadServerEnv({});

    expect(createRecipeRepository(env)).toBeInstanceOf(LocalJsonFileRecipeRepository);
    expect(recipeStorageDir(env)).toBe(env.RECIPE_DATA_DIR);
  });

  it('builds the SQLite repository for RECIPE_STORE=sqlite', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'recipe-store-'));
    const env = loadServerEnv({ RECIPE_STORE: 'sqlite', RECIPE_DB_PATH: path.join(dir, 'db', 'r.db') });

    const repo = createRecipeRepository(env);

    expect(repo).toBeInstanceOf(SqliteRecipeRepository);
    expect(recipeStorageDir(env)).toBe(path.join(dir, 'db'));
    (repo as SqliteRecipeRepository).close();
    await rm(dir, { recursive: true, force: true });
  });
});
