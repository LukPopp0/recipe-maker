import { describe, expect, it } from 'vitest';
import { base64ToBlob, blobToBase64 } from './base64';

describe('base64', () => {
  it('round-trips bytes and type', async () => {
    const bytes = new Uint8Array(70000).map((_, i) => i % 256);
    const blob = new Blob([bytes], { type: 'image/webp' });
    const b64 = await blobToBase64(blob);
    expect(b64).toMatch(/^[A-Za-z0-9+/]+=*$/);
    const back = base64ToBlob(b64, 'image/webp');
    expect(back.type).toBe('image/webp');
    expect(new Uint8Array(await back.arrayBuffer())).toEqual(bytes);
  });
});
