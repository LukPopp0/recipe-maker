import { mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalDiskStorageAdapter } from './local-disk-storage-adapter.js';

describe('LocalDiskStorageAdapter', () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'storage-adapter-test-'));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it('put writes bytes under the namespaced key and returns a public URL built from the key', async () => {
    const adapter = new LocalDiskStorageAdapter(dataDir, 'http://localhost:8787');
    const buffer = Buffer.from('fake-jpeg-bytes');

    const url = await adapter.put(buffer, 'recipes/recipe-1/main-0.jpg', 'image/jpeg');

    expect(url).toBe('http://localhost:8787/images/recipes/recipe-1/main-0.jpg');
    const onDisk = await readFile(path.join(dataDir, 'recipes/recipe-1/main-0.jpg'));
    expect(onDisk).toEqual(buffer);
  });

  it('put creates nested subdirectories as needed', async () => {
    const adapter = new LocalDiskStorageAdapter(dataDir, 'http://localhost:8787');

    await adapter.put(Buffer.from('x'), 'recipes/deep/nested/key-0.png', 'image/png');

    const onDisk = await readFile(path.join(dataDir, 'recipes/deep/nested/key-0.png'));
    expect(onDisk.toString()).toBe('x');
  });

  it('get returns the same bytes that were put (the bytes a /images/* static route would serve)', async () => {
    const adapter = new LocalDiskStorageAdapter(dataDir, 'http://localhost:8787');
    const buffer = Buffer.from('round-trip-bytes');
    await adapter.put(buffer, 'recipes/recipe-2/main-0.webp', 'image/webp');

    const fetched = await adapter.get('recipes/recipe-2/main-0.webp');

    expect(fetched).toEqual(buffer);
  });

  it('get throws AppError(INTERNAL_ERROR) for a missing key', async () => {
    const adapter = new LocalDiskStorageAdapter(dataDir, 'http://localhost:8787');

    await expect(adapter.get('recipes/does-not-exist/main-0.jpg')).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
    });
  });

  it('delete removes the file so a subsequent get fails', async () => {
    const adapter = new LocalDiskStorageAdapter(dataDir, 'http://localhost:8787');
    await adapter.put(Buffer.from('to-delete'), 'recipes/recipe-3/main-0.jpg', 'image/jpeg');

    await adapter.delete('recipes/recipe-3/main-0.jpg');

    await expect(adapter.get('recipes/recipe-3/main-0.jpg')).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
    });
  });

  it('delete is idempotent for a missing key', async () => {
    const adapter = new LocalDiskStorageAdapter(dataDir, 'http://localhost:8787');

    await expect(adapter.delete('recipes/does-not-exist/main-0.jpg')).resolves.toBeUndefined();
  });

  it('rejects a key that attempts path traversal outside dataDir', async () => {
    const adapter = new LocalDiskStorageAdapter(dataDir, 'http://localhost:8787');

    await expect(adapter.put(Buffer.from('x'), '../../etc/passwd', 'image/jpeg')).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
    });
  });

  it('lists stored objects under a prefix with size and mtime, [] for a missing prefix', async () => {
    const adapter = new LocalDiskStorageAdapter(dataDir, 'http://localhost:8787');
    await adapter.put(Buffer.from('abc'), 'recipes/r1/main-0.jpg', 'image/jpeg');
    await adapter.put(Buffer.from('defg'), 'recipes/r2/step-1.jpg', 'image/jpeg');

    const objects = (await adapter.list('recipes/')).sort((a, b) => a.key.localeCompare(b.key));

    expect(objects.map((o) => [o.key, o.sizeBytes])).toEqual([
      ['recipes/r1/main-0.jpg', 3],
      ['recipes/r2/step-1.jpg', 4],
    ]);
    expect(objects[0].modifiedAt).toBeInstanceOf(Date);
    expect(await adapter.list('nothing-here/')).toEqual([]);
  });

  it('list skips an entry that cannot be stat-ed (vanished after readdir)', async () => {
    const adapter = new LocalDiskStorageAdapter(dataDir, 'http://localhost:8787');
    await adapter.put(Buffer.from('abc'), 'recipes/r1/main-0.jpg', 'image/jpeg');
    // A dangling symlink is listed by readdir but stat fails with ENOENT,
    // the same outcome as a file deleted between the two calls.
    await symlink(path.join(dataDir, 'gone'), path.join(dataDir, 'recipes/r1/dangling.jpg'));

    const objects = await adapter.list('recipes/');

    expect(objects.map((o) => o.key)).toEqual(['recipes/r1/main-0.jpg']);
  });

  it('list rejects a prefix that escapes the data dir', async () => {
    const adapter = new LocalDiskStorageAdapter(dataDir, 'http://localhost:8787');
    await expect(adapter.list('../')).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  });
});
