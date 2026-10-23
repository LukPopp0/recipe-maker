// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fetchImageBlob } from './fetch-image.js';

// Fake fetch returning jsdom Blobs (Node's Response.blob() yields a different Blob class).
const respond = (body: string, init: { status?: number; headers?: Record<string, string> }) =>
  (async () => ({
    ok: (init.status ?? 200) < 400,
    headers: new Headers(init.headers),
    blob: async () => new Blob([body]),
  })) as unknown as typeof fetch;

describe('fetchImageBlob', () => {
  it('returns null for non-ok, non-image, oversized or throwing fetches', async () => {
    expect(await fetchImageBlob('u', 100, respond('x', { status: 404, headers: { 'content-type': 'image/png' } }))).toBeNull();
    expect(await fetchImageBlob('u', 100, respond('x', { headers: { 'content-type': 'text/html' } }))).toBeNull();
    expect(await fetchImageBlob('u', 3, respond('abcdef', { headers: { 'content-type': 'image/png' } }))).toBeNull();
    expect(await fetchImageBlob('u', 100, (async () => { throw new Error('net'); }) as unknown as typeof fetch)).toBeNull();
  });

  it('returns the blob for an image within the limit, carrying the image type', async () => {
    const blob = await fetchImageBlob('u', 100, respond('abc', { headers: { 'content-type': 'image/jpeg; charset=x' } }));
    expect(blob).toBeInstanceOf(Blob);
    expect(blob?.size).toBe(3);
    expect(blob?.type.startsWith('image/jpeg')).toBe(true);
  });

  it('wraps a typeless blob with the header image type', async () => {
    const fake = (async () => ({
      ok: true,
      headers: new Headers({ 'content-type': 'image/webp' }),
      blob: async () => new Blob(['abc']),
    })) as unknown as typeof fetch;
    expect((await fetchImageBlob('u', 100, fake))?.type).toBe('image/webp');
  });

  it('wraps a blob with a non-image type using the header image type', async () => {
    const fake = (async () => ({
      ok: true,
      headers: new Headers({ 'content-type': 'image/png' }),
      blob: async () => new Blob(['abc'], { type: 'application/octet-stream' }),
    })) as unknown as typeof fetch;
    expect((await fetchImageBlob('u', 100, fake))?.type).toBe('image/png');
  });

  it('rejects early on an oversized content-length without reading the body', async () => {
    const blob = vi.fn(async () => new Blob(['abc']));
    const fake = (async () => ({
      ok: true,
      headers: new Headers({ 'content-type': 'image/png', 'content-length': '5000' }),
      blob,
    })) as unknown as typeof fetch;
    expect(await fetchImageBlob('u', 100, fake)).toBeNull();
    expect(blob).not.toHaveBeenCalled();
  });
});
