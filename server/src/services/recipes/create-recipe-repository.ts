import path from 'node:path';
import type { ServerEnv } from '../../env.js';
import { LocalJsonFileRecipeRepository } from './local-json-file-recipe-repository.js';
import type { RecipeRepository } from './recipe-repository.js';
import { SqliteRecipeRepository } from './sqlite-recipe-repository.js';

// Picks the RecipeRepository implementation from RECIPE_STORE.
export function createRecipeRepository(env: ServerEnv): RecipeRepository {
  return env.RECIPE_STORE === 'sqlite'
    ? new SqliteRecipeRepository(env.RECIPE_DB_PATH)
    : new LocalJsonFileRecipeRepository(env.RECIPE_DATA_DIR);
}

// The directory the selected store writes into; the startup readiness
// check verifies it exists and is writable.
export function recipeStorageDir(env: ServerEnv): string {
  return env.RECIPE_STORE === 'sqlite' ? path.dirname(env.RECIPE_DB_PATH) : env.RECIPE_DATA_DIR;
}
