// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeApi, flush } from './fake-api';

const g = globalThis as Record<string, unknown>;

const HTML = `
  <label for="address">Recipe Maker address</label>
  <input id="address" type="text" />
  <button id="save" type="button">Save</button>
  <p id="status" role="status"></p>`;

async function load(opts: Parameters<typeof createFakeApi>[0] = {}) {
  document.body.innerHTML = HTML;
  const fake = createFakeApi(opts);
  g.chrome = fake.api;
  vi.resetModules();
  await import('./options');
  await flush();
  return fake;
}

const input = () => document.getElementById('address') as HTMLInputElement;
const status = () => document.getElementById('status')!.textContent;
const save = async () => {
  (document.getElementById('save') as HTMLButtonElement).click();
  await flush();
};

describe('options', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });
  afterEach(() => {
    delete g.chrome;
  });

  it('explains why it opened when host access is missing', async () => {
    window.history.pushState({}, '', '/options.html?reason=permission');
    await load({ storage: { appOrigin: 'https://recipes.example' } });
    expect(status()).toBe('Recipe Maker needs access to all websites to read recipe pages. Press Save to allow it.');
    window.history.pushState({}, '', '/options.html');
  });

  it('shows no explanation when opened normally', async () => {
    window.history.pushState({}, '', '/options.html');
    await load();
    expect(status()).toBe('');
  });

  it('shows the stored address', async () => {
    await load({ storage: { appOrigin: 'https://recipes.example' } });
    expect(input().value).toBe('https://recipes.example');
  });

  it('saves a valid address as its origin and requests host permissions', async () => {
    const { calls, stored } = await load();
    input().value = 'https://recipes.example/some/path';
    await save();
    expect(stored.appOrigin).toBe('https://recipes.example');
    expect(calls.find((c) => c.name === 'permissions.request')?.args[0]).toEqual({ origins: ['<all_urls>'] });
    expect(status()).toMatch(/Saved/);
    const names = calls.map((c) => c.name);
    expect(names.indexOf('permissions.request')).toBeLessThan(names.indexOf('storage.local.set'));
  });

  it('settles the permission request when storing fails', async () => {
    const fake = await load({ permissionGranted: false });
    fake.api.storage.local.set = async () => Promise.reject(new Error('disk full'));
    fake.api.permissions.request = async () => Promise.reject(new Error('denied'));
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    input().value = 'https://recipes.example';
    await save();
    await flush();
    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
    expect(status()).toMatch(/Could not save: disk full/);
  });

  it('rejects an invalid address', async () => {
    const { calls } = await load();
    input().value = 'not a url';
    await save();
    expect(calls.map((c) => c.name)).not.toContain('storage.local.set');
    expect(calls.map((c) => c.name)).not.toContain('permissions.request');
    expect(status()).toMatch(/valid address/i);
    input().value = 'ftp://recipes.example';
    await save();
    expect(calls.map((c) => c.name)).not.toContain('storage.local.set');
  });

  it('tells the user when access to all websites was not granted', async () => {
    const { stored } = await load({ permissionGranted: false });
    input().value = 'http://localhost:5173';
    await save();
    expect(stored.appOrigin).toBe('http://localhost:5173');
    expect(status()).toMatch(/access to all websites/i);
  });
});
