import { normalizeImage } from '../images/normalize-image.js';
import type { StorageAdapter } from './storage-adapter.js';

// "recipes/x/main-0.png" -> "recipes/x/main-0.jpg": stored images are always
// JPEG after normalization, so the key's extension must say so (static
// serving derives Content-Type from it).
export function toJpegKey(key: string): string {
  const slash = key.lastIndexOf('/');
  const dot = key.lastIndexOf('.');
  const base = dot > slash ? key.slice(0, dot) : key;
  return `${base}.jpg`;
}

// Decorator that normalizes every image before it is stored (deployment
// spec section 7), so uploads, manual-ingest images and re-hosted URL images
// all get the same treatment without changes at each call site. Throws
// ImageDecodeError for unreadable bytes; callers already treat a failed put
// as a non-critical image failure.
export class ResizingStorageAdapter implements StorageAdapter {
  constructor(private readonly inner: StorageAdapter) {}

  async put(fileBuffer: Buffer, key: string, contentType: string): Promise<string> {
    void contentType;
    const normalized = await normalizeImage(fileBuffer);
    return this.inner.put(normalized, toJpegKey(key), 'image/jpeg');
  }

  get(key: string): Promise<Buffer> {
    return this.inner.get(key);
  }

  delete(key: string): Promise<void> {
    return this.inner.delete(key);
  }
}
