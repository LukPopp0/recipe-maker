import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { CanonicalRecipe } from 'shared';
import { LocalJsonFileRecipeRepository } from './local-json-file-recipe-repository.js';

function makeRecipe(overrides: Partial<CanonicalRecipe> = {}): CanonicalRecipe {
  return {
    title: 'Test Recipe',
    tags: ['quick'],
    time: 20,
    ingredients: [{ name: 'Salt', amount_text: '1 tsp' }],
    pantry_items: ['salt'],
    main_image: 'salt.png',
    steps: [{ step_header: 'Cook', step_description: 'Cook it.' }],
    metadata: { source_type: 'manual', language: 'en', warnings: [] },
    ...overrides,
  };
}

describe('LocalJsonFileRecipeRepository', () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'recipe-repo-test-'));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it('round-trips a saved recipe through get', async () => {
    const repo = new LocalJsonFileRecipeRepository(dataDir);
    const recipe = makeRecipe({ title: 'Round Trip' });

    const { id } = await repo.save(recipe);
    const fetched = await repo.get(id);

    expect(fetched).toEqual(recipe);
  });

  it('returns null from get for an unknown id', async () => {
    const repo = new LocalJsonFileRecipeRepository(dataDir);

    const fetched = await repo.get('does-not-exist');

    expect(fetched).toBeNull();
  });

  it('lists summaries newest-first', async () => {
    const repo = new LocalJsonFileRecipeRepository(dataDir);

    const { id: firstId } = await repo.save(makeRecipe({ title: 'First' }));
    await new Promise((resolve) => setTimeout(resolve, 5));
    const { id: secondId } = await repo.save(makeRecipe({ title: 'Second' }));

    const list = await repo.list();

    expect(list.map((s) => s.id)).toEqual([secondId, firstId]);
    expect(list[0]).toMatchObject({
      id: secondId,
      title: 'Second',
      tags: ['quick'],
      main_image: 'salt.png',
    });
    expect(typeof list[0].createdAt).toBe('string');
  });

  it('delete removes the recipe from get and list', async () => {
    const repo = new LocalJsonFileRecipeRepository(dataDir);
    const { id } = await repo.save(makeRecipe());

    await repo.delete(id);

    expect(await repo.get(id)).toBeNull();
    expect(await repo.list()).toEqual([]);
  });

  it('delete is idempotent for an unknown id', async () => {
    const repo = new LocalJsonFileRecipeRepository(dataDir);

    await expect(repo.delete('does-not-exist')).resolves.toBeUndefined();
  });

  it('rejects a get() id containing a path separator (path traversal defense-in-depth)', async () => {
    const repo = new LocalJsonFileRecipeRepository(dataDir);

    await expect(repo.get('../../etc/passwd')).rejects.toThrow();
    await expect(repo.get('foo/bar')).rejects.toThrow();
    await expect(repo.get('foo\\bar')).rejects.toThrow();
  });

  it('rejects a delete() id containing a path separator (path traversal defense-in-depth)', async () => {
    const repo = new LocalJsonFileRecipeRepository(dataDir);

    await expect(repo.delete('../../etc/passwd')).rejects.toThrow();
    await expect(repo.delete('foo/bar')).rejects.toThrow();
  });

  it('finds saved recipes after re-instantiating against the same dir (restart simulation)', async () => {
    const repo1 = new LocalJsonFileRecipeRepository(dataDir);
    const { id } = await repo1.save(makeRecipe({ title: 'Survives Restart' }));

    const repo2 = new LocalJsonFileRecipeRepository(dataDir);
    const fetched = await repo2.get(id);
    const list = await repo2.list();

    expect(fetched?.title).toBe('Survives Restart');
    expect(list.map((s) => s.id)).toContain(id);
  });
});
