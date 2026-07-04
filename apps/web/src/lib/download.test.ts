import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildRecipeFilename, downloadJson, slugifyTitle } from './download.ts';

describe('slugifyTitle', () => {
  it('lowercases and hyphenates', () => {
    expect(slugifyTitle('Spicy Noodles')).toBe('spicy-noodles');
  });

  it('strips non-alphanumeric characters to hyphens', () => {
    expect(slugifyTitle("Grandma's Apple Pie!")).toBe('grandma-s-apple-pie');
  });

  it('collapses runs of separators into a single hyphen', () => {
    expect(slugifyTitle('Spicy   Noodles -- Extra Hot')).toBe('spicy-noodles-extra-hot');
  });

  it('trims leading and trailing hyphens', () => {
    expect(slugifyTitle('  !!Spicy Noodles!!  ')).toBe('spicy-noodles');
  });

  it('falls back to "recipe" when the slug is empty', () => {
    expect(slugifyTitle('!!!')).toBe('recipe');
  });
});

describe('buildRecipeFilename', () => {
  it('builds a deterministic filename for a fixed date', () => {
    const fixedDate = new Date(2026, 6, 3); // July 3, 2026 (month is 0-indexed)
    expect(buildRecipeFilename('Spicy Noodles', fixedDate)).toBe('recipe-spicy-noodles-20260703.json');
  });

  it('zero-pads single-digit months and days', () => {
    const fixedDate = new Date(2026, 0, 5); // January 5, 2026
    expect(buildRecipeFilename('Spicy Noodles', fixedDate)).toBe('recipe-spicy-noodles-20260105.json');
  });
});

describe('downloadJson', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('creates an object URL, clicks an anchor, and revokes the URL', () => {
    const createObjectURL = vi.fn().mockReturnValue('blob:mock-url');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    downloadJson('recipe-spicy-noodles-20260703.json', { title: 'Spicy Noodles' });

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blobArg = createObjectURL.mock.calls[0][0] as Blob;
    expect(blobArg).toBeInstanceOf(Blob);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });
});
