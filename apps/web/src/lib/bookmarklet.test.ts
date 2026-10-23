import { afterEach, describe, expect, it, vi } from 'vitest';
import { BOOKMARKLET_SOURCE } from '../generated/bookmarklet-source';
import { buildBookmarklet } from './bookmarklet';

describe('buildBookmarklet', () => {
  afterEach(() => vi.restoreAllMocks());

  it('generated source contains the origin token exactly once', () => {
    expect(BOOKMARKLET_SOURCE.split('__RECIPE_MAKER_ORIGIN__').length).toBe(2);
  });

  it('builds a javascript: URL with the app origin baked in', () => {
    const href = buildBookmarklet('https://recipes.example');
    expect(href.startsWith('javascript:')).toBe(true);
    expect(decodeURIComponent(href.slice('javascript:'.length))).toContain('"https://recipes.example"');
    expect(href).not.toContain('__RECIPE_MAKER_ORIGIN__');
  });

  it('rejects an origin with a path', () => {
    expect(() => buildBookmarklet('https://x/app')).toThrow();
  });

  it('rejects a string that is not a URL', () => {
    expect(() => buildBookmarklet('nope')).toThrow();
  });

  it('runs and opens the capture route when evaluated', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    new Function(decodeURIComponent(buildBookmarklet('https://recipes.example').slice(11)))();
    expect(open).toHaveBeenCalledWith('https://recipes.example/capture', '_blank');
  });
});
