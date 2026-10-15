import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadLibraryScope, storeLibraryScope } from './library-scope.ts';

describe('library scope storage', () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('defaults to "mine" and round-trips a stored scope', () => {
    expect(loadLibraryScope()).toBe('mine');
    storeLibraryScope('all');
    expect(loadLibraryScope()).toBe('all');
  });

  it('ignores garbage and storage errors', () => {
    localStorage.setItem('recipe-maker.library-scope', 'everything');
    expect(loadLibraryScope()).toBe('mine');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(loadLibraryScope()).toBe('mine');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => storeLibraryScope('all')).not.toThrow();
  });
});
