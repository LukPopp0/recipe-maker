import { describe, expect, it, vi } from 'vitest';
import { relayUnhostedImages } from './relay-images.ts';

const blob = new Blob(['x'], { type: 'image/jpeg' });

describe('relayUnhostedImages', () => {
  it('uploads each relayed image into its slot', async () => {
    const onImage = vi.fn();
    const upload = vi.fn().mockResolvedValueOnce({ ok: true, value: { url: '/images/a.jpg' } })
      .mockResolvedValueOnce({ ok: true, value: { url: '/images/b.jpg' } });

    await relayUnhostedImages({
      unhosted: [
        { slot: 'main', url: 'https://x/a.jpg', warning: 'w' },
        { slot: 1, url: 'https://x/b.jpg', warning: 'w' },
      ],
      namespaceId: 'ns',
      requestRelay: vi.fn().mockResolvedValue(blob),
      upload,
      onImage,
    });

    expect(upload).toHaveBeenNthCalledWith(1, 'ns', 'main', blob);
    expect(onImage).toHaveBeenNthCalledWith(1, 'main', '/images/a.jpg');
    expect(onImage).toHaveBeenNthCalledWith(2, 1, '/images/b.jpg');
  });

  it('skips images the source cannot fetch, non-image blobs and failed uploads', async () => {
    const onImage = vi.fn();
    const upload = vi.fn().mockResolvedValue({ ok: false, error: { code: 'X', message: 'm' } });
    const requestRelay = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(new Blob(['x'], { type: 'text/html' }))
      .mockResolvedValueOnce(blob);

    await relayUnhostedImages({
      unhosted: [0, 1, 2].map((slot) => ({ slot, url: `https://x/${slot}`, warning: 'w' })),
      namespaceId: 'ns',
      requestRelay,
      upload,
      onImage,
    });

    expect(upload).toHaveBeenCalledTimes(1);
    expect(onImage).not.toHaveBeenCalled();
  });
});
