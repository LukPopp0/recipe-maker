import { describe, expect, it } from 'vitest';
import { canDeleteRecipe } from './permissions.ts';

describe('canDeleteRecipe', () => {
  it('allows the owner and admins, nobody else', () => {
    expect(canDeleteRecipe({ username: 'alice', isAdmin: false }, 'alice')).toBe(true);
    expect(canDeleteRecipe({ username: 'admin', isAdmin: true }, 'alice')).toBe(true);
    expect(canDeleteRecipe({ username: 'bob', isAdmin: false }, 'alice')).toBe(false);
    expect(canDeleteRecipe(null, 'alice')).toBe(false);
  });
});
