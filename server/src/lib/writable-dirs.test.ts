import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureWritableDirs } from './writable-dirs.js';

describe('ensureWritableDirs', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'writable-dirs-'));
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('creates missing directories and reports ok', async () => {
    const result = await ensureWritableDirs({
      recipeStorageDir: path.join(tmp, 'a', 'recipes'),
      imageDataDir: path.join(tmp, 'b'),
    });

    expect(result).toEqual({ ok: true });
  });

  it('names the directory that cannot be created', async () => {
    const file = path.join(tmp, 'file');
    await writeFile(file, 'x');

    const result = await ensureWritableDirs({
      recipeStorageDir: path.join(tmp, 'recipes'),
      imageDataDir: path.join(file, 'images'),
    });

    expect(result).toMatchObject({ ok: false, name: 'imageDataDir', dir: path.join(file, 'images') });
    expect(result.ok === false && result.error.length).toBeGreaterThan(0);
  });
});
