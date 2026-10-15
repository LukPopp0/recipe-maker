import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import { ImageDecodeError } from '../images/normalize-image.js';
import type { StorageAdapter } from './storage-adapter.js';
import { ResizingStorageAdapter, toJpegKey } from './resizing-storage-adapter.js';

function fakeInner(): StorageAdapter & { put: ReturnType<typeof vi.fn> } {
  return {
    put: vi.fn(async (_buf: Buffer, key: string) => `http://localhost:8787/images/${key}`),
    get: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(),
  } as never;
}

describe('toJpegKey', () => {
  it('replaces the extension with .jpg', () => {
    expect(toJpegKey('recipes/abc/main-0.png')).toBe('recipes/abc/main-0.jpg');
    expect(toJpegKey('recipes/abc/step-2.webp')).toBe('recipes/abc/step-2.jpg');
    expect(toJpegKey('recipes/abc/step-2')).toBe('recipes/abc/step-2.jpg');
  });
});

describe('ResizingStorageAdapter', () => {
  it('stores a normalized JPEG under a .jpg key and returns the inner URL', async () => {
    const inner = fakeInner();
    const adapter = new ResizingStorageAdapter(inner);
    const png = await sharp({ create: { width: 2000, height: 2000, channels: 3, background: '#000' } }).png().toBuffer();

    const url = await adapter.put(png, 'recipes/abc/main-0.png', 'image/png');

    const [stored, key, contentType] = inner.put.mock.calls[0] as [Buffer, string, string];
    expect(key).toBe('recipes/abc/main-0.jpg');
    expect(contentType).toBe('image/jpeg');
    expect((await sharp(stored).metadata()).width).toBe(1600);
    expect(url).toBe('http://localhost:8787/images/recipes/abc/main-0.jpg');
  });

  it('rejects undecodable bytes with ImageDecodeError and stores nothing', async () => {
    const inner = fakeInner();

    await expect(new ResizingStorageAdapter(inner).put(Buffer.from('nope'), 'recipes/a/main-0.jpg', 'image/jpeg')).rejects.toBeInstanceOf(ImageDecodeError);
    expect(inner.put).not.toHaveBeenCalled();
  });
});

describe('ResizingStorageAdapter.list', () => {
  it('passes list through to the inner adapter', async () => {
    const inner = fakeInner();
    const objects = [{ key: 'recipes/a/main-0.jpg', sizeBytes: 1, modifiedAt: new Date() }];
    (inner as unknown as { list: ReturnType<typeof vi.fn> }).list.mockResolvedValue(objects);

    expect(await new ResizingStorageAdapter(inner).list('recipes/')).toBe(objects);
    expect((inner as unknown as { list: ReturnType<typeof vi.fn> }).list).toHaveBeenCalledWith('recipes/');
  });
});
