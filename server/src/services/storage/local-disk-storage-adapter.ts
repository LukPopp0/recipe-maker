import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '../../lib/errors.js';
import type { StorageAdapter } from './storage-adapter.js';

function isNodeError(err: unknown, code: string): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code?: string }).code === code;
}

// Milestone-1 default StorageAdapter per specs/06: stores objects as files under
// dataDir, keyed by the caller-supplied storage key (namespaced
// `recipes/{recipeId}/{kind}-{index}.{ext}`), and serves them back out via Hono's
// static middleware mounted at /images/* in app.ts (not via this class's get(),
// which is for internal/server-side reads only).
export class LocalDiskStorageAdapter implements StorageAdapter {
  constructor(
    private readonly dataDir: string,
    private readonly publicBaseUrl: string,
  ) {}

  // Defense-in-depth against path traversal via a malformed key, mirroring
  // LocalJsonFileRecipeRepository's filePath() guard.
  private resolvePath(key: string): string {
    const resolvedDataDir = path.resolve(this.dataDir);
    const resolvedPath = path.resolve(resolvedDataDir, key);

    if (resolvedPath !== resolvedDataDir && !resolvedPath.startsWith(resolvedDataDir + path.sep)) {
      throw new AppError('INTERNAL_ERROR', `Invalid storage key: "${key}"`);
    }

    return resolvedPath;
  }

  // contentType is part of the StorageAdapter contract (a future cloud adapter
  // needs it to set the object's Content-Type); the local-disk implementation
  // doesn't need it since static serving derives Content-Type from the file
  // extension already encoded in `key`.
  async put(fileBuffer: Buffer, key: string, contentType: string): Promise<string> {
    void contentType;
    const filePath = this.resolvePath(key);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, fileBuffer);
    return `${this.publicBaseUrl}/images/${key}`;
  }

  async get(key: string): Promise<Buffer> {
    try {
      return await readFile(this.resolvePath(key));
    } catch (err) {
      if (isNodeError(err, 'ENOENT')) {
        throw new AppError('INTERNAL_ERROR', `Storage key not found: "${key}"`);
      }
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await rm(this.resolvePath(key));
    } catch (err) {
      if (isNodeError(err, 'ENOENT')) {
        return;
      }
      throw err;
    }
  }
}
