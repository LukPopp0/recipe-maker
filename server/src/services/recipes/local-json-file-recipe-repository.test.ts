import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalJsonFileRecipeRepository } from './local-json-file-recipe-repository.js';
import { describeRecipeRepositoryContract, makeRecipe } from './recipe-repository-contract.js';

describeRecipeRepositoryContract('LocalJsonFileRecipeRepository', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'recipe-repo-test-'));
  return {
    repo: new LocalJsonFileRecipeRepository(dataDir),
    cleanup: () => rm(dataDir, { recursive: true, force: true }),
  };
});

describe('LocalJsonFileRecipeRepository legacy envelopes', () => {
  it('reads a pre-ownership envelope as owned by "local" with updatedAt = createdAt', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'recipe-repo-legacy-'));
    try {
      const id = '11111111-1111-4111-8111-111111111111';
      const createdAt = '2026-01-01T00:00:00.000Z';
      await writeFile(path.join(dataDir, `${id}.json`), JSON.stringify({ id, createdAt, recipe: makeRecipe() }));
      const repo = new LocalJsonFileRecipeRepository(dataDir);

      const stored = await repo.get(id);
      const [summary] = await repo.list({ owner: 'local' });

      expect(stored).toMatchObject({ id, owner: 'local', createdAt, updatedAt: createdAt });
      expect(summary).toMatchObject({ id, owner: 'local', updatedAt: createdAt });
      expect(await repo.update(id, makeRecipe({ title: 'Edited' }))).toBe(true);
      expect((await repo.get(id))?.owner).toBe('local');
      await repo.delete(id);
      expect(await repo.get(id)).toBeNull();
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});

describe('LocalJsonFileRecipeRepository', () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'recipe-repo-test-'));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
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

  it('rejects an update() id containing a path separator', async () => {
    const repo = new LocalJsonFileRecipeRepository(dataDir);

    await expect(repo.update('../../etc/passwd', makeRecipe())).rejects.toThrow();
  });

  it('finds saved recipes after re-instantiating against the same dir (restart simulation)', async () => {
    const repo1 = new LocalJsonFileRecipeRepository(dataDir);
    const { id } = await repo1.save(makeRecipe({ title: 'Survives Restart' }), 'alice');

    const repo2 = new LocalJsonFileRecipeRepository(dataDir);
    const fetched = await repo2.get(id);
    const list = await repo2.list();

    expect(fetched?.recipe.title).toBe('Survives Restart');
    expect(list.map((s) => s.id)).toContain(id);
  });
});
