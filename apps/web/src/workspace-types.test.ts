import { describe, expect, it } from 'vitest';
import type { CanonicalRecipe } from 'shared';
import { shouldConfirmReplace, type WorkspaceRecipeState } from './workspace-types.ts';

const stubRecipe = {} as CanonicalRecipe;

describe('shouldConfirmReplace', () => {
  it('returns false when no recipe is loaded', () => {
    const state: WorkspaceRecipeState = null;

    expect(shouldConfirmReplace(state)).toBe(false);
  });

  it('returns true when the loaded recipe has unsaved edits and was never saved', () => {
    const state: WorkspaceRecipeState = {
      recipe: stubRecipe,
      diagnostics: null,
      savedId: null,
      dirty: true,
    };

    expect(shouldConfirmReplace(state)).toBe(true);
  });

  it('returns false when the loaded recipe is clean (no edits)', () => {
    const state: WorkspaceRecipeState = {
      recipe: stubRecipe,
      diagnostics: null,
      savedId: null,
      dirty: false,
    };

    expect(shouldConfirmReplace(state)).toBe(false);
  });

  it('returns false when the loaded recipe has been saved, even if dirty', () => {
    const state: WorkspaceRecipeState = {
      recipe: stubRecipe,
      diagnostics: null,
      savedId: 'recipe-123',
      dirty: true,
    };

    expect(shouldConfirmReplace(state)).toBe(false);
  });
});
