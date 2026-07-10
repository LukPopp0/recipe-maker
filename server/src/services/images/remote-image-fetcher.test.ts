import dns from 'node:dns';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StorageAdapter } from '../storage/storage-adapter.js';
import { fetchAndStoreRemoteImage } from './remote-image-fetcher.js';

// remote.example.com is a fake hostname; stub DNS to a public address so
// resolveAndCheckHost's SSRF guard doesn't attempt a real lookup.
function mockPublicDns() {
  vi.spyOn(dns.promises, 'lookup').mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
}

function makeStorageAdapter(): StorageAdapter & { put: ReturnType<typeof vi.fn> } {
  return {
    put: vi.fn().mockImplementation(async (_buffer: Buffer, key: string) => `http://localhost:8787/images/${key}`),
    get: vi.fn(),
    delete: vi.fn(),
  };
}

describe('fetchAndStoreRemoteImage', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
    mockPublicDns();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('fetches and stores a valid remote image under keyPrefix + extension', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(bytes, { status: 200, headers: { 'content-type': 'image/jpeg' } }),
    );
    const storageAdapter = makeStorageAdapter();

    const result = await fetchAndStoreRemoteImage('https://remote.example.com/photo.jpg', {
      storageAdapter,
      maxBytes: 1_000_000,
      keyPrefix: 'recipes/recipe-1/main-0',
    });

    expect(result).toEqual({ ok: true, url: 'http://localhost:8787/images/recipes/recipe-1/main-0.jpg' });
    expect(storageAdapter.put).toHaveBeenCalledWith(Buffer.from(bytes), 'recipes/recipe-1/main-0.jpg', 'image/jpeg');
  });

  it('returns unsupported-type without storing on a bad MIME type', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1]), { status: 200, headers: { 'content-type': 'image/gif' } }),
    );
    const storageAdapter = makeStorageAdapter();

    const result = await fetchAndStoreRemoteImage('https://remote.example.com/photo.gif', {
      storageAdapter,
      maxBytes: 1_000_000,
      keyPrefix: 'recipes/recipe-1/step-0',
    });

    expect(result).toEqual({ ok: false, reason: 'unsupported-type', contentType: 'image/gif' });
    expect(storageAdapter.put).not.toHaveBeenCalled();
  });

  it('returns oversized when the image exceeds maxBytes', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(new Uint8Array(10), { status: 200, headers: { 'content-type': 'image/png' } }),
    );
    const storageAdapter = makeStorageAdapter();

    const result = await fetchAndStoreRemoteImage('https://remote.example.com/photo.png', {
      storageAdapter,
      maxBytes: 5,
      keyPrefix: 'recipes/recipe-1/step-0',
    });

    expect(result).toEqual({ ok: false, reason: 'oversized' });
    expect(storageAdapter.put).not.toHaveBeenCalled();
  });

  it('returns status on a non-ok HTTP response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
    const storageAdapter = makeStorageAdapter();

    const result = await fetchAndStoreRemoteImage('https://remote.example.com/missing.jpg', {
      storageAdapter,
      maxBytes: 1_000_000,
      keyPrefix: 'recipes/recipe-1/step-0',
    });

    expect(result).toEqual({ ok: false, reason: 'status', status: 404 });
    expect(storageAdapter.put).not.toHaveBeenCalled();
  });

  it('returns error on a network failure', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const storageAdapter = makeStorageAdapter();

    const result = await fetchAndStoreRemoteImage('https://remote.example.com/photo.jpg', {
      storageAdapter,
      maxBytes: 1_000_000,
      keyPrefix: 'recipes/recipe-1/step-0',
    });

    expect(result).toMatchObject({ ok: false, reason: 'error' });
    expect(storageAdapter.put).not.toHaveBeenCalled();
  });

  it('returns blocked, without ever fetching, when the URL resolves to a blocked address', async () => {
    globalThis.fetch = vi.fn();
    const storageAdapter = makeStorageAdapter();

    const result = await fetchAndStoreRemoteImage('http://169.254.169.254/image.jpg', {
      storageAdapter,
      maxBytes: 1_000_000,
      keyPrefix: 'recipes/recipe-1/step-0',
    });

    expect(result).toEqual({ ok: false, reason: 'blocked' });
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(storageAdapter.put).not.toHaveBeenCalled();
  });

  it('returns blocked on a malformed / non-http URL', async () => {
    globalThis.fetch = vi.fn();
    const storageAdapter = makeStorageAdapter();

    const result = await fetchAndStoreRemoteImage('ftp://remote.example.com/photo.jpg', {
      storageAdapter,
      maxBytes: 1_000_000,
      keyPrefix: 'recipes/recipe-1/step-0',
    });

    expect(result).toEqual({ ok: false, reason: 'blocked' });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('returns timeout when the download aborts', async () => {
    globalThis.fetch = vi.fn().mockImplementation((_input: string | URL, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('The operation was aborted.');
          err.name = 'AbortError';
          reject(err);
        });
      });
    });
    const storageAdapter = makeStorageAdapter();

    const result = await fetchAndStoreRemoteImage('https://remote.example.com/photo.jpg', {
      storageAdapter,
      maxBytes: 1_000_000,
      keyPrefix: 'recipes/recipe-1/step-0',
      timeoutMs: 5,
    });

    expect(result).toEqual({ ok: false, reason: 'timeout' });
    expect(storageAdapter.put).not.toHaveBeenCalled();
  });
});
