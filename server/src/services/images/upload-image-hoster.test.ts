import { describe, expect, it, vi } from 'vitest';
import type { StorageAdapter } from '../storage/storage-adapter.js';
import { ImageDecodeError } from './normalize-image.js';
import { hostUploadedImage, type UploadedFile } from './upload-image-hoster.js';

function makeStorageAdapter(): StorageAdapter & { put: ReturnType<typeof vi.fn> } {
  return {
    put: vi.fn().mockResolvedValue('http://localhost:8787/images/recipes/recipe-1/main-0.jpg'),
    get: vi.fn(),
    list: vi.fn(),
    delete: vi.fn(),
  };
}

function makeFile(overrides: Partial<UploadedFile> = {}): UploadedFile {
  return {
    buffer: Buffer.from([1, 2, 3, 4]),
    contentType: 'image/jpeg',
    filename: 'photo.jpg',
    ...overrides,
  };
}

describe('hostUploadedImage', () => {
  it('hosts a valid jpeg buffer and returns the hosted URL', async () => {
    const storageAdapter = makeStorageAdapter();
    const file = makeFile({ contentType: 'image/jpeg' });

    const result = await hostUploadedImage(file, {
      recipeId: 'recipe-1',
      storageAdapter,
      maxBytes: 1024,
      kind: 'main',
      index: 0,
    });

    expect(result).toEqual({ url: 'http://localhost:8787/images/recipes/recipe-1/main-0.jpg' });
    expect(storageAdapter.put).toHaveBeenCalledWith(
      file.buffer,
      expect.stringMatching(/^recipes\/recipe-1\/main-0-[0-9a-f]{8}\.jpg$/),
      'image/jpeg',
    );
  });

  it('hosts a valid png buffer and returns the hosted URL', async () => {
    const storageAdapter = makeStorageAdapter();
    const file = makeFile({ contentType: 'image/png', filename: 'photo.png' });

    const result = await hostUploadedImage(file, {
      recipeId: 'recipe-1',
      storageAdapter,
      maxBytes: 1024,
      kind: 'main',
      index: 0,
    });

    expect(result).toEqual({ url: 'http://localhost:8787/images/recipes/recipe-1/main-0.jpg' });
    expect(storageAdapter.put).toHaveBeenCalledWith(
      file.buffer,
      expect.stringMatching(/^recipes\/recipe-1\/main-0-[0-9a-f]{8}\.png$/),
      'image/png',
    );
  });

  it('hosts a valid webp buffer and returns the hosted URL', async () => {
    const storageAdapter = makeStorageAdapter();
    const file = makeFile({ contentType: 'image/webp', filename: 'photo.webp' });

    const result = await hostUploadedImage(file, {
      recipeId: 'recipe-1',
      storageAdapter,
      maxBytes: 1024,
      kind: 'main',
      index: 0,
    });

    expect(result).toEqual({ url: 'http://localhost:8787/images/recipes/recipe-1/main-0.jpg' });
    expect(storageAdapter.put).toHaveBeenCalledWith(
      file.buffer,
      expect.stringMatching(/^recipes\/recipe-1\/main-0-[0-9a-f]{8}\.webp$/),
      'image/webp',
    );
  });

  it('returns a warning for an unsupported MIME type and does not call put', async () => {
    const storageAdapter = makeStorageAdapter();
    const file = makeFile({ contentType: 'image/gif', filename: 'animated.gif' });

    const result = await hostUploadedImage(file, {
      recipeId: 'recipe-1',
      storageAdapter,
      maxBytes: 1024,
      kind: 'main',
      index: 0,
    });

    expect(result).toHaveProperty('warning');
    expect((result as { warning: string }).warning).toContain('animated.gif');
    expect(storageAdapter.put).not.toHaveBeenCalled();
  });

  it('returns a warning for an oversized buffer and does not call put', async () => {
    const storageAdapter = makeStorageAdapter();
    const file = makeFile({ buffer: Buffer.alloc(2048), filename: 'big.jpg' });

    const result = await hostUploadedImage(file, {
      recipeId: 'recipe-1',
      storageAdapter,
      maxBytes: 1024,
      kind: 'main',
      index: 0,
    });

    expect(result).toHaveProperty('warning');
    expect((result as { warning: string }).warning).toContain('big.jpg');
    expect(storageAdapter.put).not.toHaveBeenCalled();
  });

  it('reflects kind and index in the storage key for step images', async () => {
    const storageAdapter = makeStorageAdapter();
    const file = makeFile();

    await hostUploadedImage(file, {
      recipeId: 'recipe-2',
      storageAdapter,
      maxBytes: 1024,
      kind: 'step',
      index: 3,
    });

    expect(storageAdapter.put).toHaveBeenCalledWith(
      file.buffer,
      expect.stringMatching(/^recipes\/recipe-2\/step-3-[0-9a-f]{8}\.jpg$/),
      'image/jpeg',
    );
  });

  it('reflects kind and index in the storage key for main images', async () => {
    const storageAdapter = makeStorageAdapter();
    const file = makeFile();

    await hostUploadedImage(file, {
      recipeId: 'recipe-2',
      storageAdapter,
      maxBytes: 1024,
      kind: 'main',
      index: 0,
    });

    expect(storageAdapter.put).toHaveBeenCalledWith(
      file.buffer,
      expect.stringMatching(/^recipes\/recipe-2\/main-0-[0-9a-f]{8}\.jpg$/),
      'image/jpeg',
    );
  });

  it('gives two uploads for the same step different keys so a re-upload never overwrites', async () => {
    const storageAdapter = makeStorageAdapter();
    const options = { recipeId: 'recipe-2', storageAdapter, maxBytes: 1024, kind: 'step' as const, index: 1 };

    await hostUploadedImage(makeFile(), options);
    await hostUploadedImage(makeFile(), options);

    const [first, second] = storageAdapter.put.mock.calls.map((call) => call[1] as string);
    expect(first).toMatch(/^recipes\/recipe-2\/step-1-[0-9a-f]{8}\.jpg$/);
    expect(second).not.toBe(first);
  });

  it('returns a warning instead of throwing when the bytes are not a readable image', async () => {
    const storageAdapter = makeStorageAdapter();
    storageAdapter.put.mockRejectedValue(new ImageDecodeError('bad'));

    const result = await hostUploadedImage(makeFile({ contentType: 'image/jpeg', filename: 'broken.jpg' }), {
      recipeId: 'r1',
      storageAdapter,
      maxBytes: 1_000_000,
      kind: 'step',
      index: 0,
    });

    expect(result).toEqual({ warning: '"broken.jpg" was not uploaded: the file is not a readable image.' });
  });
});
