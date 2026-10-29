import { afterEach, describe, expect, it } from 'vitest';
import { getExtensionApi } from './api';

const g = globalThis as Record<string, unknown>;

describe('getExtensionApi', () => {
  afterEach(() => {
    delete g.browser;
    delete g.chrome;
  });

  it('returns globalThis.browser when present', () => {
    const browser = { id: 'browser' };
    g.browser = browser;
    g.chrome = { id: 'chrome' };
    expect(getExtensionApi()).toBe(browser);
  });

  it('falls back to globalThis.chrome', () => {
    const chrome = { id: 'chrome' };
    g.chrome = chrome;
    expect(getExtensionApi()).toBe(chrome);
  });
});

describe('getExtensionApi without a WebExtension API', () => {
  it('throws a clear error', () => {
    expect(() => getExtensionApi()).toThrow(/neither `browser` nor `chrome`/);
  });
});
