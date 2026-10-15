import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { describeRecipeRepositoryContract, makeRecipe } from './recipe-repository-contract.js';
import { SqliteRecipeRepository } from './sqlite-recipe-repository.js';

describeRecipeRepositoryContract('SqliteRecipeRepository', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'recipe-sqlite-test-'));
  const repo = new SqliteRecipeRepository(path.join(dir, 'nested', 'recipes.db'));
  return {
    repo,
    cleanup: async () => {
      repo.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
});

describe('SqliteRecipeRepository schema', () => {
  it('creates the schema once, uses WAL, and keeps data across reopen', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'recipe-sqlite-schema-'));
    const dbPath = path.join(dir, 'recipes.db');

    const first = new SqliteRecipeRepository(dbPath);
    const { id } = await first.save(makeRecipe({ title: 'Persisted' }), 'alice');
    first.close();

    const second = new SqliteRecipeRepository(dbPath);
    expect((await second.get(id))?.recipe.title).toBe('Persisted');
    second.close();

    const raw = new Database(dbPath, { readonly: true });
    expect(raw.pragma('user_version', { simple: true })).toBe(1);
    expect(raw.pragma('journal_mode', { simple: true })).toBe('wal');
    raw.close();
    await rm(dir, { recursive: true, force: true });
  });
});
