import type { CanonicalRecipe } from 'shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RecipeRepository } from './recipe-repository.js';

export function makeRecipe(overrides: Partial<CanonicalRecipe> = {}): CanonicalRecipe {
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

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

// Behavior every RecipeRepository must share (deployment spec section 3).
// Each implementation's test file calls this once with its own factory.
export function describeRecipeRepositoryContract(
  name: string,
  makeRepo: () => Promise<{ repo: RecipeRepository; cleanup: () => Promise<void> }>,
): void {
  describe(`${name} (RecipeRepository contract)`, () => {
    let repo: RecipeRepository;
    let cleanup: () => Promise<void>;

    beforeEach(async () => {
      ({ repo, cleanup } = await makeRepo());
    });

    afterEach(async () => {
      await cleanup();
    });

    it('round-trips a saved recipe with its owner and timestamps', async () => {
      const recipe = makeRecipe({ title: 'Round Trip' });
      const { id } = await repo.save(recipe, 'alice');

      const stored = await repo.get(id);

      expect(stored?.recipe).toEqual(recipe);
      expect(stored?.owner).toBe('alice');
      expect(stored?.id).toBe(id);
      expect(stored?.updatedAt).toBe(stored?.createdAt);
    });

    it('returns null for an unknown id', async () => {
      expect(await repo.get('00000000-0000-4000-8000-000000000000')).toBeNull();
    });

    it('update replaces the body, bumps updatedAt and keeps owner and createdAt', async () => {
      const { id } = await repo.save(makeRecipe({ title: 'Before' }), 'alice');
      const before = await repo.get(id);
      await tick();

      const updated = await repo.update(id, makeRecipe({ title: 'After' }));
      const after = await repo.get(id);

      expect(updated).toBe(true);
      expect(after?.recipe.title).toBe('After');
      expect(after?.owner).toBe('alice');
      expect(after?.createdAt).toBe(before?.createdAt);
      expect(after!.updatedAt > before!.updatedAt).toBe(true);
    });

    it('update returns false for an unknown id and creates nothing', async () => {
      const updated = await repo.update('00000000-0000-4000-8000-000000000000', makeRecipe());

      expect(updated).toBe(false);
      expect(await repo.list()).toEqual([]);
    });

    it('lists newest first, with owner, and filters by owner', async () => {
      const { id: a } = await repo.save(makeRecipe({ title: 'A' }), 'alice');
      await tick();
      const { id: b } = await repo.save(makeRecipe({ title: 'B' }), 'bob');

      const all = await repo.list();
      const mine = await repo.list({ owner: 'alice' });

      expect(all.map((s) => s.id)).toEqual([b, a]);
      expect(all[0]).toMatchObject({ id: b, title: 'B', owner: 'bob', source_type: 'manual', time: 20 });
      expect(mine.map((s) => s.id)).toEqual([a]);
    });

    it('getAll returns every recipe with its body', async () => {
      await repo.save(makeRecipe({ title: 'A' }), 'alice');
      await repo.save(makeRecipe({ title: 'B' }), 'bob');

      const titles = (await repo.getAll()).map((s) => s.recipe.title).sort();

      expect(titles).toEqual(['A', 'B']);
    });

    it('delete removes the recipe and is idempotent', async () => {
      const { id } = await repo.save(makeRecipe(), 'alice');

      await repo.delete(id);
      await repo.delete(id);

      expect(await repo.get(id)).toBeNull();
    });
  });
}
