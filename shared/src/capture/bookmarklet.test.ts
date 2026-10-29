// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runBookmarklet } from './bookmarklet.js';
import { CAPTURE_PROTOCOL } from './protocol.js';

const ORIGIN = 'https://app.test';

async function waitFor(fn: () => void, timeout = 2000) {
  const start = Date.now();
  for (;;) {
    try {
      return fn();
    } catch (e) {
      if (Date.now() - start > timeout) throw e;
      await new Promise((r) => setTimeout(r, 10));
    }
  }
}

function frameWindow(): Window {
  const f = document.createElement('iframe');
  document.body.appendChild(f);
  return f.contentWindow as Window;
}

function pngResponse() {
  return { ok: true, headers: new Headers({ 'content-type': 'image/png' }), blob: async () => new Blob(['abc']) };
}

describe('runBookmarklet', () => {
  let appWin: Window;
  let otherWin: Window;
  let fetchMock: ReturnType<typeof vi.fn>;
  let openSpy: ReturnType<typeof vi.spyOn>;
  const sent = () => (appWin.postMessage as unknown as ReturnType<typeof vi.fn>);

  beforeEach(() => {
    document.head.innerHTML = '<meta property="og:image" content="https://img.test/main.png">';
    appWin = frameWindow();
    otherWin = frameWindow();
    vi.spyOn(appWin, 'postMessage').mockImplementation(() => {});
    fetchMock = vi.fn(async () => pngResponse());
    vi.stubGlobal('fetch', fetchMock);
    openSpy = vi.spyOn(window, 'open').mockReturnValue(appWin);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  const say = (origin: string, source: Window, data: unknown) =>
    window.dispatchEvent(new MessageEvent('message', { origin, source, data }));

  it('opens the app capture route before doing anything else', () => {
    runBookmarklet(ORIGIN, window);
    expect(openSpy).toHaveBeenCalledWith('https://app.test/capture', '_blank');
    expect(openSpy.mock.invocationCallOrder[0]).toBeLessThan(fetchMock.mock.invocationCallOrder[0]);
  });

  it('alerts when the popup is blocked', () => {
    openSpy.mockReturnValue(null);
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    runBookmarklet(ORIGIN, window);
    expect(alertSpy).toHaveBeenCalledWith('Recipe Maker could not open a new tab. Allow pop-ups for this site and try again.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts the payload to the app origin when the app window says ready', async () => {
    runBookmarklet(ORIGIN, window);
    say(ORIGIN, appWin, { protocol: CAPTURE_PROTOCOL, type: 'ready' });
    await waitFor(() =>
      expect(sent()).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'payload',
          payload: expect.objectContaining({ url: location.href, mainImage: expect.any(Blob) }),
        }),
        ORIGIN,
      ),
    );
  });

  it('ignores ready from another origin or another window', async () => {
    runBookmarklet(ORIGIN, window);
    say('https://evil.test', appWin, { protocol: CAPTURE_PROTOCOL, type: 'ready' });
    say(ORIGIN, otherWin, { protocol: CAPTURE_PROTOCOL, type: 'ready' });
    await new Promise((r) => setTimeout(r, 50));
    expect(sent()).not.toHaveBeenCalled();
  });

  it('sends the payload without bytes when the image cannot be read', async () => {
    fetchMock.mockRejectedValue(new Error('cors'));
    runBookmarklet(ORIGIN, window);
    say(ORIGIN, appWin, { protocol: CAPTURE_PROTOCOL, type: 'ready' });
    await waitFor(() => expect(sent()).toHaveBeenCalled());
    const payload = sent().mock.calls[0][0].payload;
    expect(payload.mainImageUrl).toBe('https://img.test/main.png');
    expect(payload.mainImage).toBeUndefined();
  });

  it('answers a relay request with the fetched image and the same id', async () => {
    runBookmarklet(ORIGIN, window);
    say(ORIGIN, appWin, { protocol: CAPTURE_PROTOCOL, type: 'relay-request', id: 'r1', url: 'https://img.test/s.png' });
    await waitFor(() =>
      expect(sent()).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'relay-reply', id: 'r1', url: 'https://img.test/s.png', image: expect.any(Blob) }),
        ORIGIN,
      ),
    );
  });

  it('answers a relay request with image null when the fetch fails', async () => {
    fetchMock.mockRejectedValue(new Error('cors'));
    runBookmarklet(ORIGIN, window);
    say(ORIGIN, appWin, { protocol: CAPTURE_PROTOCOL, type: 'relay-request', id: 'r2', url: 'https://img.test/s.png' });
    await waitFor(() =>
      expect(sent()).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'relay-reply', id: 'r2', image: null }),
        ORIGIN,
      ),
    );
  });

  it('ignores protocol-less data from the app window', async () => {
    runBookmarklet(ORIGIN, window);
    say(ORIGIN, appWin, 'ready');
    say(ORIGIN, appWin, { type: 'ready' });
    say(ORIGIN, appWin, null);
    await new Promise((r) => setTimeout(r, 50));
    expect(sent()).not.toHaveBeenCalled();
  });

  it('still posts url and html (no image) when collection throws', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(document, 'querySelectorAll').mockImplementation(() => {
      throw new Error('boom');
    });
    runBookmarklet(ORIGIN, window);
    say(ORIGIN, appWin, { protocol: CAPTURE_PROTOCOL, type: 'ready' });
    await waitFor(() => expect(sent()).toHaveBeenCalled());
    const payload = sent().mock.calls[0][0].payload;
    expect(payload.url).toBe(location.href);
    expect(payload.html).toBe(document.documentElement.outerHTML);
    expect(payload.mainImage).toBeUndefined();
    expect(errSpy).toHaveBeenCalled();
  });
});
